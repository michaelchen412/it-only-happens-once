// The calendar's union (13 · Piece 4, §5).
//
// ⚠ WHAT THESE GUARD IS AN ORDERING AND A REFUSAL, and both are the kind of
// thing that reads fine and is wrong on the page. A day's items come from four
// places and have to arrive in one order; and the legend must not key a source
// that has nothing in it, which is 10-hq.md §10b applied to the one piece of
// chrome §5 says earns itself.
import { describe, expect, it } from 'vitest';
import { KINDS, byDay, byTime, legendFor, type CalendarItem } from '../lib/hq/calendar';

const item = (over: Partial<CalendarItem> & { kind: CalendarItem['kind']; title: string }): CalendarItem => ({
  id: over.title,
  on: '2026-08-19',
  at: null,
  ...over,
});

describe('byTime', () => {
  it('⚠ puts all-day things first, then the clock', () => {
    // A birthday is not at 9am — it is a fact about the whole day, and sorting
    // it after a 7pm dinner because it has no time would read as a mistake.
    const day = [
      item({ kind: 'event', title: 'Dinner', at: '19:00' }),
      item({ kind: 'task', title: 'Call the bank', at: null }),
      item({ kind: 'birthday', title: 'Rosalind' }),
      item({ kind: 'event', title: 'Drive to Tahoe', at: null }),
      item({ kind: 'event', title: 'Haircut', at: '09:30' }),
    ];
    expect([...day].sort(byTime).map((i) => i.title)).toEqual([
      'Rosalind', // not a row anywhere, and true of the whole day
      'Drive to Tahoe', // all-day event
      'Haircut', // 09:30
      'Dinner', // 19:00
      // A task with no time does not claim a slot in the day — the same reading
      // the tasks room takes of `anytime`.
      'Call the bank',
    ]);
  });

  it('breaks a tie by title, so the order never depends on the query', () => {
    const day = [
      item({ kind: 'event', title: 'Zebra', at: '10:00' }),
      item({ kind: 'event', title: 'Apple', at: '10:00' }),
    ];
    expect([...day].sort(byTime).map((i) => i.title)).toEqual(['Apple', 'Zebra']);
  });
});

describe('byDay', () => {
  it('groups by local date and sorts each day', () => {
    const map = byDay([
      item({ kind: 'event', title: 'Late', on: '2026-08-19', at: '18:00' }),
      item({ kind: 'event', title: 'Early', on: '2026-08-19', at: '08:00' }),
      item({ kind: 'task', title: 'Elsewhere', on: '2026-08-20' }),
    ]);
    expect(map.get('2026-08-19')!.map((i) => i.title)).toEqual(['Early', 'Late']);
    expect(map.get('2026-08-20')!.map((i) => i.title)).toEqual(['Elsewhere']);
    expect(map.has('2026-08-21')).toBe(false);
  });
});

describe('legendFor', () => {
  it('⚠ never keys a source with nothing in it', () => {
    // §5 calls the legend the one piece of chrome that earns itself — because
    // four sources on one grid is ambiguous. A key for a source that is not
    // there is the opposite: it names a feature that does not exist. Until the
    // Google mirror lands, nothing says anything is mirrored.
    const legend = legendFor([item({ kind: 'event', title: 'Dinner' }), item({ kind: 'task', title: 'Rent' })]);
    expect(legend.map((l) => l.kind)).toEqual(['event', 'task']);
    expect(legend.map((l) => l.label)).not.toContain('Mirrored');
  });

  it('keys them in a fixed order, whatever order the rows arrived in', () => {
    const legend = legendFor([
      item({ kind: 'birthday', title: 'Devi' }),
      item({ kind: 'task', title: 'Rent' }),
      item({ kind: 'event', title: 'Dinner' }),
    ]);
    expect(legend.map((l) => l.kind)).toEqual(['event', 'task', 'birthday']);
  });

  it('says nothing at all about an empty month', () => {
    expect(legendFor([])).toEqual([]);
  });
});

describe('the authority table', () => {
  it('⚠ marks exactly the two sources HQ can write', () => {
    // `writable` is not decoration: it decides the cursor, the hover, the lock,
    // and whether the day panel offers a verb or nothing at all. A mirrored row
    // that ever became writable would mean HQ editing a copy of something that
    // lives in Google — the two-way sync ADR-0010 paid to delete.
    expect(KINDS.event.writable).toBe(true);
    expect(KINDS.task.writable).toBe(true);
    expect(KINDS.mirror.writable).toBe(false);
    // A birthday is not a row anywhere, so it is not read-only — it is
    // unwritable in principle.
    expect(KINDS.birthday.writable).toBe(false);
  });
});
