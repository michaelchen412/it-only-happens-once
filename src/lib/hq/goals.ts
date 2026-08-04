// Goals — intentions, not projects (docs/plans/13-agenda.md §4a).
//
// The whole file is shaped by one distinction: **a goal is a direction, not a
// scoped deliverable.** *Get back in shape. Finish the Sky.* That is why there
// is no completion function here and never will be — a goal is not 60% done,
// and saying it is would be both false and a guilt engine (ADR-0013).
//
// What a goal DOES get is one honest observation: what actually happened in the
// last 30 days. It answers "am I spending time on what I said mattered?", which
// is the correlation thesis HQ exists for and something no to-do app will tell
// you. `observationFor` below is that line, and its cold-start guard is the
// part worth reading.
//
// NO SUPABASE IMPORT — this module reaches the browser bundle.
import { slugify } from '../slug';
import { daysBetween } from './people';
import type { Ymd } from './time';

export type GoalStatus = 'active' | 'paused' | 'achieved' | 'let_go';
export type GoalHorizon = 'this_season' | 'this_year' | 'next_few_years';

/**
 * ⚠ THREE HORIZONS, AND THEY ARE AN ENUM SO A DATE CANNOT BE TYPED (settled
 * 2026-08-03). §4a: *the horizon is deliberately vague — never a date. The
 * moment a goal has a deadline it is a task.* A free-text field would leave
 * that rule to discipline; a control that cannot express a date is the rule
 * made structural.
 */
export const HORIZONS: readonly { key: GoalHorizon; label: string }[] = [
  { key: 'this_season', label: 'this season' },
  { key: 'this_year', label: 'this year' },
  { key: 'next_few_years', label: 'the next few years' },
] as const;

export const horizonLabel = (key: GoalHorizon) => HORIZONS.find((h) => h.key === key)?.label ?? 'this year';

/**
 * Four statuses, and **`let_go` is one of them** — beside active, paused and
 * achieved, not hidden behind a delete. Abandoning a goal should be a dignified
 * act you take, not a row you erase or a thing that rots in a list (§4a).
 */
export const STATUSES: readonly { key: GoalStatus; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'achieved', label: 'Achieved' },
  { key: 'let_go', label: 'Let go' },
] as const;

export const statusLabel = (key: GoalStatus) => STATUSES.find((s) => s.key === key)?.label ?? 'Active';

/**
 * ⚠ FIVE ACTIVE GOALS, HARD (§4a).
 *
 * `vision.md` caps constellations at 7–12 because an uncapped set stops meaning
 * anything. Goals are capped *harder*, and the reason is not symmetry: they are
 * about attention, and attention is scarcer than taxonomy. Enforced in the
 * action — a trigger would fail at the database, where an error cannot be a
 * sentence.
 */
export const ACTIVE_CAP = 5;

/** A URL identity for a new goal, minted once and never re-minted. */
export function goalSlug(name: string): string {
  return slugify(name) || 'goal';
}

/** The window the observation asks about. Thirty days, and not a setting. */
export const OBSERVATION_DAYS = 30;

export interface Observation {
  text: string;
  /** A goal nothing has happened on in a while. Reads QUIETER, never redder. */
  cold: boolean;
}

/**
 * The one line a goal gets, and it is an OBSERVATION rather than a score.
 *
 * ⚠ THE COLD-START GUARD IS THE POINT OF THIS FUNCTION. A goal created this
 * morning has no completed tasks, so the naive version greets it with *"nothing
 * in 6 weeks"* — false, and an accusation on the one surface §4a insists must
 * never carry one. That is the same bug the people lab found in drift, arriving
 * from the other direction: **with nothing to observe, say nothing at all.**
 * A goal you have just written down is new, not neglected.
 *
 * `doneIn30` is counted with a boundary from `localToday()`, never from
 * Postgres's `current_date` — see the view's comment in the migration.
 */
export function observationFor(doneIn30: number, lastDoneOn: Ymd | null, today: Ymd): Observation | null {
  if (doneIn30 > 0) {
    return { text: `${doneIn30} task${doneIn30 === 1 ? '' : 's'} done in the last 30 days`, cold: false };
  }
  // Nothing recent — but only say so if there is a "recent" to compare against.
  if (!lastDoneOn) return null;

  const days = daysBetween(lastDoneOn, today);
  const weeks = Math.floor(days / 7);
  // Past two months, weeks stop being readable — "nothing in 30 weeks" is a
  // number you have to convert before it means anything, on a line whose whole
  // job is to be understood at a glance. Rounded rather than floored, and never
  // below 2, so the switch cannot produce "1 months".
  if (weeks >= 8) {
    const months = Math.max(2, Math.round(days / 30.44));
    return { text: `nothing in ${months} months`, cold: true };
  }
  return { text: `nothing in ${weeks} weeks`, cold: true };
}
