// What the building is still waiting for, computed once.
//
// Raised by Michael, 2026-08-04, from real use: *"if we have unfinished tasks or
// check-ins for the day, it's not actually apparent from the left side
// sidebar."* Today knows what it is still waiting for; every other room was deaf
// to it, so the moment you navigated away the system stopped telling you
// anything at all.
//
// Five surfaces want this number — the sidebar pill, the burger pill, the tab
// title, and whatever the live update touches. They get it from ONE place or
// they will disagree, and the one that disagrees will be the one on screen at
// 7am. Same rule `today.ts` states in its own header: no zone invents its own
// answer.
//
// NO SUPABASE IMPORT, and pure functions only — same constraint as `today.ts`
// and `tasks.ts`, and load-bearing for the same reason: this module reaches the
// browser bundle, because the live update recomputes from it client-side.
//
// ═══════════════════════════════════════════════════════════════════════════
//  WHY A COUNT IS ALLOWED HERE AT ALL — read this before adding to it.
// ═══════════════════════════════════════════════════════════════════════════
//
// [ADR-0013](docs/adr/0013-absence-never-accumulates.md) ends with a standing
// instruction: *"Any feature that wants to show a count of things not done must
// be checked against this ADR first."* This module is that check, run in
// conversation on 2026-08-04, and the outcome is NOT "we changed our minds".
//
// The ADR was defending against a specific mechanism and it named it: a number
// that GROWS WHILE YOU ARE AWAY, and therefore lands hardest at 7am on the
// morning you can least absorb it. That mechanism is already impossible here,
// by construction, and the ADR itself is where the proof lives:
//
//   Because recurrences are RULES and never materialise rows, the count can
//   never exceed the number of task RULES you have. Two weeks away produces the
//   same number as two days away.
//
// So the line moves from *never count* to a rule with four conditions:
//
//   ┌───────────────────────────────────────────────────────────────────────┐
//   │  A room may signal what is ADDRESSED TO YOU, BOUNDED, RESOLVABLE      │
//   │  TODAY, and SELF-RESETTING. It may never signal ACCUMULATION.         │
//   └───────────────────────────────────────────────────────────────────────┘
//
//   the check-in, unanswered   → yes: binary, ten seconds, resets nightly
//   tasks due TODAY, undone    → yes: bounded by rule count, resolvable today
//   past due                   → NO: accumulation, the one thing forbidden
//   drift / "been a while"     → NO: not addressed to you, not resolvable
//   last published, goals      → NO: signals, never tasks (ADR-0013 §6)
//   draft fragments, unplaced  → NO: unplaced is a permanently valid state
//
// ⚠ THE SINGLE MOST LIKELY REGRESSION IN THIS WHOLE FEATURE is a future session
// reading ADR-0013, seeing a badge, and folding PAST DUE into it "for
// consistency". It is one line of code and it silently converts this back into
// the guilt engine the ADR exists to prevent — because past due is the one
// input that CAN grow while you are away, which is the entire mechanism the ADR
// forbids. `dueToday()` below excludes it deliberately. Past due keeps exactly
// its current treatment: met after the day, capped at eight rows, never
// collapsed behind a click (10-hq §10f), and `PastDueZone` counts nothing.
import { hasAnswers, type Checkin } from './checkin';
import type { Ymd } from './time';

/**
 * A task AS A ROOM SHOWS IT, and no more — structurally what `TaskRow` already
 * is, so `liveAndAnswered`'s rows pass straight in with no mapping and without
 * this module importing the data layer (which would drag Supabase in here and
 * break the promise in the header).
 *
 * ⚠ `shownDueOn`, NOT `due_on` — and the plan that specified this file said
 * `due_on`, so this is a correction made against the tree. Answering a task
 * ADVANCES ITS DATE IMMEDIATELY: `tasks.dispose` writes the event and then
 * moves `due_on` to the next occurrence (or archives a one-off), and `advance()`
 * guarantees the new date is *genuinely ahead* of today. So the raw column says
 * "tomorrow" about a row that is on screen today, and the honest record of which
 * occurrence you are looking at is `task_events.for_due_on` — which is exactly
 * what `shownDueOn` carries. Count the raw column and the badge and the list
 * disagree about which day a row belongs to.
 */
export interface Countable {
  id: string;
  shownDueOn: string | null;
}

/** What every surface renders. */
export interface Attention {
  /** The check-in, unanswered on today's date. Always 0 or 1. */
  checkin: 0 | 1;
  /** Tasks due today and not yet disposed of. NEVER past due. */
  tasks: number;
  /** What the badge renders. Nothing is shown at 0. */
  total: number;
}

/** Nothing waiting — the shape every surface can fall back to. */
export const NOTHING: Attention = { checkin: 0, tasks: 0, total: 0 };

/**
 * Tasks due today that you have not yet answered for.
 *
 * ⚠ `=== today`, NOT `<= today`. The `<=` version is the guilt engine: it is
 * one character, it looks like a bug fix, and it is the thing the ADR forbids.
 * See the header.
 *
 * ⚠ AND THE SUBTRACTION IS NOT OPTIONAL. A ticked row deliberately STAYS ON
 * SCREEN, struck through, until midnight (10-hq §10f) — "on screen" and
 * "counted" are different questions, and conflating them gives a badge that
 * never reaches zero on a day you actually finished. `answeredIds` is the ids
 * with a `task_events` row for today, which is exactly what `liveAndAnswered`
 * already computes for the rooms.
 */
export function dueToday(tasks: Countable[], answeredIds: Set<string>, today: Ymd): number {
  return tasks.filter((t) => t.shownDueOn === today && !answeredIds.has(t.id)).length;
}

/**
 * Is the check-in DONE WITH YOU for the day?
 *
 * TWO definitions decide that, not one, and both already exist: `skipped` is the
 * column [`CheckinZone`](../../components/admin/CheckinZone.astro) reads to pick
 * its third panel, and `hasAnswers()` is what it uses to choose between the
 * other two. Composed here once so that no surface has to remember there are
 * two of them — and the plan that specified this file named only `hasAnswers`,
 * which on its own is trap 4 verbatim:
 *
 *   - **`skipped` is an answer, not a hole** (ADR-0013 §4). That zone calls it
 *     *"explicit, recorded, reversible — never a gap and never a scold"*, and a
 *     badge still burning after a deliberate skip would be exactly the scold.
 *     `hasAnswers` returns false for a skipped row — every field on it is null,
 *     because a skip is the absence of answers, recorded.
 *   - **A partial check-in counts as answered.** CheckinZone's own words: *"an
 *     unfinished check-in is a check-in."* Counting until every field is full
 *     would be a completeness meter, which that file rejects by name.
 */
export function checkinSettled(row: Checkin | null): boolean {
  return row?.skipped === true || hasAnswers(row);
}

/**
 * The whole answer — `checkinSettled()` above and `dueToday()` above it, added.
 *
 * Kept separate from both so that the two halves can be tested against their own
 * rules, and so the live update (Piece 7) can recompute a total in the browser
 * from numbers it already has without going near a Supabase row.
 */
export function attention(checkinAnswered: boolean, tasksDue: number): Attention {
  const checkin: 0 | 1 = checkinAnswered ? 0 : 1;
  return { checkin, tasks: tasksDue, total: checkin + tasksDue };
}

/**
 * How the count says what it means, for a screen reader.
 *
 * ⚠ THE ACCESSIBLE NAME IS NEVER THE BARE NUMERAL. A reader told *"Today, 2"*
 * has been given a number and not what it counts. The pill itself is
 * `aria-hidden`; this is what the link carries.
 */
export function attentionLabel(total: number): string {
  if (total <= 0) return 'Today';
  return `Today, ${total} waiting`;
}

/**
 * The window title prefix — `(2) Today — Observatory`.
 *
 * ⚠ NOTHING AT ZERO, and that is the same argument `progressLabel()` already
 * makes on Today itself: a permanent `(0)` is the status line you read once and
 * ignore for ever. The prefix appearing at all is the signal.
 */
export function titlePrefix(total: number): string {
  return total > 0 ? `(${total}) ` : '';
}
