// Drift (12 · Piece 4).
//
// The one derivation in HQ whose bugs are all of the same kind: they tell you
// something untrue about a person, quietly, on a page you open every morning.
// So the cases below are not edge cases — each is a way the feature turns into
// the wall that 10-hq.md §3 exists to forbid:
//
//  · NO ENTRIES MUST NOT MEAN DRIFT. `last_contact` is null on the day somebody
//    is added, so `now - last > cadence` flags THE ENTIRE ROSTER on creation
//    day. Found by the people lab's provenance audit, by prototyping the query
//    rather than the pixels — a hand-fed prototype had drift as a flag and
//    never showed the bug at all.
//  · THE CADENCE IS PER-PERSON, so the ordering has to be too. Sorting by raw
//    days silently overrides every cadence set by hand.
//  · A MUTE MUST OUTLIVE THE CLICK. Counting "another year" from the last
//    contact instead of from today expires the moment you press it.
//  · AND SINCE 13 · PIECE 4: SEEING SOMEBODY TODAY IS NOT NEGLECT. The
//    interaction will not be logged until tonight at the earliest, so without
//    the guard the panel spends the whole of the one day it is wrong telling
//    you that you have neglected somebody you are about to have dinner with.
import { describe, expect, it } from 'vitest';
import { driftFor, driftList, mutedUntil } from '../lib/hq/drift';
import type { LastContact } from '../lib/hq/interactions';
import { person } from './stubs/person';

const TODAY = '2026-08-03';
const on = (ymd: string): LastContact => ({ on: ymd, count: 1 });

describe('driftFor', () => {
  it('reports somebody past their cadence, with how far past', () => {
    const p = person({ cadence_days: 365 });
    // 2025-07-01 → 2026-08-03 is 398 days.
    expect(driftFor(p, on('2025-07-01'), TODAY)).toMatchObject({ days: 398, over: 33 });
  });

  it('⚠ says nothing about somebody with NO entries — new, not neglected', () => {
    // THE COLD-START BUG. Without this the roster opens with all 25 people
    // flagged on the day it is filled in, which is the wall §3 forbids, on day
    // one. A person you added a year ago and never logged stays silent too:
    // the system genuinely knows nothing about whether you have seen them.
    expect(driftFor(person(), undefined, TODAY)).toBeNull();
  });

  it('says nothing inside the cadence, including on the exact boundary', () => {
    const p = person({ cadence_days: 365 });
    expect(driftFor(p, on('2025-08-03'), TODAY)).toBeNull(); // exactly 365
    expect(driftFor(p, on('2025-08-02'), TODAY)).not.toBeNull(); // 366
  });

  it('respects a shorter personal cadence', () => {
    const p = person({ cadence_days: 90 });
    expect(driftFor(p, on('2026-04-01'), TODAY)).toMatchObject({ over: 34 });
  });

  it('says nothing while muted, and speaks again the day after the mute expires', () => {
    const cold = on('2024-01-01');
    expect(driftFor(person({ drift_muted_until: '2026-08-03' }), cold, TODAY)).toBeNull();
    expect(driftFor(person({ drift_muted_until: '2026-08-04' }), cold, TODAY)).toBeNull();
    // Some relationships genuinely ARE annual; when the year is up, it asks
    // again rather than staying quiet for ever.
    expect(driftFor(person({ drift_muted_until: '2026-08-02' }), cold, TODAY)).not.toBeNull();
  });

  it('says nothing about an archived person', () => {
    // Archiving is the release valve for this indicator (§3) — it would be
    // perverse for the thing you archived them to stop to keep firing.
    const p = person({ archived_at: '2026-01-01T00:00:00Z' });
    expect(driftFor(p, on('2020-01-01'), TODAY)).toBeNull();
  });
});

describe('driftList', () => {
  it('⚠ orders by how far past their OWN cadence, not by raw days', () => {
    const annual = person({ id: 'a', slug: 'annual', cadence_days: 365 });
    const often = person({ id: 'b', slug: 'often', cadence_days: 90 });
    const map = new Map<string, LastContact>([
      ['a', on('2025-07-01')], // 398 days, 33 over a year
      ['b', on('2026-01-01')], // 214 days, 124 over three months
    ]);

    const list = driftList([annual, often], map, TODAY);
    // `often` has the SMALLER number of days and the LARGER drift. Sorting by
    // days would put the annual friend first and quietly override the cadence
    // that was set by hand — which is the only reason the column exists.
    expect(list.map((d) => d.person.id)).toEqual(['b', 'a']);
  });

  it('leaves out everybody who is not drifting, rather than returning them flagged false', () => {
    const fine = person({ id: 'a', slug: 'a' });
    const fresh = person({ id: 'b', slug: 'b' });
    const map = new Map<string, LastContact>([['a', on('2026-08-01')]]);
    // `b` has no entry at all; `a` was seen two days ago.
    expect(driftList([fine, fresh], map, TODAY)).toEqual([]);
  });
});

describe('mutedUntil', () => {
  it('counts a full cadence from TODAY, not from the last contact', () => {
    // Counting from a date already in the past would expire the mute the
    // instant you pressed the button — and it would look like the click had
    // simply not worked.
    expect(mutedUntil({ cadence_days: 365 }, TODAY)).toBe('2027-08-03');
    expect(mutedUntil({ cadence_days: 90 }, TODAY)).toBe('2026-11-01');
  });

  it('crosses a year boundary without arithmetic drift', () => {
    expect(mutedUntil({ cadence_days: 30 }, '2026-12-20')).toBe('2027-01-19');
  });
});

describe('guard 2 — anyone with an event today is never drifting', () => {
  // Carried on the board as an open hole from 2026-08-02 until the `events`
  // table existed, rather than quietly skipped.
  const cold = () => person({ cadence_days: 30 });

  it('⚠ says nothing about somebody you are seeing today', () => {
    const p = cold();
    expect(driftFor(p, on('2026-06-04'), TODAY)).not.toBeNull();
    expect(driftFor(p, on('2026-06-04'), TODAY, new Set([p.id]))).toBeNull();
  });

  it('keeps flagging everybody else on the same page', () => {
    const seeing = cold();
    const not = person({ id: '00000000-0000-4000-8000-00000000beef', cadence_days: 30 });
    const map = new Map([
      [seeing.id, on('2026-06-04')],
      [not.id, on('2026-06-04')],
    ]);
    const list = driftList([seeing, not], map, TODAY, new Set([seeing.id]));
    expect(list.map((d) => d.person.id)).toEqual([not.id]);
  });

  it('behaves exactly as before when a caller has no calendar to ask', () => {
    // The guard is optional so that nothing which called this before had to
    // change — including anything written before the events table existed.
    const p = cold();
    expect(driftFor(p, on('2026-06-04'), TODAY, undefined)).not.toBeNull();
    expect(driftFor(p, on('2026-06-04'), TODAY, new Set())).not.toBeNull();
  });
});
