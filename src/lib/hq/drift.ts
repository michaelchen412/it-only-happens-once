// Drift — the observation, never the verdict (docs/plans/12-people.md §8).
//
// This is the piece that pays the logging back, and it is also the one most
// able to make HQ into the thing 10-hq.md §3 forbids. The principle is load-
// bearing and it is quoted here because every function below is shaped by it:
//
//   ABSENCE NEVER ACCUMULATES. A person not seen is a quiet observation, never
//   a red badge. The system shows STATE, not ARREARS.
//
// The stakes were stated plainly: some mornings start in despair, and a surface
// that greets you with a wall of people you have failed is actively harmful. So
// drift renders as a weight shift on a line you were already reading, one warm
// panel on the roster, and at most three names on Today.
//
// ⚠ TWO GUARDS, and §10 names both. Only one of them can exist today:
//
//  1. DRIFT REQUIRES AT LEAST ONE LOGGED INTERACTION. Enforced below, and it is
//     the bug the people lab caught rather than review: `last_contact` is null
//     on the day somebody is added, so a naive `now - last > cadence` flags the
//     ENTIRE ROSTER on creation day — the exact wall §3 forbids, on day one.
//     A person with no entries is NEW, not neglected.
//  2. ⚠ ANYONE WITH AN EVENT TODAY IS NEVER DRIFTING. **Enforced since
//     2026-08-03**, with the `events` table that 13 · Piece 4 brought. It was
//     carried on the board as an open hole for a day and a half rather than
//     quietly skipped, and it closed exactly as predicted: one more clause
//     below, and `seenToday` optional so no existing caller had to change.
//     The morning you are finally seeing somebody again, they no longer sit
//     under "Been a while" accusing you of it while you are on your way out.
import { type Person } from './people';
import type { LastContact } from './interactions';
import { daysBetween, shiftYmd, type Ymd } from './time';

/** Today, capped at three, most-drifted first — the roster holds the full list. */
export const TODAY_DRIFT_CAP = 3;

export interface Drift {
  person: Person;
  /** The last logged contact. Never null: no entries means no drift at all. */
  lastOn: Ymd;
  /** Whole days since it. */
  days: number;
  /** How far past this person's OWN cadence. Always ≥ 1. */
  over: number;
}

/**
 * Is this person drifting, and by how much?
 *
 * `null` means no — and it means no for five different reasons, all of which
 * are the feature working rather than an edge case being swallowed.
 */
export function driftFor(
  person: Person,
  last: LastContact | undefined,
  today: Ymd,
  /**
   * Everybody tagged on an event dated today. Optional: a caller with no
   * calendar to ask simply behaves as it did before this existed.
   */
  seenToday?: ReadonlySet<string>,
): Drift | null {
  // Archived: they left the roster deliberately (§3). Archiving is the release
  // valve for this indicator, so it would be perverse for it to keep firing.
  if (person.archived_at) return null;

  // GUARD 2. You are seeing them TODAY. The interaction will not be logged
  // until tonight at the earliest, so without this the panel spends the whole
  // of the one day it is wrong on telling you that you have neglected somebody
  // you are about to have dinner with.
  if (seenToday?.has(person.id)) return null;

  // GUARD 1. New, not neglected. See the header.
  if (!last) return null;

  // "This is fine" (§8). Some relationships genuinely ARE annual: a mentor you
  // see once a year is not drifting, they are a mentor you see once a year.
  if (person.drift_muted_until && person.drift_muted_until >= today) return null;

  const days = daysBetween(last.on, today);
  if (days <= person.cadence_days) return null;

  return { person, lastOn: last.on, days, over: days - person.cadence_days };
}

/**
 * Everyone drifting, most-drifted first.
 *
 * ⚠ SORTED BY `over`, NOT BY `days`, and the difference is the whole reason
 * `cadence_days` is per-person. Somebody on a 6-month cadence who is 7 months
 * cold has drifted further than somebody on a 1-year cadence at 11 months, even
 * though the second number is bigger. Sorting by raw days would quietly
 * override every cadence you had set by hand.
 */
export function driftList(
  people: Person[],
  map: Map<string, LastContact>,
  today: Ymd,
  seenToday?: ReadonlySet<string>,
): Drift[] {
  return people
    .map((p) => driftFor(p, map.get(p.id), today, seenToday))
    .filter((d): d is Drift => d !== null)
    .sort((a, b) => b.over - a.over);
}

/**
 * When "This is fine" should mute until.
 *
 * Another full cadence, counted from today rather than from the last contact —
 * saying a year is fine means a year from now, not a year from a date already
 * in the past, which would expire the moment you clicked it.
 */
export function mutedUntil(person: Pick<Person, 'cadence_days'>, today: Ymd): Ymd {
  // ⚠ `shiftYmd`, not raw `Date` math — from the module this file already
  // imports from. The hand-rolled version here agreed with it, which is exactly
  // when a second owner is cheap to retire (plans/29 · §2): `time.ts` opens by
  // saying that two surfaces deriving a day slightly differently is how the
  // check-in, "due today" and "overdue" start disagreeing at midnight.
  return shiftYmd(today, person.cadence_days);
}

/**
 * What "Reached out" writes (§8).
 *
 * ⚠ IT WRITES A REAL INTERACTION, not a hidden flag, and that is the decision
 * worth defending. A `last_reached_out_on` column would be a SECOND source of
 * "when did I last make contact", and data-model.md §7 forbids exactly that —
 * two answers that can disagree, with nothing to say which is right.
 *
 * The cost is honest and is accepted: the entry says nothing about what
 * actually happened, so the brief's "Then" line will read "Reached out." for
 * that person until the next real entry. It is EDITABLE like any other entry,
 * which is the way back — and an entry with no content still records the one
 * fact drift needs, which is the date.
 */
export const REACHED_OUT_BODY = 'Reached out.';
