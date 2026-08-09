// The e2e suite cannot quietly start writing to production (27 · §3).
//
// ⚠ WHY A UNIT TEST GUARDS THE E2E SUITE. `tests/e2e/fixtures.ts` blocks
// `/_actions/**` for every spec that imports its `test` — but a fixture only
// protects the files that use it, and "remember to import the right `test`" is
// the same convention it was built to replace, one line further down. This file
// is what makes it structural: it runs in `npm run verify`, which now runs in
// the deploy, so a spec that opts out of the read-only guarantee by accident
// fails the build rather than the database.
//
// It reads the spec files as TEXT rather than importing them, deliberately.
// Importing a spec would execute Playwright's `test()` registrations outside a
// runner, and the question here is not what the specs DO — it is which module
// they got `test` from, which is a fact about the source and nothing else.
//
// The suite runs against the LIVE Supabase project: there is no local stack, so
// a write from a spec is a write to Michael's real corpus. That is the whole
// stake, and it is why the allowlist below is spelled out rather than counted.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join('tests', 'e2e');
const SPECS = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.spec.ts'))
  .sort();

/** A named import from `@playwright/test` that is NOT `import type { … }`. */
const VALUE_IMPORT = /^import\s+(?!type\b)\{([^}]*)\}\s*from\s*'@playwright\/test';/gm;

/**
 * ⚠ THE SPECS ALLOWED TO REACH THE LIVE PROJECT AT ALL, each with its reason.
 *
 * `allowActions` opens a hole in the read-only guard — either for one named
 * READ, or (unnamed) for everything. That is sometimes the only honest way to
 * test something, but it must never be reachable by accident: "one spec quietly
 * grew a write" is precisely the failure this plan was written about. So opting
 * out costs an edit to this list, in a commit, beside a sentence saying why.
 * Same shape as plan 25's dead-network allowlist.
 *
 * ⚠ IT LISTS READS TOO, deliberately. A named read is much weaker than a lifted
 * guard, but the thing worth reviewing is *that a hole exists* — and whether the
 * name is still the read it was when it was allowed. A list of only the scary
 * ones is a list nobody re-reads.
 *
 * The bar for a WRITE: the behaviour genuinely cannot be proven with a stub, AND
 * the spec creates its own throwaway subjects and cleans them up in `afterEach`
 * rather than mutating rows it found.
 */
const OPT_OUTS: Record<string, string> = {
  'today.spec.ts':
    'One named READ, `fragments.get`. Opening the `#edit=<id>` deep link loads the piece through ' +
    'it, and the failure path in writing-sheet.ts opens an inert error shell with the hash ' +
    'CLEARED — so with the call refused the spec fails on a URL assertion, reporting a broken ' +
    'bounce when the bounce was fine. Named rather than lifted: this spec still cannot write.',
  'library.spec.ts':
    'Merge deliberately destroys a row and remaps its links. A stub can prove which action was ' +
    'called but not that the survivor keeps the shelf link with its note — the thing 26 · §1 ' +
    'fixed, and the one assertion that needs real rows. Its four other tests stub and write ' +
    'nothing; the seeding one is SKIPPED unless E2E_ALLOW_WRITES=1, so an ordinary run stays ' +
    'read-only. Throwaway rows carry the `zzz-e2e-throwaway` slug prefix and are swept both ' +
    'before and after each test, so an interrupted run cleans up on the next one.',
};

describe('the e2e suite is read-only by construction', () => {
  it('found the spec files', () => {
    // A guard against this whole file passing vacuously because the glob broke
    // or the directory moved — every assertion below is per-file.
    expect(SPECS.length).toBeGreaterThan(40);
  });

  it.each(SPECS)('%s takes `test` from ./fixtures, not @playwright/test', (file) => {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');

    const offending = [...src.matchAll(VALUE_IMPORT)].map((m) => m[0]);
    expect(
      offending,
      `${file} imports values from '@playwright/test'. Import { test, expect } from './fixtures' ` +
        `instead — that is the runner which blocks /_actions/** by default. Type-only imports ` +
        `(import type { Page } from '@playwright/test') are fine and stay.`,
    ).toEqual([]);

    expect(
      /from\s*'\.\/fixtures'/.test(src),
      `${file} never imports from './fixtures', so it is not using the guarded test runner`,
    ).toBe(true);
  });

  it.each(SPECS)('%s reaches the live project only if it is on the allowlist', (file) => {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');
    if (!src.includes('allowActions')) return;

    const why = OPT_OUTS[file];
    expect(
      why,
      `${file} calls allowActions, which lets its action calls reach the LIVE Supabase project. ` +
        `Add it to OPT_OUTS in this file with the reason a stub cannot prove what it proves — ` +
        `or stub the actions instead.`,
    ).toBeTruthy();
    expect(why!.length, `${file}'s OPT_OUTS entry should say why, not just name the file`).toBeGreaterThan(40);
  });

  it('lists no opt-out that has since been deleted or stopped needing one', () => {
    // The allowlist rots in the other direction too: a spec that no longer
    // reaches the server should lose its permission rather than keep it out of
    // politeness — a stale entry is how the next one gets waved through.
    for (const file of Object.keys(OPT_OUTS)) {
      const p = path.join(DIR, file);
      expect(fs.existsSync(p), `OPT_OUTS names ${file}, which does not exist`).toBe(true);
      expect(
        fs.readFileSync(p, 'utf8').includes('allowActions'),
        `OPT_OUTS names ${file}, but it no longer calls allowActions — take it off the list`,
      ).toBe(true);
    }
  });
});
