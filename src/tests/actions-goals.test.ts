// `goals.save` cannot change a goal's standing — only `setStatus` can.
//
// ⚠ THIS RULE COST TWO BUGS AND A UX COMPLAINT TO ARRIVE AT, so it is pinned
// rather than left to a comment.
//
//   1. The sheet carried its own four-way Status control, wired to
//      `[data-goalStatus]` while the markup writes `data-goal-status`. It
//      selected nothing, so `picked` returned its FALLBACK on every save and
//      editing a goal's NOTES silently set it back to active (`cdfbced`).
//   2. Fixing the selector made the control work and left the real problem
//      standing: two controls for one fact on one screen — the header's
//      optimistic, the sheet's rendered at page load — so changing the status
//      and then opening the sheet showed the OLD value until a hard refresh.
//      Michael, 2026-08-15: *"I don't like how we have the same controls in two
//      areas… it's not intuitive."*
//   3. ⚠ AND REMOVING THE CONTROL ALONE WOULD HAVE RESTORED BUG 1 BY DESIGN.
//      With the field gone from the form but still `z.enum([…]).default('active')`
//      in the schema, Zod's default fires on every save and writes `active`
//      again. `_shared.ts` says it in general: an action cannot tell "cleared"
//      from "not sent". The field had to leave the SCHEMA, not just the markup.
//
// So the invariant is narrow and load-bearing: an edit must not name the column
// at all. Not "writes the same value back" — does not mention it.
import { describe, expect, it } from 'vitest';
import { goals } from '../actions/goals';
import { fakeDb, type FakeDb } from './stubs/supabase';

const GOAL = '33333333-3333-4333-8333-333333333333';

type JsonAction = { orThrow: (input: unknown) => Promise<unknown> };

/** Drive a JSON action against a recording fake client, as the admin. */
function run(action: unknown, db: FakeDb, input: Record<string, unknown>) {
  const ctx = { locals: { supabase: db.client, user: { app_metadata: { role: 'admin' } } } };
  const handler = (action as JsonAction).orThrow as unknown as (this: unknown, i: unknown) => Promise<unknown>;
  return handler.call(ctx, input);
}

/** One goal row, which is what `.single()` on an update or insert answers with. */
const row = { goals: { data: [{ id: GOAL, slug: 'a-goal' }] } };

describe('goals.save leaves the standing alone', () => {
  it('never names `status` when it updates an existing goal', async () => {
    const db = fakeDb(row, { record: true });
    await run(goals.save, db, { id: GOAL, name: 'Get back in shape', notes: 'edited', horizon: 'this_year' });

    const updates = db.ops('goals').filter((c) => c.method === 'update');
    expect(updates, 'the edit did not reach an update').toHaveLength(1);

    const payload = updates[0].args[0] as Record<string, unknown>;
    expect(
      Object.keys(payload).sort(),
      'goals.save wrote a column it has no business writing — status belongs to setStatus alone',
    ).toEqual(['horizon', 'name', 'notes', 'why']);
    expect('status' in payload).toBe(false);
  });

  it('does not consult the five-active cap on an edit', async () => {
    // ⚠ THE MARKER IS `eq('status', 'active')`, NOT `select`. An update carries
    // a `.select('id, slug')` of its own — the RETURNING clause — so counting
    // selects would fail on a handler doing nothing wrong. The cap check is the
    // only thing that filters by status, which makes it the honest marker.
    //
    // It matters beyond a round trip: while `save` still wrote status, editing
    // prose on a PAUSED goal could be refused with "five active goals is the
    // cap" — a sentence about a field the form was not offering.
    const db = fakeDb(row, { record: true });
    await run(goals.save, db, { id: GOAL, name: 'Get back in shape', horizon: 'this_year' });

    const capCheck = db
      .ops('goals')
      .filter((c) => c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'active');
    expect(capCheck, 'an edit asked whether there was room to activate').toHaveLength(0);
  });

  it('a NEW goal is active, and says so at the insert rather than by default', async () => {
    // ⚠ EMPTY ROWS, because `uniqueSlug` probes this same table for a free slug
    // and the fake answers every call alike — a non-empty `goals` makes it walk
    // all sixty candidates and give up. The insert's own return is unused here:
    // the question is what the handler ASKED the database to do, which is what
    // the recording stub exists for.
    const db = fakeDb({ goals: { data: [] } }, { record: true });
    await run(goals.save, db, { name: 'Learn the standards', horizon: 'this_year' }).catch(() => {});

    const inserts = db.ops('goals').filter((c) => c.method === 'insert');
    expect(inserts, 'the create did not reach an insert').toHaveLength(1);
    expect((inserts[0].args[0] as Record<string, unknown>).status).toBe('active');
  });

  it('and a new goal DOES consult the cap, because creation is the case it bounds', async () => {
    const db = fakeDb({ goals: { data: [] } }, { record: true });
    await run(goals.save, db, { name: 'Learn the standards', horizon: 'this_year' }).catch(() => {});

    const capCheck = db
      .ops('goals')
      .filter((c) => c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'active');
    expect(capCheck, 'a new goal skipped the five-active cap').toHaveLength(1);
  });

  it('ignores a `status` a caller tries to smuggle in', async () => {
    // Zod strips unknown keys, so this is already true — pinned because it is
    // the property that makes removing the field from the schema sufficient.
    const db = fakeDb(row, { record: true });
    await run(goals.save, db, { id: GOAL, name: 'Get back in shape', horizon: 'this_year', status: 'active' });

    const payload = db.ops('goals').filter((c) => c.method === 'update')[0].args[0] as Record<string, unknown>;
    expect('status' in payload).toBe(false);
  });
});
