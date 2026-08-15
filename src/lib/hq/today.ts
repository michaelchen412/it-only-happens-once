// Today, assembled (docs/plans/archive/13-agenda.md §6; 10-hq.md §10c and §10f).
//
// The rules that decide WHAT IS ON THE PAGE, separated from the page so they can
// be tested and so no zone invents its own answer. Every one of them is a
// judgement about what you should be made to look at on a morning that may have
// started badly, which is why they are all here together where they can be read
// against each other.
//
// ⚠ ONE ORDERING FOR THE WHOLE PAGE. `byTime` already settles how a day's items
// sit (all-day first, then the clock, untimed tasks last) and it was written for
// the calendar. Today reuses it rather than sorting its own way — the same
// dinner must not appear above the same task here and below it there.
//
// ⚠ AND NOTHING HERE COUNTS WHAT YOU OWE. There is no total, no badge, no
// streak. `progressLabel` counts what you DID and says nothing until you have
// done something; `comingUp` is bounded by honest leads rather than by a window
// you tune; past due is capped so a bad fortnight cannot become a wall.
//
// NO SUPABASE IMPORT. This module reaches the browser bundle.
import { byTime, type CalendarItem } from './calendar';
import { since } from './interactions';
import { daysBetween } from './time';
import { leadFor, leadStart, type Effort, type Priority } from './tasks';
import type { Ymd } from './time';

/** The task columns every rule below needs, and no more. */
export interface Leadable {
  due_on: string | null;
  effort: Effort;
  priority: Priority;
  lead_days: number | null;
}

/**
 * ⚠ COMING UP IS DRIVEN ENTIRELY BY EACH ITEM'S OWN LEAD (§6, and the emphasis
 * is the plan's). A `project` announces itself 21 days out; a `quick` task the
 * day before. There is no "next 7 days" setting anywhere in this file, and its
 * absence is the feature: **the list is short because the leads are honest**, so
 * there is no dial to fiddle with when the list gets long — you fix the effort.
 *
 * Which is also why nothing here is capped. A cap would be the window arriving
 * again under another name.
 */
export function announces(task: Leadable, today: Ymd): boolean {
  if (!task.due_on) return false;
  // Strictly ahead: something due today belongs to the day, not to what is
  // approaching, and something past due belongs to arrears.
  if (task.due_on <= today) return false;
  return leadStart(task.due_on as Ymd, leadFor(task)) <= today;
}

/**
 * Coming up and the day's own list share a sort: date first, then the day's own
 * order. Extracted rather than inlined so the two zones cannot drift apart.
 */
export function byDayThenTime(a: CalendarItem, b: CalendarItem): number {
  if (a.on !== b.on) return a.on < b.on ? -1 : 1;
  return byTime(a, b);
}

/**
 * `1 of 2 done` — same-day progress, and it resets nightly (§10f).
 *
 * ⚠ IT SAYS NOTHING UNTIL YOU HAVE DONE ONE, and that is the whole reading.
 * `0 of 3 done` at 7am is arithmetic about what you have not done yet, which is
 * exactly the arrears count §10f says this line must never become. Counting what
 * you did means there is nothing to count before you have done anything.
 *
 * The alternative that lost: showing `0 of 3` for symmetry, so the line does not
 * "pop in". A line that appears the moment you earn it is a better reward than a
 * line that starts at zero and watches you.
 */
export function progressLabel(done: number, total: number): string | null {
  if (done <= 0 || total <= 0) return null;
  return `${done} of ${total} done`;
}

/**
 * ⚠ EIGHT ROWS OF ARREARS, THEN A DOOR (§10f).
 *
 * The cap is the one guard kept on a section that is otherwise always open: a
 * runaway list cannot become a wall. Note what it is a cap on — a LIST, not a
 * hidden section. Hiding arrears behind a disclosure is how they never get
 * resolved, and it puts a click in front of a one-tap disposition.
 */
export const PAST_DUE_CAP = 8;

/**
 * Past this, the practice line reads QUIETER rather than louder — the same
 * treatment a cold goal observation gets, and the same boundary at which
 * `observationFor` stops counting weeks because they stop being readable.
 */
export const PRACTICE_COLD_DAYS = 56;

export interface Signal {
  text: string;
  /** Long enough ago that the line steps back. Never redder, only quieter. */
  cold: boolean;
}

/**
 * *Last published · 3 years ago* — the nudge, built as a SIGNAL (§6).
 *
 * Michael asked for it in these words: *"Hey, you haven't actually posted
 * anything, any piece of writing, this week."* It is deliberately not a task and
 * never an overdue item, because a self-imposed writing commitment turned into a
 * red row is precisely the guilt engine 10-hq.md §3 exists to prevent.
 *
 * ⚠ WRITING ONLY, and that is a fact about the data as much as about the ask.
 * `published_at` is stamped on all 50 published essays and is honest for them —
 * but only 1 of 73 quotes carries one, and every song's stamp is the day the
 * catalogue was imported. A "last published" line over all three types would be
 * reporting an import as an act of writing.
 *
 * ⚠ COLD START: nothing published at all means NOTHING SAID. Same guard as
 * drift's, and as `observationFor`'s — with nothing to observe, say nothing.
 *
 * The register is `since()`, unchanged, because a past date renders as a
 * duration everywhere in HQ (§10d). Verified against the real data before
 * shipping: the first thing this will say is *3 years ago*, which is true, and
 * is the sentence that was asked for.
 */
export function publishedSignal(lastOn: Ymd | null, today: Ymd): Signal | null {
  if (!lastOn) return null;
  return { text: since(lastOn, today), cold: daysBetween(lastOn, today) >= PRACTICE_COLD_DAYS };
}
