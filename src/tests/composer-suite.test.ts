// `src/lib/composer-suite.ts` — how the composer shapes what is placed.
//
// ⚠ THIS FILE IS THE REASON THE MOVE WAS WORTH DOING (plan 38 · §6.2). The
// shaping lived in `pages/admin/constellations/[id].astro`'s frontmatter, and a
// page template is not reachable from vitest — so the three decisions below,
// each of which has a stated rule behind it, could only ever be checked by
// driving a browser and looking.
import { describe, it, expect } from 'vitest';
import { buildSuite, suiteStats, elsewhereCounts } from '../lib/composer-suite';

const frag = (over: Record<string, unknown> = {}) => ({
  fragments: {
    id: 'f1',
    type: 'writing',
    slug: 'a-piece',
    title: 'A piece',
    body: 'Some words.',
    excerpt: null,
    attribution: null,
    source_url: null,
    status: 'published',
    occurred_at: '2026-01-01T00:00:00Z',
    updated_at: null,
    date_precision: 'day',
    details: null,
    author_id: null,
    work_id: null,
    authors: null,
    works: null,
    fragment_subjects: [],
    ...over,
  },
});

describe('buildSuite — the editor payload', () => {
  it('gives a WRITING no editor data, because it opens the composer instead', () => {
    // The rule from the page: writing edits in `WritingSheet`, which loads its
    // own document. A payload here would be a second source for the same words.
    const [row] = buildSuite([frag()], [], 'c1');
    expect(row.editorData).toBeNull();
  });

  it('gives a QUOTE the payload FragmentSheet opens on', () => {
    const [row] = buildSuite([frag({ id: 'q1', type: 'quote', body: 'The words.', attribution: 'Someone' })], [], 'c1');
    const data = JSON.parse(row.editorData!);
    expect(data.id).toBe('q1');
    expect(data.attribution).toBe('Someone');
    // The sheet's TagInput wants a comma-joined string, not the {name, slug}
    // pairs the public renderer links with — the page holds both shapes and
    // handing the wrong one to the sheet is silent.
    expect(typeof data.subjects).toBe('string');
  });

  it('carries the constellations a fragment is already in, so the picker opens ticked', () => {
    const links = [
      { fragment_id: 'f1', constellation_id: 'c1' },
      { fragment_id: 'f1', constellation_id: 'c2' },
    ];
    const [row] = buildSuite([frag({ type: 'quote' })], links, 'c1');
    expect(JSON.parse(row.editorData!).constellationIds.sort()).toEqual(['c1', 'c2']);
  });
});

describe('buildSuite — the Read view stanza', () => {
  it('renders a quote as a quote stanza', () => {
    const [row] = buildSuite([frag({ type: 'quote', body: 'The words.' })], [], 'c1');
    expect(row.read.kind).toBe('quote');
  });

  it('⚠ renders a SONG as writing rather than crashing (ADR 0031)', () => {
    // A song is never a suite stanza and `constellations.place` refuses one, so
    // a song reaching here is a row that predates the rule. The page's stated
    // choice is a visible oddity in the composer over a crash on the very page
    // you would use to remove it.
    const [row] = buildSuite([frag({ type: 'song', title: 'A song' })], [], 'c1');
    expect(row.read.kind).toBe('writing');
  });

  it('prefers an authored excerpt over a derived one', () => {
    const authored = 'The line he chose himself.';
    const [row] = buildSuite([frag({ excerpt: authored, body: 'A much longer body that would be cut.' })], [], 'c1');
    expect(row.read.kind === 'writing' && row.read.item.excerpt).toBe(authored);
  });
});

describe('suiteStats — what counts as a draft', () => {
  it('⚠ counts a NOTE as a draft, because the question is what a stranger sees', () => {
    // `getConstellation` filters to published, so anything else is invisible out
    // there whatever the workshop calls it. Getting this wrong makes the public
    // shape hint quietly optimistic — the one direction it must not fail in.
    const suite = buildSuite([frag({ id: 'a', status: 'published' }), frag({ id: 'b', status: 'note' })], [], 'c1');
    expect(suiteStats(suite).draftCount).toBe(1);
  });

  it('counts the spread over distinct subjects, not over rows', () => {
    const s = (name: string) => ({ subjects: { name, slug: name } });
    const suite = buildSuite(
      [
        frag({ id: 'a', fragment_subjects: [s('love'), s('death')] }),
        frag({ id: 'b', fragment_subjects: [s('love')] }),
      ],
      [],
      'c1',
    );
    expect(suiteStats(suite).subjectSpread).toBe(2);
  });

  it('hands the Reader only the writings, with their full text', () => {
    const suite = buildSuite([frag({ id: 'a' }), frag({ id: 'q', type: 'quote', body: 'Words.' })], [], 'c1');
    const { readerWritings } = suiteStats(suite);
    expect(readerWritings).toHaveLength(1);
    expect(readerWritings[0].bodyMarkdown).toBe('Some words.');
  });
});

describe('elsewhereCounts — the ✦×n hint', () => {
  it('counts the OTHER constellations only, never this one', () => {
    const links = [
      { fragment_id: 'f1', constellation_id: 'c1' },
      { fragment_id: 'f1', constellation_id: 'c2' },
      { fragment_id: 'f1', constellation_id: 'c3' },
    ];
    // Including the current one would make every placed row claim one more home
    // than it has — a badge that is wrong on every fragment in the room.
    expect(elsewhereCounts(links, 'c1').get('f1')).toBe(2);
  });

  it('is silent about a fragment that lives only here', () => {
    expect(elsewhereCounts([{ fragment_id: 'f1', constellation_id: 'c1' }], 'c1').get('f1')).toBeUndefined();
  });
});
