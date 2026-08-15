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
import { spans } from './mirror';
import { one } from './relations';
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

/** The `events` columns an item needs. Written out so both callers agree. */
export interface EventRow {
  id: string;
  starts_on: string;
  starts_at: string | null;
  ends_at?: string | null;
  title: string;
  location: string | null;
  notes?: string | null;
  event_people?: { people: { id: string; display_name: string } | null }[] | null;
}

/**
 * An `events` row as a grid item.
 *
 * ⚠ IT SETS NO `href`, and that is the type's own rule kept rather than bent:
 * routing belongs to the page. Today sends an event to the day panel, the
 * calendar is already *in* the day panel and sends it nowhere. Callers spread
 * their own door on: `{ ...eventItem(e), href: … }`.
 *
 * Extracted 2026-08-04 because Today and the calendar had each written this
 * out — including the same `event_people → people` filter with the same type
 * predicate, twice — and two copies of "who is on this event" is exactly the
 * kind of thing that gets fixed in one of them.
 */
export function eventItem(row: EventRow): CalendarItem {
  return {
    kind: 'event',
    id: row.id,
    on: row.starts_on as Ymd,
    title: row.title,
    at: row.starts_at ? row.starts_at.slice(0, 5) : null,
    endAt: row.ends_at ? row.ends_at.slice(0, 5) : null,
    location: row.location,
    notes: row.notes ?? null,
    people: (row.event_people ?? [])
      .map((ep) => ep.people)
      .filter((p): p is { id: string; display_name: string } => !!p)
      .map((p) => ({ id: p.id, name: p.display_name })),
  };
}

/**
 * A birthday as a grid item — derived, never a row (12-people.md §8).
 *
 * Which is why it takes a name and an id rather than a table row: there is no
 * `birthdays` table to select from, and pretending there is would be the first
 * step toward one.
 */
export function birthdayItem(person: { id: string; display_name: string }, on: Ymd): CalendarItem {
  return { kind: 'birthday', id: person.id, on, title: person.display_name, at: null };
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
 * How many DOTS fit in a month cell before the rest become one "and more" mark.
 *
 * ⚠ THIS IS THE PHONE'S VERSION OF `CELL_ROWS`, and it exists because the rows
 * above do not survive a narrow screen. Seven columns at 390px is ~52px each:
 * measured on 2026-08-15, a cell held its day number and about three characters
 * of one event title before the ellipsis. That is a grid you cannot read, six
 * rows tall — Michael: *"that month view is not super optimized for this
 * context."* So under 40rem the titles come off and the cell says only what a
 * cell that size can honestly say — **something is on this day, and roughly how
 * much** — while the day panel underneath carries the words. Which is the
 * arrangement every phone calendar arrives at, and the panel was already built.
 *
 * Four, for `CELL_ROWS`' own reason turned sideways: five would wrap to a second
 * line and make the row heights uneven, which is the jump that six-week rows and
 * the three-row cap both exist to prevent.
 *
 * ⚠ IT IS FOUR MARKS, NOT FOUR DOTS PLUS AN OVERFLOW MARK — see `cellDots`.
 * Seven columns at 320px leave a cell about 37px wide, and a fifth mark does not
 * fit in it. So a busy day spends one of its four on saying "and more".
 */
export const CELL_DOTS = 4;

/**
 * The marks a cell shows: one per thing, capped, with the last one standing for
 * the rest when there are more than fit.
 *
 * Returned as a pair rather than computed in the template because the "minus
 * one for the overflow mark" arithmetic is exactly the kind that gets written
 * differently the second time. `more` is a boolean, not a count: a numeral is
 * unreadable at 7px, which is the whole reason the overflow is a shape.
 */
export function cellDots<T>(list: T[]): { shown: T[]; more: boolean } {
  const more = list.length > CELL_DOTS;
  return { shown: list.slice(0, more ? CELL_DOTS - 1 : CELL_DOTS), more };
}

/**
 * Everything mirrored from Google that touches `[from, to]` (13 · Piece 3).
 *
 * ⚠ CANCELLED ROWS ARE FILTERED HERE, NOT DELETED THERE. ADR-0014's mirror
 * marks and never removes, so that an annotation written on an event somebody
 * later cancelled stays legible instead of vanishing. The consequence is that
 * every reader has to remember to exclude them, which is exactly why there is
 * one reader.
 *
 * ⚠ AND A MULTI-DAY ROW BECOMES ONE ITEM PER DAY IT COVERS. A four-night hotel
 * stay is not an event on the day you checked in; it is where you are all week,
 * and the grid's question is "what is my day". Two of the nine real events on
 * the live calendar are exactly this.
 */
export async function mirroredBetween(sb: SupabaseClient<Database>, from: Ymd, to: Ymd): Promise<CalendarItem[]> {
  const { data } = await sb
    .from('external_events')
    .select('*')
    .eq('cancelled', false)
    .lte('starts_on', to)
    // Either it ends inside the window, or it is a single-day row inside it.
    .or(`ends_on.gte.${from},and(ends_on.is.null,starts_on.gte.${from})`);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Who has been tagged on them — keyed on the SERIES, which is what a tag
  // attaches to (§2 wrinkle 1).
  const { data: tags } = await sb
    .from('event_people')
    .select('external_id, people(id, display_name)')
    .in('external_id', [...new Set(rows.map((r) => r.series_id))]);

  const bySeries = new Map<string, { id: string; name: string }[]>();
  for (const t of tags ?? []) {
    const p = one<{ id: string; display_name: string }>(t.people);
    if (!t.external_id || !p) continue;
    const list = bySeries.get(t.external_id) ?? [];
    list.push({ id: p.id, name: p.display_name });
    bySeries.set(t.external_id, list);
  }

  return rows.flatMap((row) =>
    spans(row)
      .filter((day) => day >= from && day <= to)
      .map((day) => ({
        kind: 'mirror' as const,
        // The series, so the day panel's tag control has the right subject
        // without the row having to carry a second identifier.
        id: row.series_id,
        on: day,
        title: row.title ?? '(untitled)',
        // A multi-day event only has its time on the day it starts; in the
        // middle of a hotel stay there is no o'clock to show.
        at: day === row.starts_on ? (row.starts_at?.slice(0, 5) ?? null) : null,
        endAt: day === row.starts_on ? (row.ends_at?.slice(0, 5) ?? null) : null,
        location: row.location,
        // ⚠ THE ROW'S ONE DOOR IS GOOGLE ITSELF, which is a better explanation
        // of "not yours to change" than any label (10-hq.md §10i).
        href: row.url ?? undefined,
        people: bySeries.get(row.series_id) ?? [],
      })),
  );
}

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
 * ⚠ IT ASKS BOTH CALENDARS. A tag on a mirrored event is the one write HQ has
 * against Google's copy, and the entire reason to make it is that the people on
 * it show up. A guard that only knew about HQ-native events would quietly stop
 * guarding for exactly the dinners somebody else organised — which is most of
 * them.
 *
 * Never throws. A failure here should cost the guard, not the page.
 */
export async function seenOn(sb: SupabaseClient<Database>, ymd: Ymd): Promise<Set<string>> {
  const [{ data: own }, { data: mirrored }] = await Promise.all([
    sb.from('event_people').select('person_id, events!inner(starts_on)').eq('events.starts_on', ymd),
    sb
      .from('external_events')
      .select('series_id')
      .eq('cancelled', false)
      .lte('starts_on', ymd)
      .or(`ends_on.gte.${ymd},and(ends_on.is.null,starts_on.gte.${ymd})`),
  ]);

  const seen = new Set((own ?? []).map((r) => r.person_id));
  const series = [...new Set((mirrored ?? []).map((r) => r.series_id))];
  if (series.length) {
    const { data } = await sb.from('event_people').select('person_id').in('external_id', series);
    for (const r of data ?? []) seen.add(r.person_id);
  }
  return seen;
}
