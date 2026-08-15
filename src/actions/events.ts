// ============================================================================
// HQ-native events, and person tags (docs/plans/archive/13-agenda.md §5 and §2).
//
// Three actions: writing an event down, removing it, and tagging somebody on
// one. All run on the caller's session client, so RLS does the real work.
//
// ⚠ `setPeople` TAKES A SUBJECT, NOT AN EVENT ID, and the shape is what makes
// Piece 3 a small addition rather than a rewrite. HQ's tag layer is additive
// over BOTH halves of the calendar: an HQ event points at a row, a mirrored one
// points at Google's series id. §2's rule is that layering annotations on
// imported events "is additive and cannot create a conflict" — which is only
// true if the annotation never has to live inside Google's copy.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { blankToUndef, fail, optHhmm, optUuid, requireAdmin, type DB } from './_shared';
import { homeTimezone, localToday, parseYmd } from '../lib/hq/time';

const input = z.object({
  /** Absent on create. */
  id: optUuid,
  title: z.string().trim().min(1, 'An event needs a name.').max(300),
  // Required rather than `optYmd`: an event with no date is not an event.
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  /** Blank = all day. */
  startsAt: optHhmm,
  endsAt: optHhmm,
  location: z.preprocess(blankToUndef, z.string().max(300).optional()),
  notes: z.preprocess(blankToUndef, z.string().max(10_000).optional()),
  /** Who is there — replaces the whole list, like `interactions`. */
  personIds: z.array(z.uuid()).max(50).default([]),
});

/**
 * Replace an event's people.
 *
 * Delete-then-insert rather than a diff, exactly as `interactions` does: the
 * list is a handful of rows, a diff is more code than it saves, and this way
 * somebody removed in the editor is genuinely gone rather than depending on the
 * diff being right.
 *
 * ⚠ THE FAILURE POSTURE IS `interactions.setParticipants`'S — read the note
 * there, it argues the trade in full (plans/30 · §4). Between the two
 * statements the event carries no tags, so a failed insert leaves an event that
 * is on the calendar and on nobody's profile. A resave restores it; the sheet
 * stays open with the error, which is what makes that possible.
 *
 * ⚠ ONE THING IS *LESS* BAD HERE THAN NEXT DOOR AND ONE IS WORSE. Less: an
 * event survives losing its tags — it still renders on the grid with its title
 * and time, where an untagged interaction is invisible everywhere. Worse: this
 * is also `events.tag`'s write, and that one is called against a MIRRORED
 * Google row, where the tags are the only thing HQ owns about it (ADR-0014 —
 * we may never write to Google's copy). Losing those loses the whole of our
 * side of that event.
 */
async function setParticipants(sb: DB, eventId: string, personIds: string[]): Promise<void> {
  const { error: delErr } = await sb.from('event_people').delete().eq('event_id', eventId);
  if (delErr) throw fail(delErr.message);
  const rows = [...new Set(personIds)].map((person_id) => ({ event_id: eventId, person_id }));
  if (rows.length === 0) return;
  const { error } = await sb.from('event_people').insert(rows);
  if (error) throw fail(error.message);
}

export const events = {
  /** Put something in the calendar, or change it. */
  save: defineAction({
    accept: 'json',
    input,
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      const startsOn = parseYmd(v.startsOn);
      if (!startsOn) throw fail('That isn’t a real date.', 'BAD_REQUEST');

      const startsAt = v.startsAt?.slice(0, 5) ?? null;
      // An end with no beginning is not a time anybody can act on, and the
      // constraint would refuse it anyway — said here as a dropped value rather
      // than as a Postgres error, because it is a slip and not a decision.
      const endsAt = startsAt ? (v.endsAt?.slice(0, 5) ?? null) : null;

      const values = {
        title: v.title,
        starts_on: startsOn,
        starts_at: startsAt,
        ends_at: endsAt,
        location: v.location ?? null,
        notes: v.notes ?? null,
      };

      if (v.id) {
        const { data, error } = await sb.from('events').update(values).eq('id', v.id).select('id').single();
        if (error) throw fail(error.message);
        await setParticipants(sb, data.id, v.personIds);
        return data;
      }

      const { data, error } = await sb.from('events').insert(values).select('id').single();
      if (error) throw fail(error.message);
      await setParticipants(sb, data.id, v.personIds);
      return data;
    },
  }),

  /**
   * Tag somebody on anything on the calendar — the one write HQ has against a
   * mirrored row (§5's day panel).
   *
   * ⚠ ADDITIVE, AND NEVER A GUESS. 10-hq.md §10g: a wrong auto-tag corrupts the
   * log silently, and silent corruption of the log is the one thing this
   * database cannot survive. So this is only ever called by a person pressing a
   * control, never by a matcher.
   */
  tag: defineAction({
    accept: 'json',
    input: z
      .object({
        eventId: z.preprocess(blankToUndef, z.uuid().optional()),
        externalId: z.preprocess(blankToUndef, z.string().max(1024).optional()),
        personIds: z.array(z.uuid()).max(50).default([]),
      })
      // The same rule the CHECK constraint holds, said early enough to be a
      // sentence: exactly one subject.
      .refine((v) => !!v.eventId !== !!v.externalId, {
        message: 'A tag belongs to exactly one thing on the calendar.',
      }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      if (v.eventId) {
        await setParticipants(sb, v.eventId, v.personIds);
        return { eventId: v.eventId, count: v.personIds.length };
      }

      const { error: delErr } = await sb.from('event_people').delete().eq('external_id', v.externalId!);
      if (delErr) throw fail(delErr.message);
      const rows = [...new Set(v.personIds)].map((person_id) => ({ external_id: v.externalId!, person_id }));
      if (rows.length) {
        const { error } = await sb.from('event_people').insert(rows);
        if (error) throw fail(error.message);
      }
      return { externalId: v.externalId, count: v.personIds.length };
    },
  }),

  /**
   * Take it out of the calendar. The tags go with it by cascade.
   *
   * No trash tier, for the same reason `interactions` and `tasks` have none: an
   * event is private, unreferenced, and only ever deleted because it should not
   * be there. A drawer would mean the export and the nightly backup carry it
   * for ever, which is the opposite of what deleting it was for.
   */
  remove: defineAction({
    accept: 'json',
    input: z.object({ id: z.uuid() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const { error } = await sb.from('events').delete().eq('id', v.id);
      if (error) throw fail(error.message);
      return { id: v.id };
    },
  }),

  /**
   * Who is on the calendar today — the drift guard's one question (§8 of
   * 12-people.md, and the hole 12 · Piece 4 could not close).
   *
   * It lives here rather than in a page because both callers want it: the
   * roster and Today. Returns ids, so the caller can hand it straight to
   * `driftList` as a Set.
   */
  seenToday: defineAction({
    accept: 'json',
    input: z.object({}).optional(),
    handler: async (_v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const today = localToday(await homeTimezone(sb));
      const { data, error } = await sb
        .from('event_people')
        .select('person_id, events!inner(starts_on)')
        .eq('events.starts_on', today);
      if (error) throw fail(error.message);
      return { personIds: [...new Set((data ?? []).map((r) => r.person_id))] };
    },
  }),
};
