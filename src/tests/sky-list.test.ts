// `listConstellations` — the front door's one read, and the shape of its
// failure (2026-08-27).
//
// ⚠ THIS FILE EXISTS BECAUSE THE BUG PRODUCED A PERFECTLY VALID PAGE. On
// 2026-08-27 the sky was rendered empty — "The sky is being composed." — with
// eleven constellations in the database and one of the function's two reads
// returning 200. The other returned 401, `counts` stayed empty, every
// constellation scored zero, and `.filter(count > 0)` deleted the sky. Nothing
// threw, nothing was undefined, the typecheck was clean and the render was
// well-formed. There was no assertion anywhere that could have caught it,
// because the only wrong thing was the MEANING of an empty array.
//
// So the two properties pinned here are the two the incident turned into
// requirements: a failed read must be distinguishable from an empty sky, and
// the count must come from the same query as the constellation it counts. The
// query itself is one round trip now, which is what makes the second one true
// by construction rather than by care — `fakeDb` fakes the builder rather than
// the database, so the third block pins the ASK instead.
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from './stubs/supabase';
import { listConstellations } from '../lib/constellations';

/** One row as PostgREST returns it: the constellation, placements embedded. */
const row = (slug: string, sort: number, placements: number) => ({
  name: slug.replace(/-/g, ' '),
  slug,
  description: null,
  sort,
  color: 'amber',
  fragment_constellations: Array.from({ length: placements }, () => ({
    fragments: { status: 'published', deleted_at: null },
  })),
});

/** The read failing, with `console.error` silenced — `noted()` speaks on error. */
const failing = () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const db = fakeDb({ constellations: { data: null, error: { message: 'JWT expired', code: 'PGRST301' } } });
  return { db, spy };
};

describe('listConstellations — the weight of each constellation', () => {
  it('counts the placements the query embedded, and keeps authored order', async () => {
    const db = fakeDb({ constellations: { data: [row('proving-ground', 3, 14), row('wayfinding', 10, 8)] } });
    await expect(listConstellations(db)).resolves.toEqual([
      expect.objectContaining({ slug: 'proving-ground', sort: 3, count: 14 }),
      expect.objectContaining({ slug: 'wayfinding', sort: 10, count: 8 }),
    ]);
  });

  it('does not leak the embedded rows into the ref it returns', async () => {
    // The placements are scaffolding for a number. `/` spreads these refs into
    // markup attributes; the fragment rows have no business travelling with it.
    const db = fakeDb({ constellations: { data: [row('an-inseparable-truth', 14, 6)] } });
    const refs = await listConstellations(db);
    expect(refs?.[0]).not.toHaveProperty('fragment_constellations');
  });
});

describe('listConstellations — a failed read is not an empty sky', () => {
  it('answers null when the read failed', async () => {
    // ⚠ THE REGRESSION, IN ONE ASSERTION. Before 2026-08-27 this returned `[]`,
    // which `/` could not tell from a genuinely empty database — so it rendered
    // the empty state AND handed it to the CDN with `s-maxage=60,
    // stale-while-revalidate=86400` behind it.
    const { db, spy } = failing();
    try {
      await expect(listConstellations(db)).resolves.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('says so out loud, so the failure is not silent in the logs', async () => {
    const { db, spy } = failing();
    try {
      await listConstellations(db);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain('sky: constellations');
    } finally {
      spy.mockRestore();
    }
  });

  it('answers [] — not null — when the database really has nothing to show', async () => {
    // The other direction, and the reason `null` had to be a third value rather
    // than a reused one: a new project with no published constellation is not
    // an outage, and must still be cacheable.
    const db = fakeDb({ constellations: { data: [] } });
    await expect(listConstellations(db)).resolves.toEqual([]);
  });
});

describe('listConstellations — what it asks the database for', () => {
  // `fakeDb` fakes the builder, not the database, so these pin the ASK. That is
  // worth doing here because the rules that used to live in TypeScript — the
  // published filter, and dropping a constellation with nothing published in it
  // — now live in the query, where nothing else can watch them.
  const ask = () => {
    const db = fakeDb({ constellations: { data: [] } }, { record: true });
    return { db, run: () => listConstellations(db.client) };
  };

  it('reads the constellations table once, and nothing else', async () => {
    const { db, run } = ask();
    await run();
    // ⚠ ONE TABLE, ONE ROUND TRIP. The `fragment_constellations` read this
    // replaced is the exact request that came back 401 while its sibling came
    // back 200 — the half-failure the join makes unrepresentable.
    expect(db.tables()).toEqual(['constellations']);
  });

  it('asks only for published constellations, in authored order', async () => {
    const { db, run } = ask();
    await run();
    const ops = db.ops('constellations');
    expect(ops).toContainEqual({ method: 'eq', args: ['status', 'published'] });
    expect(ops).toContainEqual({ method: 'order', args: ['sort'] });
  });

  it('filters the embedded fragments through the dotted path, not just the top level', async () => {
    // ⚠ `!inner` IS WHAT MAKES THESE FILTER RATHER THAN NULL OUT, and losing
    // either half is silent: under the anon key RLS hides drafts anyway, so the
    // output would look correct right up until a caller could see more.
    const { db, run } = ask();
    await run();
    const ops = db.ops('constellations');
    const select = ops.find((o) => o.method === 'select')?.args[0];
    expect(String(select)).toContain('fragment_constellations!inner(fragments!inner(');
    expect(ops).toContainEqual({ method: 'eq', args: ['fragment_constellations.fragments.status', 'published'] });
    expect(ops).toContainEqual({ method: 'is', args: ['fragment_constellations.fragments.deleted_at', null] });
  });
});
