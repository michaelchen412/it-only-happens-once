// The wall every previous verification attempt hit: "those routes return 302 to
// login from a script, which proves only that they compile."
//
// This is the way through. Supabase's admin API can mint a one-time token for a
// user; exchanging it yields a genuine session, and handing that session to
// @supabase/ssr's OWN cookie writer produces exactly the cookies middleware.ts
// will read — matched by construction rather than by my guess at the format.
//
// It needs SUPABASE_SERVICE_ROLE_KEY, which is why this runs only here and only
// locally. That key bypasses RLS, so note what this file does NOT do: it never
// touches application data, never reaches request-handling code, and the state
// it writes is gitignored. The session it creates is as real as signing in with
// Google — treat tests/e2e/.auth/admin.json as a live credential.
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import fs from 'node:fs';
import path from 'node:path';
// `loadEnv` moved to ./db.ts on 2026-08-09, when `library.spec.ts` became its
// second reader. Same function, one copy.
import { loadEnv } from './db';

const AUTH_DIR = path.join('tests', 'e2e', '.auth');
const STATE_FILE = path.join(AUTH_DIR, 'admin.json');
const FIXTURES_FILE = path.join(AUTH_DIR, 'fixtures.json');

setup('mint an admin session and find fixtures', async () => {
  const env = loadEnv();
  const url = env.PUBLIC_SUPABASE_URL;
  const anonKey = env.PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  expect(
    url && anonKey && serviceKey,
    'PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be in .env.local',
  ).toBeTruthy();

  const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // ---- who is the admin? (role lives in app_metadata, same as middleware reads)
  const { data: list, error: listErr } = await service.auth.admin.listUsers();
  expect(listErr, `listUsers failed: ${listErr?.message}`).toBeNull();
  const adminUser = list!.users.find((u) => u.app_metadata?.role === 'admin');
  expect(adminUser, 'no user carries app_metadata.role = "admin"').toBeTruthy();

  // ---- a real session, by the front door
  const { data: link, error: linkErr } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email: adminUser!.email!,
  });
  expect(linkErr, `generateLink failed: ${linkErr?.message}`).toBeNull();
  const hashedToken = link?.properties?.hashed_token;
  expect(hashedToken, 'generateLink returned no hashed_token').toBeTruthy();

  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: otpErr } = await anon.auth.verifyOtp({
    token_hash: hashedToken!,
    type: 'magiclink',
  });
  expect(otpErr, `verifyOtp failed: ${otpErr?.message}`).toBeNull();

  // ---- let the app's own cookie library decide the cookie shape
  const jar: { name: string; value: string }[] = [];
  const ssr = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [],
      // Must return void — `Array.push` returns a number, which is not a
      // SetAllCookies. A concise arrow here is a type error, not a style choice.
      setAll: (cs) => {
        jar.push(...cs.map((c) => ({ name: c.name, value: c.value })));
      },
    },
  });
  await ssr.auth.setSession({
    access_token: verified!.session!.access_token,
    refresh_token: verified!.session!.refresh_token,
  });
  expect(jar.length, '@supabase/ssr wrote no cookies').toBeGreaterThan(0);

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        cookies: jar.map((c) => ({
          name: c.name,
          value: c.value,
          domain: 'localhost',
          path: '/',
          expires: -1, // session cookie; the run is short and re-mints each time
          httpOnly: false,
          secure: false,
          sameSite: 'Lax' as const,
        })),
        origins: [],
      },
      null,
      2,
    ),
  );

  // ---- fixtures: DISCOVERED, never seeded.
  // These specs run against the live database. Creating rows there to test with
  // is a hazard that outlives a failed teardown, so instead we find what is
  // already there and skip the spec when there's nothing suitable.
  const { data: draft } = await service
    .from('fragments')
    .select('slug, status')
    .eq('type', 'writing')
    .is('deleted_at', null)
    .neq('status', 'published')
    .limit(1)
    .maybeSingle();
  const { data: published } = await service
    .from('fragments')
    .select('slug')
    .eq('type', 'writing')
    .eq('status', 'published')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  // The fragment browser is mounted in the constellation composer, not on
  // /admin — so reaching it needs a real constellation to open.
  const { data: constellation } = await service.from('constellations').select('id').limit(1).maybeSingle();

  // A constellation with a SUITE in it, for the specs about removing rows. The
  // one above may well be empty, and an empty composer has no ✕ to press. Two
  // placements is the floor: one to remove and one to prove the rest survive.
  const { data: placements } = await service.from('fragment_constellations').select('constellation_id');
  const byConstellation = new Map<string, number>();
  for (const p of placements ?? []) {
    byConstellation.set(p.constellation_id, (byConstellation.get(p.constellation_id) ?? 0) + 1);
  }
  const composed = [...byConstellation.entries()].find(([, n]) => n >= 2)?.[0] ?? null;

  // A DRAFT constellation, for the cache-header branch on `/[slug]` (24 · Piece
  // 3). That route doubles as the draft preview, so it must answer
  // `private, no-store` to the admin and `public, s-maxage=…` to everyone else —
  // and the failure mode is an unpublished constellation sitting in a public CDN
  // for a minute. Anonymously it is unreachable (RLS hides it and the page
  // redirects home), so THE ADMIN SESSION IS THE ONLY WAY TO TEST THE BRANCH
  // THAT MATTERS. Discovered like everything else here; the spec skips if the
  // sky happens to have no draft in it.
  const { data: draftConstellation } = await service
    .from('constellations')
    .select('slug')
    .neq('status', 'published')
    .limit(1)
    .maybeSingle();

  // A QUOTE with its whole neighbourhood lit (plan 32): placed in a published
  // constellation, and by an author who has other lines. That combination is
  // what makes the page's strip show every control at once, and it is rarer
  // than it sounds — 19 of 77 quotes are in no constellation and 29 of 35
  // authors have exactly one quote. Discovered, never seeded, like everything
  // else here; the spec skips what it cannot find.
  const { data: quotes } = await service
    .from('fragments')
    .select('id, slug, author_id')
    .eq('type', 'quote')
    .eq('status', 'published')
    .is('deleted_at', null);
  const { data: placed } = await service.from('fragment_constellations').select('fragment_id, constellation_id');
  const placedIds = new Set((placed ?? []).map((p) => p.fragment_id));
  const authorTally = new Map<string, number>();
  for (const q of quotes ?? []) {
    if (q.author_id) authorTally.set(q.author_id, (authorTally.get(q.author_id) ?? 0) + 1);
  }
  const richQuote =
    (quotes ?? []).find((q) => placedIds.has(q.id) && q.author_id && (authorTally.get(q.author_id) ?? 0) >= 2) ?? null;

  // A PUBLISHED constellation that actually holds a published quote — the specs
  // about the quote sheet need one, and the sky's first row is not it (two of
  // the eleven published constellations carry no quotes at all, and one of them
  // sorts first). Discovered, never seeded, like everything else here.
  const quoteIds = new Set((quotes ?? []).map((q) => q.id));
  const withQuote = (placed ?? []).find((row) => quoteIds.has(row.fragment_id))?.constellation_id ?? null;
  const { data: quoteConstellation } = withQuote
    ? await service.from('constellations').select('slug').eq('id', withQuote).eq('status', 'published').maybeSingle()
    : { data: null };

  fs.writeFileSync(
    FIXTURES_FILE,
    JSON.stringify(
      {
        quoteSlug: (quotes ?? [])[0]?.slug ?? null,
        quoteConstellationSlug: quoteConstellation?.slug ?? null,
        richQuoteSlug: richQuote?.slug ?? null,
        draftSlug: draft?.slug ?? null,
        draftStatus: draft?.status ?? null,
        publishedSlug: published?.slug ?? null,
        constellationId: constellation?.id ?? null,
        composedConstellationId: composed,
        draftConstellationSlug: draftConstellation?.slug ?? null,
      },
      null,
      2,
    ),
  );

  // The session has to actually work, or every spec below fails confusingly.
  expect(published?.slug, 'no published essay in the database to test against').toBeTruthy();
});

/**
 * Warm the dev server's module graph before any spec measures anything.
 *
 * ⚠ THIS EXISTS BECAUSE A COLD SERVER MANUFACTURES A FALSE BUG REPORT, and the
 * false report is expensive: on 2026-08-07 a cold run failed all nine
 * `sky-return.anon.spec.ts` cases, with the overview returning to scroll 0
 * instead of the remembered position — exactly the symptom the feature exists
 * to prevent. It read as a broken feature on a live site. It was not. Driving
 * the identical journey by hand restored to the pixel, and the same suite ran
 * 13/13 green against the warmed server in 17 seconds, having taken 4.4 minutes
 * to fail before.
 *
 * The mechanism, so nobody re-diagnoses it: `astro dev` compiles a route on
 * first request and Vite may RE-OPTIMIZE dependencies once it sees what that
 * route imports. Re-optimization invalidates already-served modules — the
 * browser gets `504 (Outdated Optimize Dep)` — and Vite recovers by pushing a
 * full page reload down the HMR socket. A full reload lands mid-navigation, so
 * the view transition never completes and the page ends up at scroll 0. Nothing
 * about that is the code under test; it is the server compiling while being
 * measured.
 *
 * `sky-return.anon.spec.ts` already knew half of this — it waits for the sky's
 * own content before touching the toolbar, "because a cold Vite compile of this
 * route can still send a full-reload down the HMR socket". That guard covers
 * `/`. Nothing covered the SUITE route, which is the heavier of the two: it
 * pulls in the constellation script, the star drawing and focus-mode.
 *
 * So both routes get walked once, here, before any assertion depends on them.
 * The cost is a couple of seconds on a cold server and ~0 on a warm one.
 */
setup('warm the routes the specs measure', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-sky-slot]').first()).toBeVisible();

  // The suite route, reached the way a reader reaches it. Discovered from the
  // page rather than hard-coded, for the same reason the fixtures above are
  // discovered: a slug in a test file is a slug that goes stale.
  const slug = await page.locator('[data-sky-slot]').first().getAttribute('data-sky-slot');
  if (!slug) return;
  await page.goto(`/${slug}`);
  await expect(page.locator('.suite-item').first()).toBeVisible();

  // Back once more, so the return path's modules are compiled too — the reload
  // this is here to prevent lands precisely on that navigation.
  await page.goto('/');
  await expect(page.locator('[data-sky-slot]').first()).toBeVisible();
});
