// Direct database access for the e2e suite — the setup project, and the one
// spec that is allowed to seed.
//
// ⚠ THIS USES `SUPABASE_SERVICE_ROLE_KEY`, WHICH BYPASSES RLS. It exists only
// under `tests/`, never under `src/`, and that boundary is checked: the audit's
// standing finding is that the service key appears nowhere in request-handling
// code. Nothing here is imported by the application.
//
// ⚠ AND THE ROWS IT WRITES ARE REAL. There is no local Supabase stack, so
// "seeding" means inserting into Michael's live project. `auth.setup.ts` states
// the rule this file is the exception to — *fixtures are DISCOVERED, never
// seeded, because creating rows is a hazard that outlives a failed teardown* —
// and the exception is deliberately hard to trigger: see `writesAllowed()`.
import fs from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';

/**
 * Playwright doesn't go through Vite, so `.env.local` isn't loaded for us.
 *
 * Moved here from `auth.setup.ts` on 2026-08-09 so there is one copy rather
 * than two — the second reader was this file.
 */
export function loadEnv(): Record<string, string> {
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

/**
 * Whether a spec may create rows in the live project.
 *
 * ⚠ OFF BY DEFAULT, AND THAT IS THE WHOLE DESIGN. `npm run test:e2e` must stay
 * read-only, because it is the thing you run without thinking. A spec that
 * seeds is one you choose to run:
 *
 *     E2E_ALLOW_WRITES=1 npx playwright test library
 *
 * The alternative — seeding on every run — was rejected on 2026-08-09: a run
 * that dies between the insert and the teardown leaves rows in the real Library,
 * and the suite is exactly the thing that gets interrupted with ⌃C.
 */
export function writesAllowed(): boolean {
  return loadEnv().E2E_ALLOW_WRITES === '1';
}

/** A service-role client. Throws rather than silently doing nothing. */
export function serviceDb(): SupabaseClient<Database> {
  const env = loadEnv();
  const url = env.PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env.local');
  return createClient<Database>(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * The prefix every seeded row carries, in its slug AND in its visible name.
 *
 * ⚠ IT IS UGLY ON PURPOSE. If a teardown ever fails, what is left behind must be
 * obviously disposable at a glance in a room Michael actually opens — a
 * plausible-looking work called "Notes" would sit there for a year. `zzz` also
 * sorts it to the bottom of the Library, which orders by name.
 */
export const THROWAWAY = 'zzz-e2e-throwaway';

/**
 * Delete every row any seeded spec has ever left behind, including a previous
 * run's, then the ones from this test.
 *
 * Called in `afterEach` rather than at the end of a test body, so it runs even
 * when an assertion fails — the case that actually leaves litter.
 */
export async function sweepThrowaways(db: SupabaseClient<Database>): Promise<void> {
  // People first: `person_works` carries a key into both, and deleting the
  // person takes its shelf rows with it. Works second, so a link whose person
  // survived a partial failure is already gone by the time the work is removed.
  await db.from('people').delete().like('slug', `${THROWAWAY}%`);
  await db.from('works').delete().like('slug', `${THROWAWAY}%`);

  /*
    Fragments — a seeded jot, and whatever the app made FROM it (plan 45 · Piece
    1 turns one into a quote).

    ⚠ MATCHED ON THE BODY AS WELL AS THE SLUG, and the second half is the one
    that matters. A spec sets the jot's slug itself, so that row is easy. The
    QUOTE's slug is derived on the server — `slugify(attribution + the body's
    first seven words)` — so its shape is not something a spec can promise, and a
    sweep that trusted it would leave the very row the test created. The body is
    the one thing the spec controls at both ends, so it is what the net is made
    of. Belt and braces on purpose: this runs against Michael's live corpus.
  */
  await db.from('fragments').delete().like('slug', `${THROWAWAY}%`);
  await db.from('fragments').delete().like('body', `${THROWAWAY}%`);

  /*
    Tasks — plan 45 · Piece 2 files a jot into one through the ✚.

    ⚠ THE TITLE IS SET BY HAND IN THE SPEC, NOT LEFT TO THE PARSE, and this
    sweep is the reason. `tasks.parse` writes the title from the sentence and is
    free to drop words it reads as noise — including, entirely reasonably, a
    prefix that looks like `zzz-e2e-throwaway`. A sweep keyed to a string a
    model chose is a sweep that misses on the day the model changes its mind.
  */
  await db.from('tasks').delete().like('title', `${THROWAWAY}%`);
}
