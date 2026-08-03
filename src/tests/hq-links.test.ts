// The one seam with the corpus (12 · Piece 3).
//
// `sharedFor` is driven against a fake PostgREST rather than a database,
// because the two things worth pinning are both pure shape decisions that a
// live drive can only observe indirectly:
//
//  · THE TWO-HOP PATH. A work's fragments are resolved AT READ TIME, from
//    `fragments.work_id` — never stored on the link. That is the whole reason
//    §5 routes through `works` instead of tagging each quote: link the book
//    once and a quote added three years later appears on its own. A test that
//    seeded rows and read them back would pass either way.
//  · THE DEDUP RULE. A fragment reachable BOTH ways — directly linked and
//    carried by its work — must appear exactly once, and the direct link's
//    NOTE must survive being folded into the work group. Getting this wrong
//    reads as a rendering bug and silently loses the note.
import { describe, expect, it } from 'vitest';
import { sharedFor } from '../lib/hq/links';

type Row = Record<string, unknown>;

/**
 * The smallest thing that answers the chains `sharedFor` actually builds.
 *
 * Every filter is a no-op except the ones the function relies on, and that is
 * deliberate: this is a shape harness, not a Postgres emulator. Getting the
 * filtering "right" here would only mean testing the fake.
 */
function fakeDb(tables: Record<string, Row[]>) {
  const builder = (rows: Row[]) => {
    const self: Record<string, unknown> = {
      select: () => self,
      eq: (col: string, val: unknown) => builder(rows.filter((r) => r[col] === val)),
      in: (col: string, vals: unknown[]) => builder(rows.filter((r) => vals.includes(r[col] as never))),
      is: (col: string, val: unknown) => builder(rows.filter((r) => (r[col] ?? null) === val)),
      order: () => self,
      then: (resolve: (v: { data: Row[] }) => unknown) => resolve({ data: rows }),
    };
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => builder(tables[t] ?? []) } as any;
}

const PERSON = 'p1';
const quote = (id: string, body: string, work_id: string | null = null) => ({
  id,
  slug: id,
  type: 'quote',
  title: null,
  body,
  attribution: 'Somebody',
  status: 'published',
  work_id,
  deleted_at: null,
});

describe('sharedFor — the two-hop path', () => {
  it('resolves a linked work’s fragments at read time, from work_id', async () => {
    const shared = await sharedFor(
      fakeDb({
        person_works: [{ note: 'recommended', created_at: '1', person_id: PERSON, works: { id: 'w1', slug: 'w-1', title: 'Piranesi', kind: 'book', year: 2020, authors: { name: 'Susanna Clarke' } } }],
        person_fragments: [],
        // NOTHING links these two quotes to the person. They belong to the
        // work, and that is the entire mechanism.
        fragments: [quote('f1', 'The first line.', 'w1'), quote('f2', 'The second.', 'w1'), quote('f3', 'Not from that book.', 'w2')],
      }),
      PERSON,
    );

    expect(shared.works).toHaveLength(1);
    expect(shared.works[0].title).toBe('Piranesi');
    expect(shared.works[0].authorName).toBe('Susanna Clarke');
    expect(shared.works[0].note).toBe('recommended');
    expect(shared.works[0].fragments.map((f) => f.label)).toEqual(['The first line.', 'The second.']);
    // A different work's quote does not leak in.
    expect(shared.works[0].fragments.map((f) => f.id)).not.toContain('f3');
  });

  it('reports a linked work with nothing in the corpus yet, rather than hiding it', async () => {
    const shared = await sharedFor(
      fakeDb({
        person_works: [{ note: null, created_at: '1', person_id: PERSON, works: { id: 'w1', slug: 'w-1', title: 'Piranesi', kind: null, year: null, authors: null } }],
        person_fragments: [],
        fragments: [],
      }),
      PERSON,
    );
    // The link is real and correct; the corpus simply has not caught up. That
    // is the state the link exists FOR, so it must count as a row.
    expect(shared.works[0].fragments).toEqual([]);
    expect(shared.count).toBe(1);
  });

  it('keeps a direct edge that no work can reach', async () => {
    const shared = await sharedFor(
      fakeDb({
        person_works: [],
        person_fragments: [{ note: 'sent me this', created_at: '1', person_id: PERSON, fragments: quote('s1', 'A song, no book behind it.') }],
        fragments: [],
      }),
      PERSON,
    );
    expect(shared.fragments).toHaveLength(1);
    expect(shared.fragments[0].note).toBe('sent me this');
    expect(shared.count).toBe(1);
  });
});

describe('sharedFor — a fragment reachable both ways', () => {
  const both = () =>
    fakeDb({
      person_works: [{ note: null, created_at: '1', person_id: PERSON, works: { id: 'w1', slug: 'w-1', title: 'Piranesi', kind: null, year: null, authors: null } }],
      person_fragments: [{ note: 'she said this one out loud', created_at: '2', person_id: PERSON, fragments: quote('f1', 'The first line.', 'w1') }],
      fragments: [quote('f1', 'The first line.', 'w1')],
    });

  it('shows it exactly once', async () => {
    const shared = await sharedFor(both(), PERSON);
    expect(shared.works[0].fragments.map((f) => f.id)).toEqual(['f1']);
    // NOT repeated under a loose heading — the same row twice reads as a
    // rendering bug, and there is no third place for it to have gone.
    expect(shared.fragments).toEqual([]);
    expect(shared.count).toBe(1);
  });

  it('carries the direct link’s note up onto the row inside the work', async () => {
    const shared = await sharedFor(both(), PERSON);
    // Dropping the duplicate must not drop what only the duplicate carried.
    expect(shared.works[0].fragments[0].note).toBe('she said this one out loud');
  });
});

describe('sharedFor — the trash rule', () => {
  it('drops a trashed fragment from the shelf', async () => {
    const trashed = { ...quote('s1', 'Gone to the trash.'), deleted_at: '2026-08-01T00:00:00Z' };
    const shared = await sharedFor(
      fakeDb({
        person_works: [],
        person_fragments: [{ note: null, created_at: '1', person_id: PERSON, fragments: trashed }],
        fragments: [],
      }),
      PERSON,
    );
    // It is not on your shelf, and rendering it there would make the profile
    // disagree with the fragment manager. The LINK row survives in the database
    // so a restore restores the attribution — that half is asserted live.
    expect(shared.fragments).toEqual([]);
    expect(shared.count).toBe(0);
  });
});

describe('sharedFor — labels', () => {
  it('uses the words for a quote and the title for anything else', async () => {
    const shared = await sharedFor(
      fakeDb({
        person_works: [],
        person_fragments: [
          { note: null, created_at: '2', person_id: PERSON, fragments: { ...quote('f1', 'The words themselves.') } },
          { note: null, created_at: '1', person_id: PERSON, fragments: { ...quote('f2', 'annotation'), type: 'song', title: 'Hush' } },
        ],
        fragments: [],
      }),
      PERSON,
    );
    expect(shared.fragments.map((f) => f.label)).toEqual(['The words themselves.', 'Hush']);
  });

  it('strips the Markdown that would otherwise render as punctuation in a one-line label', async () => {
    const shared = await sharedFor(
      fakeDb({
        person_works: [],
        person_fragments: [{ note: null, created_at: '1', person_id: PERSON, fragments: quote('f1', '> *A quoted, emphasised*\n> line') }],
        fragments: [],
      }),
      PERSON,
    );
    // The shelf row is one line of text, not a rendered document — leaving the
    // syntax in shows literal asterisks and angle brackets to the reader.
    expect(shared.fragments[0].label).toBe('A quoted, emphasised line');
  });
});
