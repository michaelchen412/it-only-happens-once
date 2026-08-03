// Tasks: the lead rule, the grouping, and what a disposition does (13 · Piece 1,
// §3, §3a, §4; ADR-0013).
//
// ⚠ THESE GUARD A PRINCIPLE, NOT JUST ARITHMETIC. `advance` is where "absence
// never accumulates" is actually enforced: get it wrong in the obvious way —
// step to the next occurrence after the one you answered for — and a fortnight
// away comes back as four taps instead of one, which is the wall 10-hq.md §3
// exists to forbid, arriving on exactly the morning it does the most damage.
//
// The lead rule is the other kind of risk: it is invisible. Nothing on screen
// disagrees with a wrong lead until a task fails to show up, weeks later, and
// by then nobody remembers what it was set to.
import { describe, expect, it } from 'vitest';
import { advance, byWhen, groupOf, lateBy, leadFor, leadLine, recurrenceWords } from '../lib/hq/tasks';

const TODAY = '2026-08-03'; // a Monday

describe('leadFor', () => {
  it('reads the lead off the effort — the four buckets of §3a', () => {
    const at = (effort: 'quick' | 'sitting' | 'block' | 'project') =>
      leadFor({ effort, priority: 'normal', lead_days: null });
    expect(at('quick')).toBe(1);
    expect(at('sitting')).toBe(3);
    expect(at('block')).toBe(7);
    expect(at('project')).toBe(21);
  });

  it('bumps ONE bucket for high priority, never to some new number', () => {
    expect(leadFor({ effort: 'sitting', priority: 'high', lead_days: null })).toBe(7);
    expect(leadFor({ effort: 'quick', priority: 'high', lead_days: null })).toBe(3);
    // Already at the top: a high-priority project stays 21 rather than running
    // off the end of the table.
    expect(leadFor({ effort: 'project', priority: 'high', lead_days: null })).toBe(21);
  });

  it('⚠ never SHORTENS the lead for low priority — hiding a warning is not a kindness', () => {
    expect(leadFor({ effort: 'block', priority: 'low', lead_days: null })).toBe(7);
  });

  it('lets an explicit override win over both, including zero', () => {
    expect(leadFor({ effort: 'project', priority: 'high', lead_days: 2 })).toBe(2);
    // 0 is a real answer ("the day itself"), and `?? `-style checks that treat
    // it as absent would quietly restore the 21-day default.
    expect(leadFor({ effort: 'project', priority: 'normal', lead_days: 0 })).toBe(0);
  });
});

describe('leadLine', () => {
  it('names a real date, which is the thing you can judge', () => {
    expect(leadLine('2026-08-14', 7, TODAY)).toEqual({ alreadyOn: false, from: '2026-08-07', days: 7 });
  });

  it('⚠ says "already on Today" instead of naming a date that has gone by', () => {
    // A project is 21 days, so a lead reaching back past today is the COMMON
    // case, not an edge one — and a past date printed as a future one reads as
    // a bug on the one line that exists to make the rule checkable.
    expect(leadLine('2026-08-10', 21, TODAY).alreadyOn).toBe(true);
    // The boundary: starting exactly today counts as already on it.
    expect(leadLine('2026-08-10', 7, TODAY).alreadyOn).toBe(true);
    expect(leadLine('2026-08-11', 7, TODAY).alreadyOn).toBe(false);
  });
});

describe('groupOf', () => {
  it('puts each date in exactly one group, at the boundaries', () => {
    expect(groupOf('2026-08-02', TODAY)).toBe('past');
    expect(groupOf(TODAY, TODAY)).toBe('today');
    expect(groupOf('2026-08-04', TODAY)).toBe('week');
    expect(groupOf('2026-08-10', TODAY)).toBe('week'); // exactly 7 days out
    expect(groupOf('2026-08-11', TODAY)).toBe('later');
    // A permanently valid state, never a graveyard.
    expect(groupOf(null, TODAY)).toBe('none');
  });
});

describe('lateBy', () => {
  it('pluralises, because "1 days late" is the kind of thing that ships', () => {
    expect(lateBy('2026-08-02', TODAY)).toBe('1 day late');
    expect(lateBy('2026-07-31', TODAY)).toBe('3 days late');
  });
});

describe('byWhen', () => {
  it('orders by date, then time, with the untimed rows last', () => {
    const t = (title: string, due_on: string | null, due_time: string | null) => ({ title, due_on, due_time });
    const rows = [
      t('anytime today', TODAY, null),
      t('tomorrow', '2026-08-04', null),
      t('late today', TODAY, '16:30'),
      t('early today', TODAY, '09:00'),
    ];
    expect([...rows].sort(byWhen).map((r) => r.title)).toEqual([
      'early today',
      'late today',
      // Under the ones that claim a slot in the day — which is the only place
      // `anytime` is printed, because it is the only place it decides anything.
      'anytime today',
      'tomorrow',
    ]);
  });
});

describe('advance', () => {
  const oneOff = { recur_mode: null, recur_rrule: null, recur_every: null, recur_unit: null } as const;
  const fortnightly = {
    recur_mode: 'after_completion',
    recur_rrule: null,
    recur_every: 2,
    recur_unit: 'weeks',
  } as const;
  const weeklyMonday = {
    recur_mode: 'fixed',
    recur_rrule: 'FREQ=WEEKLY;BYDAY=MO',
    recur_every: null,
    recur_unit: null,
  } as const;

  it('gives a one-off nowhere to go — the action archives it instead', () => {
    expect(advance(oneOff, TODAY, TODAY)).toBeNull();
  });

  it('⚠ counts after_completion from the day you TICKED it, not from the date', () => {
    // The whole argument for the mode (§4): with a fixed schedule, finishing a
    // fortnight late leaves you instantly a fortnight behind again, for ever.
    expect(advance(fortnightly, '2026-07-20', TODAY)).toBe('2026-08-17');
    expect(advance(fortnightly, TODAY, TODAY)).toBe('2026-08-17');
  });

  it('moves a fixed schedule to its next occurrence', () => {
    expect(advance(weeklyMonday, TODAY, TODAY)).toBe('2026-08-10');
  });

  it('⚠ rolls a fixed schedule FORWARD PAST TODAY after an absence', () => {
    // Three weeks away. The missed Mondays leave no rows — there were never any
    // rows — so answering once puts the chore on the NEXT Monday, not on one
    // from a fortnight ago that would surface again the instant you answered.
    // This is ADR-0013's property: bounded by the number of TASKS, not by
    // elapsed time.
    expect(advance(weeklyMonday, '2026-07-13', TODAY)).toBe('2026-08-10');
  });

  it('⚠ anchors on the DUE date when you answer early, so nothing is skipped', () => {
    // Ticking tomorrow's chore this morning must give a week after TOMORROW.
    // Anchoring on today instead would land on tomorrow — no advance at all,
    // and the task would immediately be due again.
    expect(advance(weeklyMonday, '2026-08-10', TODAY)).toBe('2026-08-17');
  });

  it('advances on a SKIP exactly as it does on a done — a skip is an answer', () => {
    // There is one advance path and both outcomes take it, which is what keeps
    // "I want to know if I skipped" from turning into an arrears wall: the row
    // in `task_events` is the record, and the surface is clear either way.
    expect(advance(fortnightly, TODAY, TODAY)).toBe('2026-08-17');
  });

  it('returns null rather than a wrong date for a rule it cannot expand', () => {
    const broken = { ...weeklyMonday, recur_rrule: 'FREQ=YEARLY' };
    expect(advance(broken, TODAY, TODAY)).toBeNull();
  });
});

describe('recurrenceWords', () => {
  it('says the interval in the row‘s own words, singular and plural', () => {
    const after = (every: number, unit: 'days' | 'weeks' | 'months') =>
      recurrenceWords({ recur_mode: 'after_completion', recur_rrule: null, recur_every: every, recur_unit: unit }, null);
    expect(after(2, 'weeks')).toBe('every 2 weeks after I do it');
    expect(after(1, 'week' as 'weeks')).toBe('every week after I do it');
    expect(after(1, 'months')).toBe('every month after I do it');
    expect(after(3, 'days')).toBe('every 3 days after I do it');
  });

  it('uses the schedule‘s name, never its rule string', () => {
    const fixed = { recur_mode: 'fixed', recur_rrule: 'FREQ=MONTHLY;BYDAY=3MO', recur_every: null, recur_unit: null } as const;
    expect(recurrenceWords(fixed, 'Monthly, on the 3rd Monday')).toBe('monthly, on the 3rd monday');
    expect(recurrenceWords(fixed, null)).not.toMatch(/FREQ/);
  });

  it('says nothing at all about a one-off', () => {
    expect(recurrenceWords({ recur_mode: null, recur_rrule: null, recur_every: null, recur_unit: null }, null)).toBeNull();
  });
});
