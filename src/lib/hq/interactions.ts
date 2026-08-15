// The log's vocabulary and its one derivation (docs/plans/archive/12-people.md §6, §8).
//
// Separate from `./people.ts` because they are two tables with two lifetimes:
// a person is a standing record you set once, an interaction is a stream you
// append to. What they share is `since()`, which lives here because this is the
// module that owns the thing being measured.
import type { Database } from '../database.types';
import { daysBetween } from './time';
import type { Ymd } from './time';

export type Interaction = Database['public']['Tables']['interactions']['Row'];
export type InteractionKind = Database['public']['Enums']['interaction_kind'];

/**
 * The six kinds, in the order the picker offers them — most common first, not
 * alphabetical: the whole design target is that logging costs fifteen seconds,
 * and the option you want is usually the first one.
 *
 * `gift` covers "I will haphazardly give gifts to people who do very kind
 * things" — recording what was given and when prevents repeats and informs the
 * next one. `shared` covers a recommendation that never became a fragment
 * ("told me to read Piranesi"). Both are entry kinds, not separate tables.
 *
 * ⚠ THE MARKS MUST STAY DISTINCT FROM EACH OTHER AND FROM THE ROSTER'S. `gift`
 * gets `ph:gift` rather than borrowing `ph:cake`, which already means a
 * birthday on a person card — one glyph meaning two things is how a timeline
 * stops being scannable.
 */
export const KINDS: { key: InteractionKind; label: string; icon: string }[] = [
  { key: 'hangout', label: 'Hangout', icon: 'ph:users-three' },
  { key: 'call', label: 'Call', icon: 'ph:phone' },
  { key: 'message', label: 'Message', icon: 'ph:chat-circle' },
  { key: 'gift', label: 'Gift', icon: 'ph:gift' },
  { key: 'shared', label: 'Shared', icon: 'ph:books' },
  { key: 'note', label: 'Note', icon: 'ph:note' },
];

export const KIND_ICON = Object.fromEntries(KINDS.map((k) => [k.key, k.icon])) as Record<InteractionKind, string>;

/** The date picker's three one-tap options, before it falls back to a real date input. */
export const QUICK_DAYS = [
  { back: 0, label: 'Today' },
  { back: 1, label: 'Yesterday' },
  { back: 2, label: '2 days ago' },
];

/**
 * How long ago, as a DURATION — "3 weeks ago", never "7/20 Sat".
 *
 * This is the register §3 settles for anything in the past, and the reason is a
 * bug the people lab found rather than a preference: a compact `M/D Ddd` format
 * carries no year, so a contact two years old rendered as "7/20 Sat" and read
 * as last month. A duration cannot lie that way. The exact date stays one tap
 * away on the stamp.
 *
 * The buckets widen as they recede because that is how the question changes:
 * inside three weeks you want the number of days, and past a year you want to
 * know it has been a year — not that it has been 437 days.
 */
export function since(on: Ymd, today: Ymd): string {
  const days = daysBetween(on, today);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 21) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = days / 365;
  return years < 1.75 ? 'over a year ago' : `${Math.round(years)} years ago`;
}

export interface LastContact {
  on: Ymd;
  count: number;
}

/**
 * `person_id → last contact` for the whole roster, in one round trip.
 *
 * Reads the `person_last_contact` VIEW rather than aggregating here, so the
 * `max()` happens in Postgres over an indexed join instead of by pulling every
 * interaction into the page. The view is `security_invoker = true`, so it sees
 * exactly what the caller may see — for `anon`, nothing.
 *
 * ⚠ ABSENCE FROM THIS MAP IS MEANINGFUL AND IS NOT THE SAME AS "LONG AGO".
 * A person with no interactions is NEW, not neglected (§8) — on the day
 * somebody is added their last contact is null, and a naive
 * `now - last_contact > cadence` would flag the entire roster on creation day.
 * That was the provenance audit's finding, and it is why drift (Piece 4) must
 * require at least one logged interaction rather than treating null as ancient.
 */
export async function lastContactMap(sb: {
  from: (t: 'person_last_contact') => any;
}): Promise<Map<string, LastContact>> {
  const { data } = await sb.from('person_last_contact').select('person_id, last_contact_on, interaction_count');
  const map = new Map<string, LastContact>();
  for (const row of (data ?? []) as {
    person_id: string | null;
    last_contact_on: string | null;
    interaction_count: number | null;
  }[]) {
    if (row.person_id && row.last_contact_on) {
      map.set(row.person_id, { on: row.last_contact_on, count: row.interaction_count ?? 0 });
    }
  }
  return map;
}

/**
 * **Last interaction, descending** — people you are actually in touch with
 * float up.
 *
 * ⚠ NO LONGER THE ROSTER'S ORDER. It was, from Piece 2 until 2026-08-07, and it
 * is now what `byKnownSince` falls through to when two people have been known
 * the same number of years — see that function for why the roster stopped
 * ranking by recency. Kept whole rather than inlined there, because it is still
 * the correct answer to "who have I spoken to lately" and something else will
 * ask that.
 *
 * Somebody with NO entries sorts last, not first. They are new rather than
 * neglected, but the top of a list is for people there is something to say
 * about, and a name with no history is not that.
 */
export function byLastContact(map: Map<string, LastContact>) {
  return (a: { id: string; sort_name: string | null; display_name: string }, b: typeof a): number => {
    const ax = map.get(a.id)?.on;
    const bx = map.get(b.id)?.on;
    if (ax && bx) return ax < bx ? 1 : ax > bx ? -1 : 0;
    if (ax) return -1;
    if (bx) return 1;
    // Neither has been logged — fall back to the name, so the order is at least
    // stable rather than whatever Postgres happened to return.
    const key = (p: typeof a) => (p.sort_name || p.display_name).toLocaleLowerCase();
    return key(a).localeCompare(key(b));
  };
}
