// `listSets` — the Listening room's one read, and the shape of its failure.
//
// ⚠ THE SAME CLASS `sky-list.test.ts` WAS WRITTEN FOR, found by looking for it
// (2026-08-27). A failed read returned `[]`, `/listening` rendered "Nothing here
// yet." — indistinguishable from a room genuinely waiting to be filled — and
// handed that page to the CDN for a minute with a day of
// `stale-while-revalidate` behind it. This read was also one of the two public
// ones with no `noted()` on it at all, so the failure it degraded from left no
// line anywhere to disagree with the page.
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from './stubs/supabase';
import { listSets } from '../lib/sets';

describe('listSets — a failed read is not an empty room', () => {
  it('answers null when the read failed, and says so in the log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = fakeDb({ sets: { data: null, error: { message: 'JWT expired', code: 'PGRST301' } } });
    try {
      await expect(listSets(db)).resolves.toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain('listening: sets');
    } finally {
      spy.mockRestore();
    }
  });

  it('answers [] — not null — when the room really is empty', async () => {
    // The direction that keeps the room cacheable before the first set exists.
    await expect(listSets(fakeDb({ sets: { data: [] } }))).resolves.toEqual([]);
  });

  it('asks only for published sets, so a draft cannot reach the public room', async () => {
    // ⚠ The filter this pins is explicit rather than left to RLS, and the file
    // says why: it exists for the ONE signed-in reader, for whom a draft on a
    // public URL would be invisible. Reading session-free now makes that true
    // by construction — this keeps the belt on with the braces.
    const db = fakeDb({ sets: { data: [] } }, { record: true });
    await listSets(db.client);
    expect(db.ops('sets')).toContainEqual({ method: 'eq', args: ['status', 'published'] });
  });
});
