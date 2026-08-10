// The three loops that used to issue one query per id, sequentially
// (plans/30 · §3) — and the one of them whose fix could change behaviour.
//
// ⚠ WHAT THIS FILE CAN AND CANNOT PROVE, on the same terms as
// `actions-vocabulary.test.ts`. `fakeDb` fakes the BUILDER, so it cannot prove
// atomicity — that an upsert either lands whole or not at all is Postgres's
// promise, not something a stub can demonstrate. What it CAN see is the thing
// the change is made of: how many statements go out, and what is in them. It
// also cannot tell the two `fragment_constellations` reads in `setMembership`
// apart (different columns, same table, one fixture), so the tail ARITHMETIC —
// "a new placement lands after the suite's current last" — stays e2e's.
//
// These drive the REAL actions, `this`-bound to a hand-made context; see
// `src/tests/stubs/astro-actions.ts` for why that works.
import { describe, expect, it } from 'vitest';
import { constellations } from '../actions/constellations';
import { fakeDb, type FakeDb } from './stubs/supabase';

const FRAGMENT = '11111111-1111-4111-8111-111111111111';
const SUITE = '22222222-2222-4222-8222-222222222222';

function ctxFor(db: FakeDb) {
  return { locals: { supabase: db.client, user: { app_metadata: { role: 'admin' } } } };
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

type FormAction = { orThrow: (input: FormData) => Promise<unknown> };
function run(action: unknown, db: FakeDb, fields: Record<string, string>) {
  const handler = (action as FormAction).orThrow as unknown as (this: unknown, i: FormData) => Promise<unknown>;
  return handler.call(ctxFor(db), form(fields));
}

describe('reorderPlacements', () => {
  it('rewrites the whole suite in ONE statement', async () => {
    // Four pieces used to be four sequential updates, and a failure at the
    // third left an order nobody authored with nothing said about it.
    const db = fakeDb(
      { fragment_constellations: { data: ['f-a', 'f-b', 'f-c'].map((fragment_id) => ({ fragment_id })) } },
      { record: true },
    );

    await run(constellations.reorderPlacements, db, { constellation_id: SUITE, fragment_ids: 'f-c,f-a,f-b' });

    const upserts = db.ops('fragment_constellations').filter((o) => o.method === 'upsert');
    expect(upserts).toHaveLength(1);
    expect(db.ops('fragment_constellations').some((o) => o.method === 'update')).toBe(false);
    expect(upserts[0].args[0]).toEqual([
      { constellation_id: SUITE, fragment_id: 'f-c', position: 1 },
      { constellation_id: SUITE, fragment_id: 'f-a', position: 2 },
      { constellation_id: SUITE, fragment_id: 'f-b', position: 3 },
    ]);
  });

  it('⚠ a REORDER never becomes a PLACE — an id that is not here is dropped', async () => {
    // The trap in the obvious version. `upsert` is `INSERT … ON CONFLICT`, so
    // an unplaced id would be inserted rather than ignored: unplace a piece in
    // one tab, drag in another, and the stale tab puts it back. The old
    // `.eq()` update no-opped on such a row, and that behaviour is the one
    // being preserved.
    const db = fakeDb(
      { fragment_constellations: { data: [{ fragment_id: 'f-a' }, { fragment_id: 'f-b' }] } },
      { record: true },
    );

    await run(constellations.reorderPlacements, db, { constellation_id: SUITE, fragment_ids: 'f-a,f-gone,f-b' });

    const rows = db.ops('fragment_constellations').find((o) => o.method === 'upsert')?.args[0];
    // ⚠ AND THE SURVIVORS RENUMBER 1..n, not 1,3. Numbering from the client's
    // index would leave a hole exactly where the stale id was — and "positions
    // are authored order, rewritten 1..n" is this module's opening promise.
    expect(rows).toEqual([
      { constellation_id: SUITE, fragment_id: 'f-a', position: 1 },
      { constellation_id: SUITE, fragment_id: 'f-b', position: 2 },
    ]);
  });

  it('a list of nothing-that-is-here writes nothing at all', async () => {
    const db = fakeDb({ fragment_constellations: { data: [] } }, { record: true });

    await run(constellations.reorderPlacements, db, { constellation_id: SUITE, fragment_ids: 'f-gone' });

    expect(db.ops('fragment_constellations').some((o) => o.method === 'upsert')).toBe(false);
  });
});

describe('setMembership', () => {
  it('adds every new suite in ONE upsert, whatever the count', async () => {
    // Was two sequential queries PER constellation — a tail position, then an
    // upsert — so placing a piece in three suites was six round trips in a row
    // and a failure at the third left it in one of them, silently.
    const db = fakeDb(
      { fragment_constellations: { data: [{ constellation_id: 'c-1', position: 4 }] } },
      { record: true },
    );

    await run(constellations.setMembership, db, {
      fragment_id: FRAGMENT,
      constellation_ids: 'c-1,c-2,c-3',
    });

    const upserts = db.ops('fragment_constellations').filter((o) => o.method === 'upsert');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].args[0]).toHaveLength(2); // c-2 and c-3; c-1 was already there
  });

  it('belongs to none: removes what is there and upserts nothing', async () => {
    // EMPTY IS A MEANINGFUL VALUE here (see `idList` in _shared.ts) — it is a
    // piece being taken out of every constellation it was in.
    const db = fakeDb(
      { fragment_constellations: { data: [{ constellation_id: 'c-1', position: 4 }] } },
      { record: true },
    );

    await run(constellations.setMembership, db, { fragment_id: FRAGMENT, constellation_ids: '' });

    expect(db.ops('fragment_constellations').some((o) => o.method === 'delete')).toBe(true);
    expect(db.ops('fragment_constellations').some((o) => o.method === 'upsert')).toBe(false);
  });
});

describe('reorder', () => {
  it('issues every update, and checks every one of them', async () => {
    // The one loop where a single upsert is NOT available — `constellations`
    // has four NOT NULL columns a `(id, sort)` row cannot supply. So this stays
    // N statements and the win is only latency: they leave together. The thing
    // worth pinning is that no result is dropped on the way back.
    const db = fakeDb({ constellations: { error: { message: 'nope' } } }, { record: true });

    await expect(run(constellations.reorder, db, { ids: 'a,b,c' })).rejects.toThrow(/nope/);
  });
});
