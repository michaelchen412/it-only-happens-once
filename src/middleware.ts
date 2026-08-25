import { defineMiddleware } from 'astro:middleware';
import { createSupabaseServerClient } from './lib/supabase';
import { NOTHING } from './lib/hq/attention';
import { today as hqToday } from './lib/hq/time';
import { loadAttention } from './lib/hq/today-data';

/**
 * Does this request render the Observatory's chrome?
 *
 * ⚠ THE BADGE'S THREE READS ARE PAID FOR HERE, so the gate matters. Middleware
 * runs for `/admin/export.json` and — before this branch is even reached — for
 * every `/_actions/**` POST, and neither of those has a sidebar to put a number
 * in. Ticking a task would otherwise pay for a badge nobody renders, on the one
 * interaction that must feel instant.
 *
 * Three cheap facts, in the order they are certain:
 *
 *   - **Not a GET** — every action, every form post. Nothing to render.
 *   - **An extension in the path** — `/admin/export.json`. Admin ROOMS never
 *     carry one, and endpoints under `/admin` do by convention.
 *   - **`Sec-Fetch-Dest`** — the browser's own answer, and the only one that
 *     distinguishes a page load from `fragments-panel`'s `fetch()`. Absent on
 *     Safari before 16.4 and on any non-browser client, so its ABSENCE has to
 *     mean yes: guessing "not a document" there would silently drop the badge
 *     for a whole browser, which is the failure you would never notice.
 *
 * AdminLayout is the only thing that reads the result, and it is reached only by
 * routes that pass all three — so a false positive costs three small reads and a
 * false negative costs a wrong badge. The asymmetry is why the fallback leans yes.
 */
function rendersChrome(request: Request, pathname: string): boolean {
  if (request.method !== 'GET') return false;
  if (/\.[a-z0-9]+$/i.test(pathname)) return false;
  const dest = request.headers.get('sec-fetch-dest');
  return dest === null || dest === 'document';
}

/**
 * The four-and-a-half security headers, on every response (plan 34 · §6c).
 *
 * ⚠ THIS IS HALF OF §6, AND THE OTHER HALF — THE CSP ITSELF — IS DELIBERATELY
 * NOT HERE. Three things were established on 2026-08-10, in this order, and
 * together they mean a Content-Security-Policy for this app currently has no
 * environment in which it can be tested before it reaches readers:
 *
 *   1. Astro's `security.csp` emits a `<meta http-equiv>` element and nothing
 *      else. **There is no report-only mode** — and `Content-Security-Policy-
 *      Report-Only` is forbidden in a meta element by the CSP spec itself, so
 *      this is not an Astro gap that a flag will close. Plan 34 · §6d's whole
 *      de-risking strategy ("Report-Only for a week, then flip") assumed one.
 *   2. `security.csp` is **not supported in dev mode** — Astro says so plainly.
 *   3. `astro preview` **does not run under `@astrojs/vercel`** (the process
 *      exits before becoming ready). So the `build` + `preview` loop §6d named
 *      as the substitute for dev does not exist on this project either.
 *
 * Net: the first execution of any CSP written here would be in production — for
 * a policy whose risky half is a hand-written origin allowlist, where each
 * wrong entry breaks a feature SILENTLY (Turnstile injects its own `<script>`,
 * so no hash can cover it; Spotify and YouTube need `frame-src` or every song
 * is a blank box; the workshop's uploads need the Supabase origin in
 * `connect-src`). That is the exact shape of failure GROUND-RULES' *compiling
 * is not verifying* was written about, and shipping into it would be the
 * workaround rather than the fix.
 *
 * **Two named ways forward, both decisions rather than details.** Either move
 * the whole policy here as a **nonce-based header** — which restores
 * report-only, restores `frame-ancestors`, and leaves one mechanism instead of
 * two, at the cost of threading a nonce into the three `is:inline` scripts — or
 * get a local preview working (`vercel dev`) so Astro's meta CSP can be
 * exercised first. Measured while deciding: the homepage alone renders **55
 * inline `style=` attributes**, which hashes cannot cover, so `style-src` will
 * need `'unsafe-inline'` either way.
 *
 * What IS here cannot break a render. Every header below is inert to layout,
 * script and network, which is why it ships today and the CSP does not.
 */
function harden(res: Response, url: URL): Response {
  // Clickjacking. `frame-ancestors` would be the modern spelling and it is
  // ignored in a meta element — one more reason the CSP wants to be a header
  // when it comes. Nothing on this site is meant to be framed by anybody;
  // framing OTHERS (Spotify, YouTube) is `frame-src` and is unaffected.
  res.headers.set('X-Frame-Options', 'DENY');

  // MIME sniffing. The OG route serves image bytes and the two feeds serve XML;
  // a sniffed content type is how one of those becomes something executable.
  res.headers.set('X-Content-Type-Options', 'nosniff');

  // Referrer: full URL to ourselves, origin-only cross-site. A reader arriving
  // at Spotify from a constellation should not hand over which constellation.
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Nothing in this app uses any of them, and the workshop's uploads are file
  // pickers rather than device capture.
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');

  // ⚠ HTTPS ONLY, and ⚠ NO `preload`. HSTS is ignored over plain HTTP anyway,
  // but sending it from `localhost` is how a dev machine pins itself to a
  // scheme the dev server does not speak. And `preload` is effectively
  // irreversible — submitted to a browser-vendor list, removed on nobody's
  // schedule — which is not a commitment to make while `itonlyhappensonce.blog`
  // still points somewhere else entirely (see `lib/robots.ts`).
  if (url.protocol === 'https:') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  return res;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createSupabaseServerClient(context);

  // Validate/refresh the session. Returns null cheaply when there is no auth
  // cookie, so public traffic isn't penalized — verified 2026-08-07: with no
  // cookie this short-circuits inside `_useSession` and makes no network call.
  //
  // ⚠ `getClaims`, NOT `getUser`, AND NOT `getSession` (24 · Piece 8).
  //
  // `getUser` asks the Auth server to confirm the token on EVERY request — a
  // real round trip, measured at 44ms, in front of every page in the
  // Observatory. `getClaims` verifies the JWT signature locally via WebCrypto
  // against the project's JWKS, which auth-js caches in module scope
  // (`GLOBAL_JWKS`, keyed by storage key, 10-minute TTL) — so the cache is
  // shared across the per-request clients this function mints, which is the
  // thing that had to be true for any of this to pay. Measured with fresh
  // clients, exactly as here: **44ms → 1ms after the first call.**
  //
  // ⚠ NOT `getSession`, which would be the fast-looking wrong answer. Supabase
  // is explicit: *"use `getClaims` to verify identity… `getSession` when you
  // need the token directly, but don't rely on the user object it returns for
  // authorization decisions."* The `role !== 'admin'` gate thirty lines below IS
  // an authorization decision, so `getSession` here would be a security
  // regression wearing a performance costume.
  //
  // ⚠ IT DEGRADES SAFELY BY ITSELF. If the project ever moves back to symmetric
  // (HS*) signing keys, or WebCrypto is unavailable, auth-js falls back to
  // `getUser(token)` internally — so this never silently trusts an unverified
  // token, it just stops being fast. This project is on ES256 (asymmetric),
  // confirmed from `/auth/v1/.well-known/jwks.json`.
  //
  // ⚠ THE SESSION REFRESH IS STILL HERE. `getClaims` calls `getSession` first,
  // which is what refreshes an expiring token and lets @supabase/ssr write the
  // new cookies back. Removing this call entirely — the "we don't need it on
  // public pages" optimisation — is what randomly signs people out.
  //
  // ⚠ THE COST, STATED: claims come from a signed token, so a role revoked
  // mid-session is not noticed until that token expires. For one account behind
  // a Google-only allowlist that is an acceptable trade; it is written down so
  // it stays a decision rather than becoming a surprise.
  // ⚠ THE TRY/CATCH IS FOR THE COOKIE-CARRYING REQUEST DURING AN AUTH OUTAGE
  // (plan 43 §4). The no-cookie path never throws — it short-circuits before
  // any network (verified above) — but a request that CARRIES a session cookie
  // can need the JWKS fetch or a token refresh, and if Supabase Auth is down
  // at that moment the rejection would surface here, in front of EVERY route,
  // as a 500 on the one request most likely to be Michael's own. An
  // unverifiable session degrades to an anonymous one instead: public pages
  // render, `/admin` redirects to sign-in, and the log says why. Fail closed
  // for authorization, open for availability — never the other way around.
  let claims: Awaited<ReturnType<typeof supabase.auth.getClaims>>['data'] = null;
  try {
    ({ data: claims } = await supabase.auth.getClaims());
  } catch (e) {
    console.error(`[read] auth: getClaims — ${e instanceof Error ? e.message : String(e)}`);
  }
  const user = claims?.claims ?? null;

  context.locals.supabase = supabase;
  context.locals.user = user;

  // Protect the admin area: require the admin role (Michael only).
  if (context.url.pathname.startsWith('/admin')) {
    // ⚠ THE TWO REFUSALS ARE HARDENED EXPLICITLY, because they return WITHOUT
    // calling `next()` and would otherwise be the only responses this app sends
    // that carry no security headers at all. Caught by reading `curl -I /admin`
    // rather than by any check — a 302 has no body to break, so nothing about
    // it looks wrong. `Referrer-Policy` is the one that earns its place here:
    // the refusal is the one response most likely to be followed off-site.
    if (!user) return harden(context.redirect('/sign-in'), context.url);
    if (user.app_metadata?.role !== 'admin') {
      return harden(context.redirect('/sign-in?denied=1'), context.url);
    }

    // ── The day, resolved once ──────────────────────────────────────────────
    //
    // WHY THE DAY IS RESOLVED HERE and not in each page. Seven admin pages used
    // to call `hqToday(supabase)` for themselves, each reading
    // `settings.home_timezone` on its own. **That was not seven reads per
    // request — it was one, seven times over in the source**, and it is worth
    // being exact because the plan that asked for this said "removes six
    // duplicate settings reads" and a future session would measure that and
    // find nothing. What it removes is seven CALL SITES that must agree about
    // what day it is, on a page set where the whole point is that Today, the
    // agenda and the check-in mean the same "today".
    //
    // What it buys that is new: the LAYOUT can have the day. The sidebar is in
    // the chrome and the chrome is rendered by no page, so before this there was
    // no way to hand it one without every page passing it down.
    //
    // ⚠ It stays inside the admin branch. A settings read on every public page
    // view — every essay, every constellation — would be a real cost paid by
    // readers for a number only Michael can see.
    context.locals.today = await hqToday(supabase);

    // ⚠ THE BADGE ALWAYS MEANS TODAY, never the date the page is looking at.
    // `?date=` navigates Today to any day; the sidebar must not follow it, or
    // backfilling last Tuesday's check-in would clear a signal about this
    // morning. The day above is the server's, and it is the only one passed.
    //
    // The honest cost, stated so nobody has to discover it: three PostgREST
    // calls on every admin page load, issued as one round trip. On `/admin`
    // itself two of them are a second copy of what `loadToday` is about to ask —
    // measured at zero live tasks and one check-in row, so it is not worth
    // threading the result through `locals` to save. If it ever shows up, the
    // escape hatch is an `hq_attention` view collapsing it to one call; that is
    // a migration, which is why it is deliberately not the starting point.
    context.locals.attention = rendersChrome(context.request, context.url.pathname)
      ? await loadAttention(supabase, context.locals.today.ymd)
      : NOTHING;

    /*
      ⚠ WHETHER THE ROSTER HAS ANYBODY — one fact, not the roster (plan 45 ·
      Piece 3). The ✚ is mounted by the layout on every admin page, and its Log
      tab may not exist on an empty roster: a control that asks a question with
      no answers is what 10-hq §10b forbids. So the tab's PRESENCE is decided
      here, and the roster itself is fetched by `people.roster` the first time
      somebody actually opens that tab.

      `head: true` — PostgREST returns the count in a header and no rows at all,
      which is the difference between this and the thing §4d warned about. Under
      the same `rendersChrome` gate as the badge, for the same reason: no public
      page view pays for a number only Michael can see.
    */
    if (rendersChrome(context.request, context.url.pathname)) {
      const { count } = await supabase
        .from('people')
        .select('id', { count: 'exact', head: true })
        .is('archived_at', null);
      context.locals.hasRoster = (count ?? 0) > 0;
    } else {
      context.locals.hasRoster = false;
    }

    // Admin HTML is database-backed, per-user, and was never revalidated on
    // the server's instruction — so the browser was free to hand back a
    // snapshot on a soft reload, and bfcache would restore one wholesale on
    // Back. That is why the workshop needed a HARD refresh to see a
    // constellation you had just made: the request the reload should have sent
    // was never sent at all.
    //
    // Three things this buys, in descending order of how often they matter:
    // reloads stop lying, Back stops restoring a stale workshop, and admin HTML
    // stops sitting in the disk cache after sign-out.
    //
    // ⚠ THE COST IS bfcache, DELIBERATELY. `no-store` disables it for the whole
    // admin area, so pressing Back re-runs the page's queries rather than
    // restoring a live DOM. That is the intent — a restored workshop is a lying
    // workshop — and it is affordable here precisely because this is one
    // signed-in user on their own data. Do NOT copy this rule to the public
    // side, where bfcache is doing real work for real readers.
    const res = await next();
    res.headers.set('Cache-Control', 'no-store');
    return harden(res, context.url);
  }

  return harden(await next(), context.url);
});
