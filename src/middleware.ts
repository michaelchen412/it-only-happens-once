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

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createSupabaseServerClient(context);

  // Validate/refresh the session against Supabase. Returns null cheaply when
  // there is no auth cookie, so public traffic isn't penalized.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  context.locals.supabase = supabase;
  context.locals.user = user;

  // Protect the admin area: require the admin role (Michael only).
  if (context.url.pathname.startsWith('/admin')) {
    if (!user) return context.redirect('/sign-in');
    if (user.app_metadata?.role !== 'admin') {
      return context.redirect('/sign-in?denied=1');
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
    return res;
  }

  return next();
});
