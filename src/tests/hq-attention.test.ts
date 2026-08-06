// What the building is still waiting for (20 · Piece 1).
//
// ⚠ WHAT THESE GUARD IS A LINE THE PROJECT SPENT FOUR FILES FORBIDDING.
// [ADR-0013](../../docs/adr/0013-absence-never-accumulates.md) bans counting
// what you have not done; plan 20 admits one count, under four conditions, and
// the whole permission rests on the total being BOUNDED BY THE NUMBER OF TASK
// RULES rather than by elapsed time. Every test below is one of those conditions
// written as arithmetic, because the failure mode here is not a crash — it is a
// badge that is quietly, plausibly two higher than it should be at 7am.
//
//  · `dueToday` must exclude past due. That is one character (`===` → `<=`), it
//    looks like a bug fix, and it converts this back into the guilt engine —
//    so the boundedness property gets its own test rather than a comment.
//  · `dueToday` must subtract what you already answered for. A ticked row
//    deliberately STAYS ON SCREEN struck through until midnight, so "on screen"
//    and "counted" are different questions and only one of them is this one.
//  · `checkinSettled` must treat a skip and a half-finished check-in as answers.
//    Both are trap 4, and both would produce a badge that burns after you have
//    done the thing it is asking for.
//  · `titlePrefix` must say NOTHING at zero. A permanent `(0)` is the status
//    line you read once and ignore for ever — the argument `progressLabel()`
//    already makes about `0 of 3 done`.
import { describe, expect, it } from 'vitest';
import {
  NOTHING,
  attention,
  attentionLabel,
  checkinSettled,
  dueToday,
  titlePrefix,
  type Countable,
} from '../lib/hq/attention';
import type { Checkin } from '../lib/hq/checkin';
import type { Ymd } from '../lib/hq/time';

const TODAY = '2026-08-06' as Ymd;

/** A task standing on an occurrence — `TaskRow`'s shape, narrowed. */
const task = (id: string, shownDueOn: string | null): Countable => ({ id, shownDueOn });

/**
 * A row that EXISTS and says nothing — what an untouched or skipped day holds.
 *
 * ⚠ THE COLUMNS GO THROUGH A CAST, AND THAT IS THE POINT. `hasAnswers()` reads
 * the parent row's columns by name, so "an empty row" has to name every one of
 * them or an unnamed column reads `undefined`, which is neither null nor '' and
 * therefore counts as an answer — the empty-row test would pass while proving
 * the opposite of what it says. Meanwhile the check-in's shape is being reshaped
 * (dream tones, wakings, naps, sleep aids), so a literal `Checkin` here would
 * tie this file's COMPILATION to that migration's landing.
 *
 * So both generations of the dream/aid columns are set to null below and the
 * whole thing is cast. Under either shape `hasAnswers` finds only nulls, which
 * is what these tests are about. If the schema ever drifts far enough that a new
 * answer column is missed, *"is still waiting on a row that exists but says
 * nothing"* goes red — the right test, in the right file, for the right reason.
 */
const row = (over: Record<string, unknown> = {}): Checkin =>
  ({
    id: 'c1',
    log_date: TODAY,
    created_at: '2026-08-06T00:00:00Z',
    updated_at: '2026-08-06T00:00:00Z',
    skipped: false,
    bed_at: null,
    woke_at: null,
    got_up_at: null,
    asleep_at: null,
    sleep_latency: null,
    awakenings: null,
    sleep_quality: null,
    restedness: null,
    valence: null,
    arousal: null,
    dream_body: null,
    note: null,
    // Before 2026-08-06 …
    dream_recall: null,
    dream_intensity: null,
    // … and after.
    dreamless: null,
    sleep_aids: null,
    ...over,
  }) as unknown as Checkin;

describe('dueToday — today, and never a day before it', () => {
  it('counts the occurrences standing on today', () => {
    const rows = [task('a', TODAY), task('b', TODAY), task('c', '2026-08-07')];
    expect(dueToday(rows, new Set(), TODAY)).toBe(2);
  });

  it('⚠ never counts past due — the one input that can grow while you are away', () => {
    const rows = [task('a', '2026-08-05'), task('b', '2026-07-01'), task('c', '2025-01-01')];
    expect(dueToday(rows, new Set(), TODAY)).toBe(0);
  });

  it('⚠ produces the same number after a fortnight away as after a night', () => {
    // ADR-0013's boundedness property, as arithmetic. Three rules, one of them
    // standing on today; the others in arrears by 1, 14 and 400 days. The badge
    // is the same number in all three cases, which is the entire reason a count
    // is permitted here and would not be in a normal to-do app.
    const oneDay = [task('a', TODAY), task('b', '2026-08-05')];
    const fortnight = [task('a', TODAY), task('b', '2026-07-23')];
    const year = [task('a', TODAY), task('b', '2025-07-01')];
    expect(dueToday(oneDay, new Set(), TODAY)).toBe(1);
    expect(dueToday(fortnight, new Set(), TODAY)).toBe(1);
    expect(dueToday(year, new Set(), TODAY)).toBe(1);
  });

  it('does not count what is still ahead — that belongs to Coming up', () => {
    expect(dueToday([task('a', '2026-08-07'), task('b', '2026-09-01')], new Set(), TODAY)).toBe(0);
  });

  it('does not count an undated task — a someday item is not owed today', () => {
    expect(dueToday([task('a', null)], new Set(), TODAY)).toBe(0);
  });

  it('⚠ subtracts what you already answered for, though the row is still on screen', () => {
    // The row arrives from `liveAndAnswered` standing on today — rebuilt from
    // `task_events.for_due_on`, because ticking it advanced `tasks.due_on` past
    // today. It stays visible, struck through, until midnight. It stops being
    // counted the moment it is answered, or the badge never reaches zero on a
    // day you actually finished.
    const rows = [task('a', TODAY), task('b', TODAY)];
    expect(dueToday(rows, new Set(['a']), TODAY)).toBe(1);
    expect(dueToday(rows, new Set(['a', 'b']), TODAY)).toBe(0);
  });

  it('ignores an answer belonging to some other task', () => {
    expect(dueToday([task('a', TODAY)], new Set(['zzz']), TODAY)).toBe(1);
  });

  it('is zero on an empty list rather than anything else', () => {
    expect(dueToday([], new Set(), TODAY)).toBe(0);
  });
});

describe('checkinSettled — a skip is an answer, and so is half of one', () => {
  it('is waiting when the date has no row at all', () => {
    expect(checkinSettled(null)).toBe(false);
  });

  it('⚠ is settled by a skip, whose row is otherwise entirely empty', () => {
    // Trap 4. `hasAnswers()` alone returns false here — every field IS null —
    // so a badge built on it would keep burning after a deliberate skip, which
    // is precisely the scold ADR-0013 §4 refuses.
    expect(checkinSettled(row({ skipped: true }))).toBe(true);
  });

  it('⚠ is settled by one answer — an unfinished check-in is a check-in', () => {
    // ⚠ ASSERTED THROUGH THE MOST STABLE COLUMNS THERE ARE, deliberately.
    // WHICH columns count as an answer belongs to `hasAnswers()` and is tested
    // beside it in `hq-checkin.test.ts`; duplicating that list here would give
    // the check-in's schema two places to break instead of one, and this file
    // would be the one nobody thought to look at. What is tested HERE is that
    // `checkinSettled` defers to it at all.
    expect(checkinSettled(row({ valence: 3 }))).toBe(true);
    expect(checkinSettled(row({ note: 'slept badly' }))).toBe(true);
    expect(checkinSettled(row({ bed_at: '2026-08-06T03:00:00Z' }))).toBe(true);
  });

  it('is still waiting on a row that exists but says nothing', () => {
    // An empty un-skipped row is what a touched-but-abandoned form leaves. It is
    // not an answer, and the check-in should still be asked for.
    expect(checkinSettled(row())).toBe(false);
  });
});

describe('attention — one number, from two halves', () => {
  it('adds the check-in to the tasks', () => {
    expect(attention(false, 2)).toEqual({ checkin: 1, tasks: 2, total: 3 });
  });

  it('counts the check-in as exactly one, never as its own mark', () => {
    expect(attention(false, 0)).toEqual({ checkin: 1, tasks: 0, total: 1 });
  });

  it('is NOTHING when the day is clear', () => {
    expect(attention(true, 0)).toEqual(NOTHING);
  });
});

describe('attentionLabel — what a screen reader is told', () => {
  it('⚠ never hands over a bare numeral', () => {
    expect(attentionLabel(2)).toBe('Today, 2 waiting');
    expect(attentionLabel(1)).toBe('Today, 1 waiting');
  });

  it('is just the room when there is nothing waiting', () => {
    expect(attentionLabel(0)).toBe('Today');
  });
});

describe('titlePrefix — the tab, from across twenty of them', () => {
  it('prefixes the count when something is waiting', () => {
    expect(titlePrefix(2)).toBe('(2) ');
  });

  it('⚠ says nothing at zero — no permanent (0) to learn to ignore', () => {
    expect(titlePrefix(0)).toBe('');
  });
});
