// The calendar's union (docs/plans/13-agenda.md §5).
//
// ⚠ FOUR SOURCES ON ONE GRID, AND ONLY TWO OF THEM ARE WRITABLE. That is the
// whole design problem of this surface, and §5's answer is that authority is
// carried by the SHAPE of a row rather than by a label:
//
//   HQ event   solid fill        yours, and the most present thing on the grid
//   task       lighter fill + ○  yours, but not an event — it ticks off
//   mirrored   hairline, no fill a copy of something that lives elsewhere
//   birthday   no body at all    not a row anywhere; a cake and a name
//
// FILL MEANS WRITABLE and nothing else uses it. The first draft gave tasks an
// outline ring, which put them in the same visual class as the Google rows — so
// the loudest distinction on the grid became *event vs everything else* rather
// than **yours vs not yours**, which is the one the whole section exists to
// make. Caught by the lab, not by review.
//
// `writable` below is not decoration: it decides the cursor, the hover, the
// lock, and whether the day panel offers a verb or nothing at all.
//
// The one query below takes its client as an argument and imports Supabase as a
// TYPE only, exactly as `time.ts` does — so this module still reaches the
// browser bundle without dragging a client into it.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import type { Ymd } from './time';

export type ItemKind = 'event' | 'task' | 'mirror' | 'birthday';

export const KINDS: Record<ItemKind, { writable: boolean; label: string }> = {
  event: { writable: true, label: 'Yours' },
  task: { writable: true, label: 'Task' },
  mirror: { writable: false, label: 'Mirrored' },
  birthday: { writable: false, label: 'Birthday' },
};

export interface CalendarItem {
  kind: ItemKind;
  /** The row's id — or the person's, for a birthday, which is not a row. */
  id: string;
  on: Ymd;
  title: string;
  /** `HH:MM`, or null for all day / a dated task with no time. */
  at: string | null;
  endAt?: string | null;
  location?: string | null;
  notes?: string | null;
  /** Tasks only: whether it has already been answered for today. */
  answered?: boolean;
  /** Whoever is tagged on it. */
  people?: { id: string; name: string }[];
  /**
   * Where this row opens, when it has somewhere to go — a birthday to its
   * person, an event to the day panel. Set by the PAGE rather than by a zone, so
   * routing lives where the rest of this app's routing lives; a zone with no
   * href simply renders text.
   */
  href?: string;
}

/**
 * The order items sit in on a day, and it is the same order everywhere — the
 * grid, the week column and the day panel — because they are one union, not
 * three.
 *
 * ⚠ ALL-DAY THINGS COME FIRST, then timed ones in clock order. A birthday is
 * not at 9am; it is a fact about the whole day, and putting it after a 7pm
 * dinner because it has no time would read as a mistake. Untimed TASKS sort
 * after untimed events for the same reason they sort last in the tasks room: a
 * task with no time does not claim a slot in the day.
 */
const rank = (i: CalendarItem) => (i.kind === 'birthday' ? 0 : i.at ? 2 : i.kind === 'task' ? 3 : 1);

export function byTime(a: CalendarItem, b: CalendarItem): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a.at && b.at && a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/** Everything that happens on each day, keyed by local date. */
export function byDay(items: CalendarItem[]): Map<Ymd, CalendarItem[]> {
  const out = new Map<Ymd, CalendarItem[]>();
  for (const item of items) {
    const list = out.get(item.on);
    if (list) list.push(item);
    else out.set(item.on, [item]);
  }
  for (const list of out.values()) list.sort(byTime);
  return out;
}

/**
 * The legend — and it lists only the sources actually on the grid.
 *
 * §5 calls the legend "the one piece of chrome that earns itself", because four
 * sources on one grid is genuinely ambiguous and a four-word key is a fixed
 * cost. But a key for a source with nothing in it is the opposite: it names a
 * feature that does not exist, which is what 10-hq.md §10b refuses. Until the
 * Google mirror lands there is nothing mirrored, so nothing says there is.
 */
export function legendFor(items: CalendarItem[]): { kind: ItemKind; label: string }[] {
  const present = new Set(items.map((i) => i.kind));
  return (Object.keys(KINDS) as ItemKind[])
    .filter((k) => present.has(k))
    .map((k) => ({ kind: k, label: KINDS[k].label }));
}

/**
 * How many rows fit in a month cell before the rest become "+N more".
 *
 * Three, and the number is load-bearing rather than arbitrary: a cell that
 * grows with its contents makes the row heights uneven, which makes the grid
 * jump as you step through months — the same complaint six-week rows exist to
 * answer.
 */
export const CELL_ROWS = 3;

/**
 * Who is on the calendar today — the drift guard's one question.
 *
 * ⚠ THIS IS THE HOLE `12 · Piece 4` COULD NOT CLOSE, and it was carried on the
 * board for a day and a half rather than quietly skipped: *anyone with an event
 * today is never drifting.* The interaction will not be logged until tonight at
 * the earliest, so without this the "Been a while" panel spends the whole of
 * the one day it is wrong on telling you that you have neglected somebody you
 * are about to have dinner with.
 *
 * Never throws. A failure here should cost the guard, not the page.
 */
export async function seenOn(sb: SupabaseClient<Database>, ymd: Ymd): Promise<Set<string>> {
  const { data } = await sb
    .from('event_people')
    .select('person_id, events!inner(starts_on)')
    .eq('events.starts_on', ymd);
  return new Set((data ?? []).map((r) => r.person_id));
}
