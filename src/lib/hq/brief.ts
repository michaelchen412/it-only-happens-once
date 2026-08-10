// The brief — what you last knew, at the moment you need it
// (docs/plans/12-people.md §2a).
//
// ⚠ THIS IS THE PIECE THAT PAYS THE LOGGING BACK, and §2a says why it matters
// more than any other line on Today: *"logging stops being deposits into a void
// and becomes the thing that made tonight go better."* It is the direct answer
// to *"I don't want to meet someone for the first time every couple years."*
// 12 · Piece 4 deferred it here because it hangs off a people-tagged EVENT, and
// there was no `events` table until 13 · Piece 4.
//
// ⚠ FOUR LINES, FOUR SOURCES, LABELLED AS SUCH. The people lab's round-2
// prototype rendered them as one tidy bullet list and it read as a
// SYSTEM-WRITTEN SUMMARY OF THE FRIENDSHIP — the single worst thing this surface
// could be. They are labelled by source because they genuinely are four
// different queries, and the labels are what stop the page implying it
// understands anything:
//
//   the header      events ⋈ event_people   only when you tagged the event
//   Last contact    person_last_contact     needs a logged interaction
//   Then            interactions.body       YOUR WORDS, VERBATIM — never a summary
//   Shared          person_works/_fragments a different table again
//   Birthday        people.birth_month/day  always available
//
// The **Then** line is the one that matters, and nothing generates or condenses
// it. It is clamped by CSS so the full text stays in the DOM.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { plainish, rowTitle, type FragmentType } from '../fragments-display';
import { one } from './relations';
import { PERSON_CARD_COLUMNS, type PersonCard } from './people';
import type { Ymd } from './time';

type DB = SupabaseClient<Database>;

/**
 * ⚠ THREE BRIEFS, THEN NAMES ONLY.
 *
 * A brief exists to be read before a conversation, and three is what fits in the
 * head on the way out of the door. A table of six is the "wall of people" that
 * 10-hq.md §3 forbids arriving through a side entrance — and it would arrive on
 * the one morning you were already busy, which is when it would be worst.
 */
export const BRIEF_CAP = 3;

export interface Brief {
  /** A face and the facts a brief prints — never the bio (plans/30 · §6). */
  person: PersonCard;
  /** The event that put them here — earliest of the day if there are several. */
  event: { id: string; title: string; at: string | null };
  /** `person_last_contact`. Null means no logged entry, which is NOT "long ago". */
  lastOn: Ymd | null;
  /** `interactions.body` for that entry, verbatim. Your words, clamped by CSS. */
  then: string | null;
  /** The newest thing on their shelf, as one line. The profile holds the rest. */
  shelf: string | null;
}

/** `2 Nov` — the birthday line's register: a bare day and month, never a year. */
export function birthdayLine(person: Pick<PersonCard, 'birth_month' | 'birth_day'>): string | null {
  if (!person.birth_month || !person.birth_day) return null;
  const month = new Date(Date.UTC(2001, person.birth_month - 1, 1)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
  });
  return `${person.birth_day} ${month}`;
}

/**
 * Everybody you are seeing today, with what you last knew about them.
 *
 * TWO WAVES, AND USUALLY NEITHER — the first query is the gate, and on a day
 * with no tagged event it returns nothing and the rest never run. That ordering
 * is deliberate: this is the front door, and the common morning must not pay
 * for the uncommon one.
 *
 * Everything after the gate goes out in ONE `Promise.all`, so the wall-clock
 * cost is a single round trip's worth however the queries divide — and every
 * one of them is bounded, by `.in(...)` over the three capped ids or by a
 * `.limit(1)` per person. Both halves matter: batching alone still let the
 * last-contact read return an entire logging history (plans/30 · §6).
 *
 * Never throws. A failure here should cost the brief, not the page.
 */
export async function briefsFor(sb: DB, ymd: Ymd): Promise<Brief[]> {
  const { data: tagged } = await sb
    .from('event_people')
    // Columns rather than `people(*)`: a brief prints a face, a name and an
    // epithet, and pulling the bio to do it is the same fault Today had.
    .select(`person_id, people(${PERSON_CARD_COLUMNS}), events!inner(id, title, starts_on, starts_at)`)
    .eq('events.starts_on', ymd);

  // One brief per PERSON, not per tag: two events with the same person is one
  // person to prepare for.
  const people = new Map<string, PersonCard>();
  const events = new Map<string, Brief['event'][]>();
  for (const row of tagged ?? []) {
    const person = one<PersonCard>(row.people);
    const event = one<{ id: string; title: string; starts_at: string | null }>(row.events);
    if (!person || !event) continue;
    // Archived: they were deliberately removed from the roster, and a brief is
    // the roster speaking. The event itself still renders in the agenda zone.
    if (person.archived_at) continue;
    people.set(person.id, person);
    const list = events.get(person.id) ?? [];
    list.push({ id: event.id, title: event.title, at: event.starts_at ? event.starts_at.slice(0, 5) : null });
    events.set(person.id, list);
  }
  if (people.size === 0) return [];

  // All-day before timed, then the clock — the same order `byTime` gives a day,
  // so the header names whichever thing arrives first.
  const order = (a: Brief['event'], b: Brief['event']) =>
    a.at === b.at ? a.title.localeCompare(b.title) : a.at === null ? -1 : b.at === null ? 1 : a.at < b.at ? -1 : 1;

  // The cap is applied BEFORE the remaining queries: three briefs is what will
  // render, so a dinner party of nine must not cost nine people's history.
  const briefs: Brief[] = [...people.values()]
    .map((person) => ({
      person,
      event: [...events.get(person.id)!].sort(order)[0],
      lastOn: null,
      then: null,
      shelf: null,
    }))
    .sort((a, b) => order(a.event, b.event) || a.person.display_name.localeCompare(b.person.display_name))
    .slice(0, BRIEF_CAP);
  const ids = briefs.map((b) => b.person.id);

  const [entries, { data: workLinks }, { data: fragmentLinks }] = await Promise.all([
    // The last entry AND its body in one read per person. `person_last_contact`
    // gives the date only, and the "Then" line is the body — asking the view for
    // the date and then the table for the words would be two queries answering
    // one question, with a window between them where they can disagree.
    //
    // ⚠ ONE BOUNDED READ EACH, NOT ONE UNBOUNDED READ FOR ALL THREE, and the
    // difference is linear in your logging history on the most-visited page in
    // the application (plans/30 · §6). The `.in(...)` version asked for EVERY
    // interaction row these people appear on — dates *and* full bodies, up to
    // 20k characters apiece, unordered and uncapped — to use exactly one of
    // them. It read as batched because it was one query; it was one query that
    // grew for ever. PostgREST cannot cap rows per group, so the honest shape
    // is to ask each person's question separately and cap it at 1 — at most
    // three of them, they leave together, and they land in the same wave as
    // the two below.
    //
    // Ordered by `created_at` after the day, so two entries logged for the same
    // date resolve to the one written last rather than to whichever the planner
    // happened to return. The old code's `>` comparison kept the FIRST of a tie,
    // which was arbitrary in exactly the same way and simply undocumented.
    Promise.all(
      ids.map((id) =>
        sb
          .from('interactions')
          .select('occurred_on, body, interaction_people!inner(person_id)')
          .eq('interaction_people.person_id', id)
          .order('occurred_on', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    ),
    sb
      .from('person_works')
      .select('person_id, created_at, works(title, authors(name))')
      .in('person_id', ids)
      .order('created_at', { ascending: false }),
    sb
      .from('person_fragments')
      .select('person_id, created_at, fragments(type, title, body, attribution, deleted_at)')
      .in('person_id', ids)
      .order('created_at', { ascending: false }),
  ]);

  // Positional, because `ids` is what fanned the reads out — each answer is
  // already its person's newest entry, so there is nothing left to compare.
  const last = new Map<string, { on: Ymd; body: string }>();
  ids.forEach((id, i) => {
    const e = entries[i]?.data;
    if (e) last.set(id, { on: e.occurred_on as Ymd, body: e.body });
  });

  // ⚠ A WORK BEATS A FRAGMENT, always — and it is the two-hop edge that makes
  // the shelf worth having (12 §5): "Piranesi — Susanna Clarke" is what they
  // gave you, where a single quote out of it is one thing that came from it.
  const shelf = new Map<string, string>();
  for (const row of workLinks ?? []) {
    if (shelf.has(row.person_id)) continue;
    const w = one<{ title: string; authors: { name: string } | null }>(row.works);
    if (w) shelf.set(row.person_id, w.authors?.name ? `${w.title} — ${w.authors.name}` : w.title);
  }
  for (const row of fragmentLinks ?? []) {
    if (shelf.has(row.person_id)) continue;
    const f = one<{
      type: FragmentType;
      title: string | null;
      body: string | null;
      attribution: string | null;
      deleted_at: string | null;
    }>(row.fragments);
    // A fragment in the trash is not on the shelf — the same rule `sharedFor`
    // keeps, so the brief and the profile can never disagree about what is there.
    // `plainish`, not the same three `.replace`s written out again — this was
    // the picker's rule re-inlined verbatim, and a shelf line that kept its
    // asterisks while the picker dropped them would have been the first sign
    // (plans/29 · §3).
    if (f && !f.deleted_at) shelf.set(row.person_id, plainish(rowTitle(f)));
  }

  return briefs.map((b) => ({
    ...b,
    lastOn: last.get(b.person.id)?.on ?? null,
    then: last.get(b.person.id)?.body?.trim() || null,
    shelf: shelf.get(b.person.id) ?? null,
  }));
}
