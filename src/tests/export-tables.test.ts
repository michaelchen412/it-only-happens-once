// The export knows about every table (27 · §1).
//
// ⚠ THIS FILE EXISTS BECAUSE A COMMENT WAS NOT ENOUGH. `export.json.ts` has
// carried a "STANDING RULE" since ADR-0012 saying every new table joins its
// list in the same commit. On 2026-08-08 an audit found five that had not:
// `checkin_dreams`, `checkin_wakings`, `checkin_naps` (2026-08-06) and
// `push_subscriptions`, `push_day_claims` (plan 21). The rule was right, was
// believed, and was unenforced — so every export taken in between was silently
// short, and an incomplete export is indistinguishable from a complete one
// until the day you open it to restore something.
//
// THE SOURCE OF TRUTH IS THE GENERATED TYPES, deliberately. `database.types.ts`
// is regenerated from the live schema, so `Database['public']['Tables']` is the
// one list in this repo that cannot drift from Postgres without someone
// noticing — which makes it the right thing to diff against, and makes the next
// migration that adds a table fail `npm run verify` instead of shipping a hole.
//
// ⚠ THE TYPES ARE NOT AUTOMATIC EITHER, and this test cannot see that. If
// `database.types.ts` is stale, this passes while the export is still short.
// That is a narrower hole than the one it closes — regenerating the types is
// the first step of any schema change, because nothing else in `src/` compiles
// without it — but it is a hole, and it is the reason the hands item on this
// plan is "take a real export and open it" rather than "the test is green".
import { describe, expect, it } from 'vitest';
import { TABLES } from '../pages/admin/export.json';
import type { Database } from '../lib/database.types';

/**
 * The whole schema, as the generated types see it.
 *
 * A type cannot be iterated, so the names are read off a value whose type is
 * `Record<keyof Tables, true>` — the annotation is what does the work. Omit a
 * table and this file stops compiling under `astro check`; invent one and it
 * stops compiling too. So the literal below cannot fall out of step with the
 * generated types even though it is written by hand.
 */
const ALL: Record<keyof Database['public']['Tables'], true> = {
  authors: true,
  calendar_sync: true,
  checkin_dreams: true,
  checkin_naps: true,
  checkin_wakings: true,
  constellations: true,
  daily_checkins: true,
  event_people: true,
  events: true,
  external_events: true,
  feelings: true,
  fragment_constellations: true,
  fragment_feelings: true,
  fragment_subjects: true,
  fragment_versions: true,
  fragments: true,
  goals: true,
  interaction_people: true,
  interactions: true,
  pages: true,
  people: true,
  person_fragments: true,
  person_works: true,
  push_day_claims: true,
  push_subscriptions: true,
  settings: true,
  subjects: true,
  task_events: true,
  tasks: true,
  works: true,
};

/**
 * Tables deliberately left out, each with the reason ON THE RECORD.
 *
 * This is the half that makes the test worth having rather than merely strict.
 * An exclusion is a decision — "this data does not belong in the artefact you
 * restore from" — and a decision that lives only in whoever last edited the
 * array is not a decision anyone can review. Adding a name here should feel
 * like writing something down, because it is.
 *
 * ⚠ IT IS EMPTY, AND THAT IS THE FINDING. Every table in this schema belongs in
 * the export. The two things that are correctly excluded — `goal_last_done` and
 * `person_last_contact` — are VIEWS, so they are not in `Database['public']
 * ['Tables']` at all and never reach this comparison; `export.json.ts` says why
 * beside each of them, and the `Table` union there would reject them anyway.
 * The empty object is kept rather than deleted so that the first genuine
 * exclusion has somewhere to be argued for.
 */
const EXCLUDED: Partial<Record<keyof Database['public']['Tables'], string>> = {};

describe('the export covers the schema', () => {
  it('exports every table the generated types know about', () => {
    const expected = (Object.keys(ALL) as (keyof typeof ALL)[]).filter((t) => !(t in EXCLUDED));
    const missing = expected.filter((t) => !(TABLES as readonly string[]).includes(t));

    // The message matters more than the assertion here: this fires on a commit
    // whose author is thinking about a migration, not about a backup endpoint,
    // so it has to say what to do rather than just what is unequal.
    expect(
      missing,
      `${missing.length} table(s) exist but are not exported. Add them to TABLES in ` +
        `src/pages/admin/export.json.ts in foreign-key order (a table must follow ` +
        `everything it points at), or add each to EXCLUDED in this file with the ` +
        `reason it does not belong in an export.`,
    ).toEqual([]);
  });

  it('exports nothing that is not a table', () => {
    // The other direction, which the `Table` union already makes a compile
    // error — asserted anyway because a dropped table is the case where the
    // types are regenerated and the export is not, and a runtime "relation does
    // not exist" would surface as a 500 inside a backup nobody was watching.
    const unknown = (TABLES as readonly string[]).filter((t) => !(t in ALL));
    expect(unknown, 'TABLES names something the schema does not have').toEqual([]);
  });

  it('excludes nothing without a stated reason', () => {
    for (const [table, why] of Object.entries(EXCLUDED)) {
      expect(why?.trim(), `${table} is excluded from the export with no reason given`).toBeTruthy();
      expect((TABLES as readonly string[]).includes(table), `${table} is both excluded and exported`).toBe(false);
    }
  });

  it('lists no table twice', () => {
    // A duplicate is harmless to the file and costs a full extra read of the
    // table — worth catching, because the list is edited by appending and the
    // obvious slip is appending something already in the middle.
    expect([...new Set(TABLES)]).toHaveLength(TABLES.length);
  });
});
