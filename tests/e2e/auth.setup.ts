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

const AUTH_DIR = path.join('tests', 'e2e', '.auth');
const STATE_FILE = path.join(AUTH_DIR, 'admin.json');
const FIXTURES_FILE = path.join(AUTH_DIR, 'fixtures.json');

/** Playwright doesn't go through Vite, so .env.local isn't loaded for us. */
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const file of ['.env', '.env.local']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const i = trimmed.indexOf('=');
      out[trimmed.slice(0, i).trim()] = trimmed
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

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

  fs.writeFileSync(
    FIXTURES_FILE,
    JSON.stringify(
      {
        draftSlug: draft?.slug ?? null,
        draftStatus: draft?.status ?? null,
        publishedSlug: published?.slug ?? null,
        constellationId: constellation?.id ?? null,
      },
      null,
      2,
    ),
  );

  // The session has to actually work, or every spec below fails confusingly.
  expect(published?.slug, 'no published essay in the database to test against').toBeTruthy();
});
