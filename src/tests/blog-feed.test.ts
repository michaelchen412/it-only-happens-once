// `listWriting` / `listQuotes` — whether the Index's empty feed is an ANSWER or
// a degradation (2026-08-27).
//
// ⚠ THE THIRD FILE IN THIS FAMILY, AND THE ONE WITH THE MOST WAYS TO BE WRONG.
// `sky-list` and `sets-read` each had one read to confuse with an empty result;
// the feed has three, and every one of them returned the same `{ items: [] }`
// whether it had found nothing or found nothing out:
//
//   · the feed query itself
//   · the subject narrowing — `[]` meant "no fragment carries all of these",
//     which is a real and common answer, and also what a failed lookup said
//   · the author lookup — `[]` meant "no such person", said about a name with
//     twenty quotes behind it whenever the read failed
//
// Each of those renders "nothing here yet" under a `public, s-maxage=60,
// stale-while-revalidate=86400` header, which is how a few seconds of trouble
// becomes a day of an emptied blog. `failed` is what the route branches on, so
// these tests are about a cache header as much as they are about a feed.
import { describe, expect, it, vi } from 'vitest';
import { listQuotes, listWriting } from '../lib/blog';
import { fakeDb } from './stubs/supabase';

const boom = { message: 'JWT expired', code: 'PGRST301' };

/** `noted()` speaks on error; these tests are not about the log line. */
const quietly = async <T>(run: () => Promise<T>): Promise<T> => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return await run();
  } finally {
    spy.mockRestore();
  }
};

describe('listWriting — an empty feed that knows why', () => {
  it('flags a failed feed query, so the page is not cached', async () => {
    const feed = await quietly(() => listWriting(fakeDb({ fragments: { data: null, error: boom } })));
    expect(feed.items).toEqual([]);
    expect(feed.failed).toBe(true);
  });

  it('does NOT flag an ordinary empty corpus', async () => {
    // The direction that keeps `/blog` cacheable before the first essay exists.
    const feed = await listWriting(fakeDb({ fragments: { data: [] } }));
    expect(feed).toMatchObject({ items: [], failed: false });
  });

  it('flags a failed subject narrowing rather than calling it an impossible AND', async () => {
    // ⚠ The subtle one. `fragmentIdsForSubjects` answers `[]` for "no fragment
    // carries all of these" — a legitimate result the feed renders empty. A
    // failed lookup answered `[]` too, so `?subject=death&subject=time` on a
    // bad read read as a confident "that combination doesn't exist".
    const feed = await quietly(() =>
      listWriting(fakeDb({ subjects: { data: null, error: boom } }), { subjects: ['death', 'time'] }),
    );
    expect(feed).toMatchObject({ items: [], failed: true });
  });

  it('does NOT flag a genuinely unsatisfiable combination', async () => {
    // Both slugs resolve, no fragment carries both → an honest empty feed.
    const feed = await listWriting(
      fakeDb({
        subjects: {
          data: [
            { id: 's1', slug: 'death' },
            { id: 's2', slug: 'time' },
          ],
        },
        fragment_subjects: { data: [{ fragment_id: 'f1', subject_id: 's1' }] },
      }),
      { subjects: ['death', 'time'] },
    );
    expect(feed).toMatchObject({ items: [], failed: false });
  });
});

describe('listQuotes — the author lookup is its own trapdoor', () => {
  it('flags a failed author lookup instead of reporting nobody by that name', async () => {
    const feed = await quietly(() =>
      listQuotes(fakeDb({ authors: { data: null, error: boom } }), { author: 'seneca' }),
    );
    expect(feed).toMatchObject({ items: [], failed: true });
  });

  it('does NOT flag a genuinely unknown author', async () => {
    // A typo'd `?author=` must stay an honest empty feed — the rule the
    // function's own comment insists on: match nothing rather than drop the
    // filter. It just must not also poison the cache header.
    const feed = await listQuotes(fakeDb({ authors: { data: [] } }), { author: 'nobody' });
    expect(feed).toMatchObject({ items: [], failed: false });
  });

  it('flags a failed quotes query', async () => {
    const feed = await quietly(() => listQuotes(fakeDb({ fragments: { data: null, error: boom } })));
    expect(feed).toMatchObject({ items: [], failed: true });
  });
});
