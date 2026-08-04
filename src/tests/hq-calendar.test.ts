// The calendar's union (13 · Piece 4, §5).
//
// ⚠ WHAT THESE GUARD IS AN ORDERING AND A REFUSAL, and both are the kind of
// thing that reads fine and is wrong on the page. A day's items come from four
// places and have to arrive in one order; and the legend must not key a source
// that has nothing in it, which is 10-hq.md §10b applied to the one piece of
// chrome §5 says earns itself.
import { describe, expect, it } from 'vitest';
import { KINDS, birthdayItem, byDay, byTime, eventItem, legendFor, type CalendarItem } from '../lib/hq/calendar';

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

// ── the item builders (plans/00-groundwork.md · Piece 4) ────────────────────
// Extracted 2026-08-04 from two pages that had each written them out. What is
// worth pinning is the `event_people` unwrapping — a two-level embed whose
// inner side is nullable, which is exactly the shape that reads fine and throws
// on the one event whose guest was deleted.
describe('eventItem', () => {
  const row = {
    id: 'e1',
    starts_on: '2026-08-19',
    starts_at: '19:30:00',
    ends_at: '21:00:00',
    title: 'Dinner',
    location: 'Bar Tartine',
    notes: 'book a table',
  };

  it('trims wall-clock times to HH:MM — seconds are noise on a grid', () => {
    const it_ = eventItem(row);
    expect(it_.at).toBe('19:30');
    expect(it_.endAt).toBe('21:00');
  });

  it('is all-day when there is no start time', () => {
    expect(eventItem({ ...row, starts_at: null, ends_at: null }).at).toBeNull();
  });

  it('names whoever is tagged, and drops a tag whose person is gone', () => {
    const item_ = eventItem({
      ...row,
      event_people: [
        { people: { id: 'p1', display_name: 'Ada' } },
        { people: null },
        { people: { id: 'p2', display_name: 'Grace' } },
      ],
    });
    expect(item_.people).toEqual([
      { id: 'p1', name: 'Ada' },
      { id: 'p2', name: 'Grace' },
    ]);
  });

  it('has no people and no door when nothing is embedded', () => {
    const item_ = eventItem(row);
    expect(item_.people).toEqual([]);
    // ⚠ Routing belongs to the page — Today sends an event to the day panel,
    // the calendar is already there. A default here would be one of them wrong.
    expect(item_.href).toBeUndefined();
  });
});

describe('birthdayItem', () => {
  it('is an all-day item on the date it was resolved to', () => {
    const item_ = birthdayItem({ id: 'p1', display_name: 'Ada' }, '2026-11-02');
    expect(item_).toMatchObject({ kind: 'birthday', id: 'p1', title: 'Ada', on: '2026-11-02', at: null });
  });

  it('carries the PERSON’s id, because a birthday is not a row', () => {
    // 12-people.md §8: derived from birth_month/birth_day. The only id it could
    // carry is the person's, and the only door it can offer leads to them.
    expect(birthdayItem({ id: 'p9', display_name: 'Grace' }, '2026-01-01').id).toBe('p9');
  });
});
