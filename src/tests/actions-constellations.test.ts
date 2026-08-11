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

/**
 * ⚠ THESE ARE THE TESTS THAT ONLY WORK BECAUSE THE INPUT IS A `FormData`.
 *
 * `save` shipped a sentinel — "an ABSENT field means leave as-is, an EMPTY one
 * means clear" — and half of it was a fiction: `accept: 'form'` runs the form
 * through Astro's own coercion first, and `handleFormDataGet` answers
 * `undefined` for ANY falsy value on an optional field. Clearing the score in
 * the composer and pressing Save therefore wrote nothing at all, and reopening
 * the page put the playlist back (reported 2026-08-11).
 *
 * A test that called the handler with a plain object would have PASSED against
 * the broken code — `{ score_url: '' }` is not `undefined` — which is the whole
 * argument for `stubs/astro-actions.ts` re-exporting the real `defineAction`
 * rather than reaching past it. The trip through the form encoding is the part
 * under test.
 */
describe('save', () => {
  const CID = '33333333-3333-4333-8333-333333333333';
  /** The composer's card, as the browser posts it. */
  const card = (over: Record<string, string> = {}) => ({
    id: CID,
    name: 'Grief',
    slug: 'grief',
    status: 'published',
    description: 'Why this way of seeing exists',
    score_url: 'https://open.spotify.com/playlist/abc',
    ...over,
  });
  const written = (db: FakeDb) => db.ops('constellations').find((o) => o.method === 'update')?.args[0];

  it('an emptied score is CLEARED, not ignored', async () => {
    const db = fakeDb({ constellations: { data: [] } }, { record: true });

    await run(constellations.save, db, card({ score_url: '' }));

    expect(written(db)).toMatchObject({ score_url: null });
  });

  it('an emptied description is cleared too — same field, same bug', async () => {
    // ⚠ `''`, not `'   '`. Whitespace is TRUTHY, so it survived the coercion
    // and the old sentinel cleared it correctly — a test written that way
    // passes against the broken code and proves nothing. An emptied TipTap
    // serializes to the empty string, which is the case that was silently lost.
    const db = fakeDb({ constellations: { data: [] } }, { record: true });

    await run(constellations.save, db, card({ description: '' }));

    expect(written(db)).toMatchObject({ description: null });
  });

  it('a filled card writes exactly what it was given', async () => {
    const db = fakeDb({ constellations: { data: [] } }, { record: true });

    await run(constellations.save, db, card());

    expect(written(db)).toMatchObject({
      name: 'Grief',
      status: 'published',
      description: 'Why this way of seeing exists',
      score_url: 'https://open.spotify.com/playlist/abc',
    });
  });
});

/**
 * The other half of the same change: the index's one-click writes. They exist
 * so that "publish this" and "recolour this" stop being whole-card saves — and
 * what makes them worth a test is the NEGATIVE, since a row rebuilt from stale
 * `data-` attributes is exactly how a rename made in the composer got lost.
 */
describe('setStatus / setColor', () => {
  const CID = '44444444-4444-4444-8444-444444444444';

  it('a flip writes the status and NOTHING else', async () => {
    const db = fakeDb({ constellations: {} }, { record: true });

    await run(constellations.setStatus, db, { id: CID, status: 'published' });

    const update = db.ops('constellations').find((o) => o.method === 'update');
    expect(update?.args[0]).toEqual({ status: 'published' });
  });

  it('a recolour writes the slot and NOTHING else', async () => {
    const db = fakeDb({ constellations: {} }, { record: true });

    await run(constellations.setColor, db, { id: CID, color: 'ember' });

    const update = db.ops('constellations').find((o) => o.method === 'update');
    expect(update?.args[0]).toEqual({ color: 'ember' });
  });

  it('a missing status is a refusal, not a quiet unpublish', async () => {
    // `save`'s schema DEFAULTS status to draft, because an unchecked switch
    // sends no field. Here the field is the entire message, so the default
    // would turn a dropped one into an unpublish nobody asked for.
    const db = fakeDb({ constellations: {} }, { record: true });

    await expect(run(constellations.setStatus, db, { id: CID })).rejects.toThrow();
    expect(db.ops('constellations').some((o) => o.method === 'update')).toBe(false);
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
