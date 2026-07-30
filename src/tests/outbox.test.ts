// The outbox is the durability layer under the writing editor
// (docs/plans/09 Piece 1): these tests pin the properties the editor relies
// on — one entry per fragment, revisions detect racing writes, conflicts
// wait for a human, drain never drops words on failure.
import { describe, it, expect, beforeEach } from 'vitest';
import * as outbox from '../scripts/outbox';

const FIELDS = { title: 'Four offline hours', body: 'are four hours at risk' };
const NEWER = { title: 'Four offline hours', body: 'are now mere delay' };

beforeEach(async () => {
  await outbox.__resetForTests();
});

describe('put', () => {
  it('creates a pending entry at rev 1', async () => {
    const e = await outbox.put('a', FIELDS, 'auto');
    expect(e).toMatchObject({ id: 'a', fields: FIELDS, kind: 'auto', state: 'pending', rev: 1 });
    expect(await outbox.get('a')).toMatchObject({ rev: 1 });
  });

  it('overwrites in place — one entry per fragment, rev increments', async () => {
    await outbox.put('a', FIELDS, 'auto');
    await outbox.put('a', NEWER, 'auto');
    const all = await outbox.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ fields: NEWER, rev: 2 });
  });

  it('never downgrades auto to manual — push intent survives new keystrokes', async () => {
    await outbox.put('a', FIELDS, 'auto'); // an explicit save queued offline…
    const e = await outbox.put('a', NEWER, 'manual'); // …then passive typing on the published piece
    expect(e.kind).toBe('auto');
    expect((await outbox.get('a'))!.kind).toBe('auto');
  });

  it('upgrades manual to auto when explicit intent arrives', async () => {
    await outbox.put('a', FIELDS, 'manual');
    expect((await outbox.put('a', NEWER, 'auto')).kind).toBe('auto');
  });

  it('fresh words supersede a stale conflict mark', async () => {
    await outbox.put('a', FIELDS, 'auto');
    await outbox.markConflict('a');
    expect((await outbox.get('a'))!.state).toBe('conflict');
    await outbox.put('a', NEWER, 'auto');
    expect((await outbox.get('a'))!.state).toBe('pending');
  });
});

describe('confirmSent', () => {
  it('removes the entry when the sent rev is still current', async () => {
    const e = await outbox.put('a', FIELDS, 'auto');
    await outbox.confirmSent('a', e.rev);
    expect(await outbox.get('a')).toBeUndefined();
  });

  it('keeps the entry when newer words landed during the send', async () => {
    const sent = await outbox.put('a', FIELDS, 'auto');
    await outbox.put('a', NEWER, 'auto'); // typing continued mid-flight
    await outbox.confirmSent('a', sent.rev);
    expect(await outbox.get('a')).toMatchObject({ fields: NEWER, rev: 2 });
  });
});

describe('drain', () => {
  it('pushes pending auto entries and removes them on success', async () => {
    await outbox.put('a', FIELDS, 'auto');
    await outbox.put('b', NEWER, 'auto');
    const pushed: string[] = [];
    const summary = await outbox.drain(async (e) => {
      pushed.push(e.id);
      return 'done';
    });
    expect(pushed.sort()).toEqual(['a', 'b']);
    expect(summary).toEqual({ pushed: 2, conflicts: 0, remaining: 0 });
    expect(await outbox.all()).toHaveLength(0);
  });

  it('never pushes manual (published-snapshot) entries', async () => {
    await outbox.put('a', FIELDS, 'manual');
    const summary = await outbox.drain(async () => 'done');
    expect(summary).toEqual({ pushed: 0, conflicts: 0, remaining: 0 });
    expect(await outbox.get('a')).toBeDefined(); // still there for restore
  });

  it('skips entries already marked conflict', async () => {
    await outbox.put('a', FIELDS, 'auto');
    await outbox.markConflict('a');
    let calls = 0;
    await outbox.drain(async () => {
      calls++;
      return 'done';
    });
    expect(calls).toBe(0);
    expect(await outbox.get('a')).toBeDefined();
  });

  it('marks conflicts reported by the push and keeps the words', async () => {
    await outbox.put('a', FIELDS, 'auto');
    const summary = await outbox.drain(async () => 'conflict');
    expect(summary).toEqual({ pushed: 0, conflicts: 1, remaining: 0 });
    expect(await outbox.get('a')).toMatchObject({ state: 'conflict', fields: FIELDS });
  });

  it('keeps entries on retry and on a throwing push', async () => {
    await outbox.put('a', FIELDS, 'auto');
    await outbox.put('b', NEWER, 'auto');
    const summary = await outbox.drain(async (e) => {
      if (e.id === 'a') return 'retry';
      throw new Error('network died');
    });
    expect(summary).toEqual({ pushed: 0, conflicts: 0, remaining: 2 });
    expect(await outbox.all()).toHaveLength(2);
  });

  it('keeps an entry whose words were superseded mid-push', async () => {
    await outbox.put('a', FIELDS, 'auto');
    const summary = await outbox.drain(async () => {
      await outbox.put('a', NEWER, 'auto'); // a keystroke lands during the send
      return 'done';
    });
    expect(summary.pushed).toBe(1);
    // The newer words must survive for the next drain.
    expect(await outbox.get('a')).toMatchObject({ fields: NEWER, rev: 2, state: 'pending' });
    expect(summary.remaining).toBe(1);
  });
});
