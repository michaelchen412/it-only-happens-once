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
  'fragment-open.spec.ts':
    'One named READ, `fragments.get`. It exists because stubbing that call is exactly what hid ' +
    'the bug: every other spec that opens an editor stubs it, so NOTHING had ever executed the ' +
    'real query — and when ADR 0035 moved songs to their own table, `get` went on asking the ' +
    '`paired_song` embed for `attribution` and `deleted_at`, PostgREST rejected the select, and ' +
    'the suite stayed green while the sheet answered "That fragment no longer exists". A stub ' +
    'cannot prove a SELECT matches the schema, because a stub is the thing standing in for it. ' +
    'Named rather than lifted: this spec still cannot write, and `get` is a read behind ' +
    '`requireAdmin`.',
  'library.spec.ts':
    'Merge deliberately destroys a row and remaps its links. A stub can prove which action was ' +
    'called but not that the survivor keeps the shelf link with its note — the thing 26 · §1 ' +
    'fixed, and the one assertion that needs real rows. Its four other tests stub and write ' +
    'nothing; the seeding one is SKIPPED unless E2E_ALLOW_WRITES=1, so an ordinary run stays ' +
    'read-only. Throwaway rows carry the `zzz-e2e-throwaway` slug prefix and are swept both ' +
    'before and after each test, so an interrupted run cleans up on the next one.',
  'note-to-quote.spec.ts':
    'A jot becomes a quote across two rooms (plan 45 · Piece 1), and the assertion is the ' +
    'ORDERING: the jot must still be in the pile when the sheet opens, and gone once the quote ' +
    'is saved. A stub can prove `saveQuote` was called; it cannot prove the quote came out ' +
    "holding the jot's words, nor that the consume happened after rather than before — which " +
    'is the half 14 §10e exists to protect and the half a later edit is most likely to invert. ' +
    'NAMED rather than lifted: only `fragments.saveQuote` and `fragments.bulk` may through, and ' +
    'the whole describe is SKIPPED unless E2E_ALLOW_WRITES=1. Throwaway rows are matched on the ' +
    "body as well as the slug, because the quote's slug is derived on the server.",
  'capture-declares.spec.ts':
    'The ✚ writes the jot itself (plan 45 · Piece 2), so there is nothing to seed and nothing to ' +
    'file until it has — a stubbed run would be testing its own fixture rather than the motion. ' +
    'What it proves is the pair no on-screen assertion reaches: the task exists, and the jot left ' +
    'the pile once it did. NAMED rather than lifted — saveWriting, tasks.parse, tasks.save and ' +
    'fragments.bulk, nothing else — and the whole describe is SKIPPED unless E2E_ALLOW_WRITES=1. ' +
    'It asserts nothing about what the model returned, because 14 §6.4 says capture must never ' +
    'depend on it; the title is then set by hand so the sweep keys on a string this spec chose.',
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

  /**
   * ⚠ ADR 0028's TRIGGER 3, WITH A METER — and the meter measures the thing the
   * trigger is about, which the trigger's own wording could not.
   *
   * 0028 says branching reopens when "the `allowActions` allowlist reach[es]
   * roughly five entries — at which point the exception is the rule." That was
   * written when every opt-out was the same kind of thing. It is not:
   *
   *   · An opt-out that can WRITE is what the guard exists to bound.
   *   · An opt-out naming only READS behind `requireAdmin` does not weaken
   *     read-only at all — the suite is still entirely read-only with six of
   *     them — and it buys the only thing that checks a `select` against the
   *     real schema.
   *
   * So [ADR 0037](../../docs/adr/0037-a-seeded-write-is-throwaway-gated-and-swept.md)
   * splits them and this counts them apart. Raising the write ceiling is a
   * decision about database branching; raising the read one is not.
   */
  /**
   * ⚠ A THIRD CATEGORY, ADDED 2026-08-24 (plan 45 · Piece 1) — **the named
   * WRITE**, which this file had no bucket for and quietly counted as a read.
   *
   * The split above is `unbounded` (lifts the guard entirely) versus `reads`
   * (names what may through). `note-to-quote.spec.ts` is neither: it names
   * exactly two actions and both of them WRITE. Naming them makes it strictly
   * safer than the unbounded form — nothing else on the page can reach the
   * server — but it is not a read, and dropping it into `reads` would have
   * grown the read ceiling with a pair of writes and told nobody.
   *
   * ⚠ THE DEFAULT IS "WRITE", NOT "READ", and that inversion is the point. A
   * name not on `NAMED_READS` counts against the write ceiling, so the cost of
   * forgetting to classify one is a failing test rather than a guard that has
   * silently stopped guarding. To be treated as harmless, a name has to say so.
   */
  const NAMED_READS = new Set([
    'fragments.get',
    /*
      ⚠ `tasks.parse` IS A READ, and the action says so in its own words:
      *"Read-only — it writes nothing. The fields are handed to the sheet, and
      the person saves or discards them."* It reaches a model rather than a
      table, which is the only reason it looks like the odd one here: what the
      ceiling above bounds is what can CHANGE Michael's data, and this changes
      none of it. Added 2026-08-24 with plan 45 · Piece 2, whose spec drives the
      ✚'s Agenda door and cannot reach the sheet without it.
    */
    'tasks.parse',
  ]);

  it('the write-capable allowlist has not quietly become the rule (ADR 0028 · trigger 3)', () => {
    const unbounded: string[] = [];
    const reads = new Set<string>();
    const writes = new Set<string>();
    const writeSpecs = new Set<string>();

    for (const file of SPECS) {
      const src = fs.readFileSync(path.join(DIR, file), 'utf8');
      for (const m of src.matchAll(/allowActions\(\s*page\s*(?:,\s*\[([^\]]*)\])?\s*\)/g)) {
        // No name list means every action on that page — the write-capable form.
        if (!m[1]) unbounded.push(file);
        else
          for (const quoted of m[1].match(/'([^']+)'/g) ?? []) {
            const name = quoted.replace(/'/g, '');
            if (NAMED_READS.has(name)) reads.add(name);
            else {
              writes.add(name);
              writeSpecs.add(file);
            }
          }
      }
    }

    /*
      ⚠ A NAMED WRITE IS ONLY ACCEPTABLE IN A SPEC THAT CANNOT RUN BY ACCIDENT.
      This is the join between ADR 0028 and ADR 0037: naming the actions bounds
      WHAT may be written, and `writesAllowed()` bounds WHEN. Either one alone
      leaves `npm run test:e2e` — the command you run without thinking — able to
      write to Michael's live corpus.
    */
    for (const file of writeSpecs) {
      const src = fs.readFileSync(path.join(DIR, file), 'utf8');
      expect(
        /test\.skip\(\s*!writesAllowed\(\)/.test(src),
        `${file} names a write in allowActions but is not gated on writesAllowed(). A spec that ` +
          `can write must be SKIPPED unless E2E_ALLOW_WRITES=1 (ADR 0037), or an ordinary ` +
          `read-only run will write to the live project.`,
      ).toBe(true);
    }

    expect(
      [...writes],
      `The named-WRITE allowlist has grown past what plan 45 bounded it at. Every entry here can ` +
        `change Michael's live data. Adding one means arguing that a stub cannot prove what the ` +
        `spec proves — the same bar as an unbounded opt-out, minus the blast radius.`,
      /*
        ⚠ 2 → 4 ON 2026-08-24, and the argument is per entry rather than "the
        feature needed it". `fragments.saveQuote` and `fragments.bulk` came with
        Piece 1: a stub can prove saveQuote was called, not that the quote came
        out holding the jot's words nor that the consume ran after rather than
        before. `fragments.saveWriting` and `tasks.save` come with Piece 2 for
        the same reason one step further along — the ✚ writes the jot itself, so
        a spec that stubs it has no jot to file and is testing its own fixture.

        The ceiling is meant to make each of those an argument rather than a
        habit. If a fifth wants in, that is the point at which ADR 0028's
        trigger 3 is really firing and the answer is database branching.
      */
    ).toHaveLength(4);

    expect(
      unbounded,
      `More than one spec lifts the guard WITHOUT naming what it may call, which is the form that ` +
        `can write. ADR 0028's trigger 3 fires here, not on the named reads — reopening it means ` +
        `the database-branching decision, not another entry.`,
    ).toHaveLength(1);

    // ⚠ A REAL CEILING, NOT `toHaveLength(reads.size)`, which the first draft
    // of this assertion was — a comparison of a number with itself, green for
    // any allowlist of any size. The same vacuous shape this file's opening
    // guard exists to catch, written into the guard.
    expect(
      reads.size,
      `The named-read allowlist has grown past what ADR 0037 bounded it at (${[...reads].sort().join(', ')}). ` +
        `Each entry should be a read behind requireAdmin that some spec actually DRIVES — ` +
        `allowActions permits, it does not cause, so an entry with no spec behind it is inert.`,
    ).toBeLessThanOrEqual(6);
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
