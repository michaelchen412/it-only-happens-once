// What the inbox MEANS, pinned (ADR 0042; the pile's founding claim).
//
// ⚠ THIS IS THE TEST THAT DID NOT EXIST ON 2026-09-01, and its absence is why
// four user-visible faults survived a green `verify` for two and a half weeks.
// Shelves shipped with a bench, an ADR, a migration and a docs entry, and with
// no test of any kind: `grep -rln 'data-shelf' tests/` returned nothing.
//
// The rule these guard is one sentence — **unshelved is the inbox; shelved is
// kept** — and it is the only rule in the room that cannot be seen by looking
// at the screen, because it is about the notes that are NOT on it.
//
// ⚠ AND `idsInView` IS ORDER-BEARING, which is the half a reader would not
// guess. The room slices its result to `LIST_CEILING`, so a wrong order does
// not show up as a wrong list — it shows up as the WRONG HUNDRED, silently, and
// only once the pile is deep enough that nobody is counting any more.
import { describe, expect, it } from 'vitest';
import { idsInView, type ShelfIndex, type ShelfRef } from '../lib/shelves';

const work: ShelfRef = { id: 's1', name: 'Job applications', slug: 'job-applications' };
const phil: ShelfRef = { id: 's2', name: 'Philosophy', slug: 'philosophy' };

/**
 * An index as `readShelfIndex` would return it — newest-touched first, which is
 * the contract the room relies on and the database `order` supplies.
 */
function index(notes: [string, string][], links: [string, ShelfRef][]): ShelfIndex {
  const byFragment: Record<string, ShelfRef[]> = {};
  const byShelf: Record<string, number> = {};
  const shelved = new Set<string>();
  for (const [id, shelf] of links) {
    (byFragment[id] ??= []).push(shelf);
    byShelf[shelf.id] = (byShelf[shelf.id] ?? 0) + 1;
    shelved.add(id);
  }
  return {
    vocab: [work, phil],
    notes: notes.map(([id, updatedAt]) => ({ id, updatedAt })),
    byFragment,
    byShelf,
    inbox: notes.length - shelved.size,
    shelved,
  };
}

describe('idsInView — the inbox', () => {
  it('is every note on no shelf at all', () => {
    const i = index(
      [
        ['a', '2026-09-03'],
        ['b', '2026-09-02'],
        ['c', '2026-09-01'],
      ],
      [['b', work]],
    );
    expect(idsInView(i, null)).toEqual(['a', 'c']);
  });

  it('⚠ keeps the newest-touched order, because the room slices this to a ceiling', () => {
    const i = index(
      [
        ['newest', '2026-09-09'],
        ['middle', '2026-09-05'],
        ['oldest', '2026-09-01'],
      ],
      [],
    );
    expect(idsInView(i, null)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('⚠ a note on TWO shelves is out of the inbox once, not twice', () => {
    const i = index(
      [
        ['a', '2026-09-02'],
        ['b', '2026-09-01'],
      ],
      [
        ['a', work],
        ['a', phil],
      ],
    );
    expect(idsInView(i, null)).toEqual(['b']);
  });

  it('is empty when everything has been filed — the one empty state that is an achievement', () => {
    const i = index([['a', '2026-09-01']], [['a', work]]);
    expect(idsInView(i, null)).toEqual([]);
  });
});

describe('idsInView — a pressed shelf', () => {
  it('is that shelf’s members and nothing else', () => {
    const i = index(
      [
        ['a', '2026-09-03'],
        ['b', '2026-09-02'],
        ['c', '2026-09-01'],
      ],
      [
        ['a', work],
        ['c', phil],
      ],
    );
    expect(idsInView(i, work)).toEqual(['a']);
    expect(idsInView(i, phil)).toEqual(['c']);
  });

  it('⚠ finds a note that sits on this shelf AND another one', () => {
    const i = index(
      [['a', '2026-09-01']],
      [
        ['a', work],
        ['a', phil],
      ],
    );
    expect(idsInView(i, work)).toEqual(['a']);
    expect(idsInView(i, phil)).toEqual(['a']);
  });

  it('is empty for a shelf nothing has been filed to', () => {
    const i = index([['a', '2026-09-01']], []);
    // ⚠ The room turns this into `.in('id', [<a uuid that cannot exist>])`
    // rather than `.in('id', [])` — PostgREST drops an empty filter and would
    // answer "nothing on this shelf" with the entire pile.
    expect(idsInView(i, work)).toEqual([]);
  });
});
