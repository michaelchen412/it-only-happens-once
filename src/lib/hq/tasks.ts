// The two invisible rules of a task, in one place (docs/plans/13-agenda.md §3,
// §3a, §4).
//
// Everything here is pure and takes local-date strings, so the SAME functions
// run in the editor (where the lead sentence has to name a date live as you
// change a control) and in the action (where the disposition has to advance a
// schedule). That is deliberate: a lead computed one way on screen and another
// way on the server is a rule you cannot trust, and this rule's whole problem
// is that it is invisible until weeks later.
//
// NO SUPABASE IMPORT. This module reaches the browser bundle.
import { afterCompletion, nextAfter, type Unit } from './recurrence';
import { shiftYmd, type Ymd } from './time';

export type Effort = 'quick' | 'sitting' | 'block' | 'project';
export type Priority = 'low' | 'normal' | 'high';
export type Outcome = 'done' | 'skipped';
export type RecurMode = 'after_completion' | 'fixed';

/**
 * ⚠ EFFORT DETERMINES LEAD. PRIORITY DETERMINES PROMINENCE (§3a).
 *
 * The decomposition, in Michael's words: *"some things are important but small.
 * I may not need as much time as something that's equally important but takes a
 * long time."* Surfacing an unimportant, LARGE task two weeks early costs
 * nothing — it sits quietly in "coming up". Surfacing an important, TINY one two
 * weeks early is noise for thirteen days. How far ahead something appears
 * should track how much runway you need to find the time, which is effort.
 *
 * `step` is the meter's filled height: effort is ORDINAL, so it is drawn as a
 * magnitude rather than as four identical chips that threw the ordering away.
 */
export const EFFORTS: readonly { key: Effort; label: string; hint: string; lead: number; step: number }[] = [
  { key: 'quick', label: 'Quick', hint: 'under 15 minutes', lead: 1, step: 1 },
  { key: 'sitting', label: 'Sitting', hint: 'about an hour', lead: 3, step: 2 },
  { key: 'block', label: 'Block', hint: 'half a day or more', lead: 7, step: 3 },
  { key: 'project', label: 'Project', hint: 'several sessions', lead: 21, step: 4 },
] as const;

export const PRIORITIES: readonly { key: Priority; label: string }[] = [
  { key: 'low', label: 'Low' },
  { key: 'normal', label: 'Normal' },
  { key: 'high', label: 'High' },
] as const;

export const effortMeta = (key: Effort) => EFFORTS.find((e) => e.key === key) ?? EFFORTS[1];

/**
 * How many days before its date a task starts showing.
 *
 * Three rules, and the order matters:
 *   · `high` bumps up ONE bucket — a high-priority `sitting` gets 7 days, not 3.
 *   · `low` NEVER reduces the lead. Hiding a warning is not a kindness.
 *   · an explicit `lead_days` always wins. It is what plan 14's parser fills
 *     when you say "warn me three days in advance".
 */
export function leadFor(task: { effort: Effort; priority: Priority; lead_days?: number | null }): number {
  if (task.lead_days != null) return task.lead_days;
  const i = EFFORTS.findIndex((e) => e.key === task.effort);
  const bumped = task.priority === 'high' ? Math.min(EFFORTS.length - 1, i + 1) : i;
  return EFFORTS[bumped < 0 ? 1 : bumped].lead;
}

/** The day a task first appears on Today — its date, less its lead. */
export const leadStart = (dueOn: Ymd, lead: number): Ymd => shiftYmd(dueOn, -lead);

/**
 * The one line the editor prints, because the rule is machinery you fight until
 * it names a real date (§3a).
 *
 * TWO THINGS IT HAS TO GET RIGHT. It names a DATE, not "7 days" — the date is
 * what you can judge. And when the lead reaches back past today it says so
 * rather than printing a date that has gone by: a `project` is 21 days, so this
 * is the COMMON case, and a past date there reads as a bug.
 *
 * One line, and only the outcome. A second line naming which rule fired was
 * drafted and cut — it taught the mechanic instead of stating the result
 * (10-hq.md §10i).
 */
export function leadLine(dueOn: Ymd, lead: number, today: Ymd): { alreadyOn: boolean; from: Ymd; days: number } {
  const from = leadStart(dueOn, lead);
  return { alreadyOn: from <= today, from, days: lead };
}

// ── the list, grouped by when ───────────────────────────────────────────────

export type GroupKey = 'past' | 'today' | 'week' | 'later' | 'none';

/**
 * ⚠ PAST DUE IS FIRST HERE — THE OPPOSITE OF TODAY (10-hq.md §10f).
 *
 * That looks like an inconsistency and is not one. Both rooms order by time,
 * and arrears are chronologically first. Today is a summary you read forward,
 * so meeting them last is right there; THIS room is where triage happens, so
 * meeting them first is right here.
 */
export const GROUPS: readonly { key: GroupKey; title: string }[] = [
  { key: 'past', title: 'Past due' },
  { key: 'today', title: 'Today' },
  { key: 'week', title: 'This week' },
  { key: 'later', title: 'Later' },
  { key: 'none', title: 'Unscheduled' },
] as const;

const daysBetween = (a: Ymd, b: Ymd) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function groupOf(dueOn: Ymd | null, today: Ymd): GroupKey {
  if (!dueOn) return 'none';
  if (dueOn < today) return 'past';
  if (dueOn === today) return 'today';
  return daysBetween(today, dueOn) <= 7 ? 'week' : 'later';
}

/** `3 days late` — and never `1 days late`, which is the kind of thing that ships. */
export function lateBy(dueOn: Ymd, today: Ymd): string {
  const n = daysBetween(dueOn, today);
  return `${n} ${n === 1 ? 'day' : 'days'} late`;
}

/**
 * Within a group: by date, then by time — with the untimed rows LAST.
 *
 * A task with no time doesn't compete for a slot in the day, so it sits under
 * the ones that do. That is also the only place `anytime` is printed (§3): the
 * word earns its place exactly where a missing time decides where the row sits,
 * and nowhere else, because the date already says it and the lab showed the
 * label on six rows out of eight — which is not information, it is texture.
 */
export function byWhen<T extends { due_on: string | null; due_time: string | null; title: string }>(a: T, b: T): number {
  if (a.due_on !== b.due_on) return (a.due_on ?? '') < (b.due_on ?? '') ? -1 : 1;
  if (!!a.due_time !== !!b.due_time) return a.due_time ? -1 : 1;
  if (a.due_time && b.due_time && a.due_time !== b.due_time) return a.due_time < b.due_time ? -1 : 1;
  return a.title.localeCompare(b.title);
}

// ── disposition ─────────────────────────────────────────────────────────────

export interface Recurrence {
  recur_mode: RecurMode | null;
  recur_rrule: string | null;
  recur_every: number | null;
  recur_unit: Unit | null;
}

/**
 * Where a recurring task goes once you have answered for this occurrence.
 * Returns null for a one-off, which the action archives instead.
 *
 * ⚠ THE SCHEDULE ADVANCES ON *BOTH* OUTCOMES. A skip is a recorded answer, not
 * a hole (ADR-0013): either way the item leaves the surface, and nothing
 * accumulates.
 *
 * ⚠ AND A FIXED RULE ROLLS FORWARD PAST TODAY. Away for three weeks, a weekly
 * chore's next occurrence is next week — not the one from a fortnight ago,
 * which would surface again the instant you answered and charge you four taps
 * for one absence. This is precisely ADR-0013's property: bounded by the number
 * of TASKS, not by elapsed time. The occurrences in between leave no rows,
 * because there were never any rows.
 *
 * Anchoring on `max(for_due_on, today)` is what makes ticking something EARLY
 * behave: dispose of tomorrow's weekly chore this morning and the next one is a
 * week after tomorrow, not tomorrow itself.
 */
export function advance(task: Recurrence, forDueOn: Ymd | null, today: Ymd): Ymd | null {
  if (!task.recur_mode) return null;

  if (task.recur_mode === 'after_completion') {
    if (!task.recur_every || !task.recur_unit) return null;
    return afterCompletion(today, task.recur_every, task.recur_unit);
  }

  if (!task.recur_rrule) return null;
  const anchor = forDueOn && forDueOn > today ? forDueOn : today;
  let next = nextAfter(task.recur_rrule, forDueOn ?? today);
  // Walk to the first occurrence that is genuinely ahead. Bounded so a rule
  // that somehow cannot advance can never spin here.
  for (let i = 0; next && next <= anchor && i < 500; i++) next = nextAfter(task.recur_rrule, next);
  return next;
}

/**
 * What the panel says about a schedule, in the row's own words.
 *
 * `after_completion` is counted from the day you tick it, so it has no dates to
 * show and says so in one clause. The lab's first instinct was to preview three
 * dates for both modes; that would have been a lie.
 */
export function recurrenceWords(task: Recurrence, presetLabel: string | null): string | null {
  if (task.recur_mode === 'after_completion' && task.recur_every && task.recur_unit) {
    const n = task.recur_every;
    const unit = n === 1 ? task.recur_unit.replace(/s$/, '') : task.recur_unit;
    return `every ${n === 1 ? '' : `${n} `}${unit} after I do it`;
  }
  if (task.recur_mode === 'fixed') return presetLabel ? presetLabel.toLowerCase() : 'on a schedule';
  return null;
}
