// The blog rail's faceting — `listSubjects`, the function that decides which
// subject tags are offered and what number each one carries.
//
// ⚠ THE RAIL'S NUMBERS ARE A PROMISE, AND A WRONG ONE FAILS SILENTLY. Every tag
// says "add me and N results remain", and nothing in a browser reports it when
// that is false — the tag renders, the click lands, and the reader gets an empty
// feed with no explanation and no way to tell a bug from an empty corpus. The
// author filter shipped without being counted here and did exactly that: 13 of
// the quote taxonomy's 18 tags stayed clickable under `?author=seneca`, each
// showing a corpus-wide count, each a dead end.
//
// The stub fakes the builder rather than the database (see `stubs/supabase.ts`),
// so these fixtures are the rows the query WOULD return — which is the right
// half to pin, because the narrowing that broke is arithmetic in TypeScript, not
// a `.eq()`.
import { describe, expect, it } from 'vitest';
import { listSubjects } from '../lib/blog';
import { fakeDb } from './stubs/supabase';

/** One `fragment_subjects` row, shaped as the embed returns it. */
function link(fragmentId: string, subject: string, author: string | null) {
  return {
    fragment_id: fragmentId,
    subjects: { name: subject, slug: subject },
    fragments: { type: 'quote', status: 'published', deleted_at: null, authors: author ? { slug: author } : null },
  };
}

// Two authors, one unattributed quote, four subjects.
//   q1 seneca   death, time      q3 marcus   time
//   q2 seneca   death            q4 (none)   grief, time
const LINKS = [
  link('q1', 'death', 'seneca'),
  link('q1', 'time', 'seneca'),
  link('q2', 'death', 'seneca'),
  link('q3', 'time', 'marcus'),
  link('q4', 'grief', null),
  link('q4', 'time', null),
];

const db = (rows = LINKS, matches?: { id: string }[]) =>
  fakeDb({ fragment_subjects: { data: rows }, fragments: { data: matches ?? [] } });

const bySlug = (rail: Awaited<ReturnType<typeof listSubjects>>) => new Map(rail.map((s) => [s.slug, s]));

describe('listSubjects — the unfiltered taxonomy', () => {
  it('counts the whole corpus and offers everything in it', async () => {
    const rail = bySlug(await listSubjects(db(), 'quote'));
    expect(rail.get('time')).toMatchObject({ total: 3, count: 3, disabled: false });
    expect(rail.get('death')).toMatchObject({ total: 2, count: 2, disabled: false });
    expect(rail.get('grief')).toMatchObject({ total: 1, count: 1, disabled: false });
  });
});

describe('listSubjects — the author narrows it', () => {
  it('counts only that author’s fragments', async () => {
    const rail = bySlug(await listSubjects(db(), 'quote', { author: 'seneca' }));
    // Seneca: death twice, time once — not the corpus's 2 and 3.
    expect(rail.get('death')!.count).toBe(2);
    expect(rail.get('time')!.count).toBe(1);
  });

  it('disables the tags that author never used', async () => {
    const rail = bySlug(await listSubjects(db(), 'quote', { author: 'seneca' }));
    // THE BUG THIS FILE EXISTS FOR: `grief` belongs to a quote that is not
    // Seneca's, so offering it is offering an empty feed.
    expect(rail.get('grief')).toMatchObject({ count: 0, disabled: true });
  });

  it('keeps the ordering global, so tags do not reshuffle under a filter', async () => {
    const all = (await listSubjects(db(), 'quote')).map((s) => s.slug);
    const seneca = (await listSubjects(db(), 'quote', { author: 'seneca' })).map((s) => s.slug);
    // Same list, same order — only the numbers changed. A rail that re-sorted
    // itself would make the reader re-find every tag on arrival.
    expect(seneca).toEqual(all);
  });

  it('keeps `total` global while `count` goes local', async () => {
    const rail = bySlug(await listSubjects(db(), 'quote', { author: 'seneca' }));
    expect(rail.get('time')).toMatchObject({ total: 3, count: 1 });
  });

  it('matches nothing for an unknown author, rather than silently ignoring it', async () => {
    // `listQuotes` returns an empty feed for a slug no row carries; the rail has
    // to agree, or a typo shows a full taxonomy over no results.
    const rail = await listSubjects(db(), 'quote', { author: 'nobody' });
    expect(rail).toHaveLength(3);
    expect(rail.every((s) => s.count === 0 && s.disabled)).toBe(true);
  });

  it('never matches a quote filed with no author row', async () => {
    // `grief` is only on the unattributed quote, so no author filter can reach
    // it — the facet is the author FACT, never the derived attribution line.
    for (const who of ['seneca', 'marcus']) {
      const rail = bySlug(await listSubjects(db(), 'quote', { author: who }));
      expect(rail.get('grief')!.count).toBe(0);
    }
  });

  it('treats an empty author string as no filter at all', async () => {
    const rail = bySlug(await listSubjects(db(), 'quote', { author: '  ' }));
    expect(rail.get('grief')!.count).toBe(1);
  });
});

describe('listSubjects — the filters AND together', () => {
  it('stacks the author with a selected subject', async () => {
    const rail = bySlug(await listSubjects(db(), 'quote', { author: 'seneca', selected: ['death'] }));
    // Seneca's death quotes are q1 and q2; only q1 also carries `time`.
    expect(rail.get('death')!.count).toBe(2);
    expect(rail.get('time')!.count).toBe(1);
    expect(rail.get('grief')).toMatchObject({ count: 0, disabled: true });
  });

  it('leaves a selected tag clickable even when the stack empties it', async () => {
    // Otherwise the filter that produced the empty feed is the one control the
    // reader cannot undo.
    const rail = bySlug(await listSubjects(db(), 'quote', { author: 'marcus', selected: ['grief'] }));
    expect(rail.get('grief')).toMatchObject({ selected: true, count: 0, disabled: false });
  });

  it('stacks the author with the search term', async () => {
    // The search query returns q1 only; intersected with Seneca that is still q1.
    const rail = bySlug(await listSubjects(db(LINKS, [{ id: 'q1' }]), 'quote', { author: 'seneca', q: 'mortal' }));
    expect(rail.get('death')!.count).toBe(1);
    expect(rail.get('time')!.count).toBe(1);
    expect(rail.get('grief')).toMatchObject({ count: 0, disabled: true });
  });

  it('empties the rail when the term and the author disagree', async () => {
    const rail = await listSubjects(db(LINKS, [{ id: 'q3' }]), 'quote', { author: 'seneca', q: 'mortal' });
    expect(rail.every((s) => s.count === 0 && s.disabled)).toBe(true);
  });
});
