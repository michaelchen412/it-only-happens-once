// Today, assembled (13 · Piece 5, §6; 10-hq.md §10c and §10f).
//
// ⚠ WHAT THESE GUARD IS THE PAGE'S TEMPERAMENT, and every one of them can fail
// in the direction that turns HQ into the thing 10-hq.md §3 forbids. This is the
// surface opened every morning, sometimes on a bad one, and the rules below are
// the difference between a page that tells you what your day is and a page that
// tells you what you have not done:
//
//  · `announces` decides how far ahead something shows. There is no window
//    setting anywhere in the feature, which is exactly what makes it testable:
//    the answer is a function of the item, not of a dial.
//  · `progressLabel` counts what you DID. `0 of 3 done` at 7am is the arrears
//    count wearing a different hat, and it is one `>=` away at all times.
//  · `publishedSignal` has drift's cold-start guard in it, and the real data
//    says its first reading will be "3 years ago" — so the thing worth pinning
//    is that it stays quiet rather than becoming loud as it recedes.
import { describe, expect, it } from 'vitest';
import type { CalendarItem } from '../lib/hq/calendar';
import {
  PAST_DUE_CAP,
  PRACTICE_COLD_DAYS,
  announces,
  byDayThenTime,
  progressLabel,
  publishedSignal,
} from '../lib/hq/today';
import type { Ymd } from '../lib/hq/time';

const TODAY = '2026-08-03' as Ymd;

const task = (over: Partial<Parameters<typeof announces>[0]> = {}) => ({
  due_on: null,
  effort: 'sitting' as const,
  priority: 'normal' as const,
  lead_days: null,
  ...over,
});

describe('announces — the lead decides, and nothing else does', () => {
  it('⚠ lets a project speak 21 days out and a quick task the day before', () => {
    // The decomposition in Michael's words: "some things are important but
    // small. I may not need as much time as something that's equally important
    // but takes a long time." How far ahead something appears tracks how much
    // runway you need, which is EFFORT — never priority, and never a window.
    const project = task({ effort: 'project', due_on: '2026-08-24' }); // 21 days
    const quick = task({ effort: 'quick', due_on: '2026-08-24' });
    expect(announces(project, TODAY)).toBe(true);
    expect(announces(quick, TODAY)).toBe(false);

    // …and the quick one arrives on its own day, one out.
    expect(announces(task({ effort: 'quick', due_on: '2026-08-04' }), TODAY)).toBe(true);
  });

  it('says nothing about today or about arrears — those are other zones', () => {
    // Something due today belongs to the day; something past due belongs to the
    // section at the bottom. A task in two zones at once is the bug this
    // boundary exists to prevent.
    expect(announces(task({ effort: 'project', due_on: TODAY }), TODAY)).toBe(false);
    expect(announces(task({ effort: 'project', due_on: '2026-07-30' }), TODAY)).toBe(false);
  });

  it('never shows an undated task, which is the whole point of leaving it undated', () => {
    expect(announces(task({ due_on: null }), TODAY)).toBe(false);
  });

  it('⚠ honours the three lead rules, including the one that must NOT fire', () => {
    // `high` bumps up one bucket: a high-priority sitting gets 7 days, not 3.
    expect(announces(task({ effort: 'sitting', priority: 'high', due_on: '2026-08-09' }), TODAY)).toBe(true);
    expect(announces(task({ effort: 'sitting', priority: 'normal', due_on: '2026-08-09' }), TODAY)).toBe(false);
    // `low` NEVER reduces the lead. Hiding a warning is not a kindness.
    expect(announces(task({ effort: 'block', priority: 'low', due_on: '2026-08-09' }), TODAY)).toBe(true);
    // An explicit lead always wins — it is what plan 14's parser fills when you
    // say "warn me three days in advance".
    expect(announces(task({ effort: 'project', lead_days: 2, due_on: '2026-08-20' }), TODAY)).toBe(false);
    expect(announces(task({ effort: 'quick', lead_days: 30, due_on: '2026-08-20' }), TODAY)).toBe(true);
  });
});

describe('byDayThenTime', () => {
  const item = (
    on: string,
    title: string,
    kind: CalendarItem['kind'] = 'task',
    at: string | null = null,
  ): CalendarItem => ({ kind, id: title, on: on as Ymd, title, at });

  it('sorts by day first, then defers to the day’s own order', () => {
    // The day's order is `byTime` — the calendar's, reused. A birthday is a fact
    // about the whole day, so it leads; an untimed task claims no slot, so it
    // trails. Reimplementing that here would be a second answer to one question.
    const rows = [
      item('2026-08-10', 'Rent'),
      item('2026-08-04', 'Dentist', 'task', '09:00'),
      item('2026-08-04', 'Devi', 'birthday'),
      item('2026-08-04', 'Call the bank'),
    ];
    expect([...rows].sort(byDayThenTime).map((i) => i.title)).toEqual(['Devi', 'Dentist', 'Call the bank', 'Rent']);
  });
});

describe('progressLabel', () => {
  it('⚠ says NOTHING until you have done one', () => {
    // `0 of 3 done` is arithmetic about what you have not done yet, on the one
    // line §10f says must count what you did. This assertion is the difference,
    // and it is one `>=` away at all times.
    expect(progressLabel(0, 3)).toBeNull();
    expect(progressLabel(1, 3)).toBe('1 of 3 done');
    expect(progressLabel(3, 3)).toBe('3 of 3 done');
  });

  it('says nothing at all on a day with no tasks', () => {
    expect(progressLabel(0, 0)).toBeNull();
  });
});

describe('publishedSignal', () => {
  it('⚠ says nothing when nothing was ever published', () => {
    // The cold-start guard, third appearance: drift has it, `observationFor` has
    // it, and it means the same thing every time. With nothing to observe, say
    // nothing — a corpus you have not started is new, not neglected.
    expect(publishedSignal(null, TODAY)).toBeNull();
  });

  it('reads as a duration, and goes QUIETER rather than louder as it recedes', () => {
    expect(publishedSignal('2026-07-25' as Ymd, TODAY)).toEqual({ text: '9 days ago', cold: false });
    // The real data: the newest published essay is 2023-07-12. This is what the
    // zone will actually say on the morning it ships, and it must be a cold
    // line rather than a warning — the moment it turns amber it is a debt.
    expect(publishedSignal('2023-07-12' as Ymd, TODAY)).toEqual({ text: '3 years ago', cold: true });
  });

  it('turns cold exactly at the boundary the goal observation uses', () => {
    // Not an arbitrary number: it is where `observationFor` stops counting in
    // weeks because weeks stop being readable. One threshold, two features.
    const warm = publishedSignal('2026-06-09' as Ymd, TODAY); // 55 days
    const cold = publishedSignal('2026-06-08' as Ymd, TODAY); // 56 days
    expect(warm!.cold).toBe(false);
    expect(cold!.cold).toBe(true);
    expect(PRACTICE_COLD_DAYS).toBe(56);
  });
});

describe('the caps', () => {
  it('⚠ caps arrears at eight — a cap on a LIST, never a hidden section', () => {
    // §10f keeps exactly one guard on a section that is otherwise always open,
    // and it matters which one: eight rows then a door means a bad fortnight
    // cannot become a wall, while nothing is ever concealed behind a click.
    expect(PAST_DUE_CAP).toBe(8);
  });
});
