// ============================================================================
// People mutations (docs/plans/12-people.md, ADR-0012).
//
// Four actions, because there are four separate motions, and keeping them
// separate is what lets each one send only what it owns:
//
//   save         the fixed facts — the add sheet and the header's pencil
//   saveBio      the standing description, edited on its own block
//   setPhoto     persist an object path AFTER the browser has uploaded it
//   setArchived  put someone in the drawer, or take them out again
//
// THE FIXED-FACTS FORM SENDS EVERY FIELD EVERY TIME, and must: a merge-only
// patch can never clear a value you changed your mind about, which is why an
// empty field here means `null` rather than "leave it alone". That is the same
// rule the check-in follows, for the same reason.
//
// Runs on `ctx.locals.supabase`, the caller's session client, so RLS is doing
// the real work. This layer validates and converts; it is not the boundary.
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { fail, requireAdmin, type DB } from './_shared';
import { monthsToDays, personSlug, PHOTO_BUCKET } from '../lib/hq/people';

/**
 * A text field where BLANK MEANS NULL, not "absent".
 *
 * Astro turns an empty form field into `null` and a whitespace-only one into
 * whitespace; both mean the same thing to a person clearing a field, and both
 * have to reach the database as `null` or "delete what you typed" silently
 * fails (see the `idList` note in _shared.ts — the same trap, other direction).
 */
const nullableText = (max: number) =>
  z.preprocess((v) => {
    const s = typeof v === 'string' ? v.trim() : v;
    return s === '' || s == null ? null : s;
  }, z.string().max(max).nullable());

/** Same rule for a number: blank clears it. */
const nullableInt = (min: number, max: number) =>
  z.preprocess((v) => {
    const s = typeof v === 'string' ? v.trim() : v;
    return s === '' || s == null ? null : s;
  }, z.coerce.number().int().min(min).max(max).nullable());

const facts = z.object({
  /** Absent on create. The client does not mint ids here — the database does. */
  id: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().uuid().optional()),

  displayName: z.string().trim().min(1, 'A name is the one thing this needs.').max(120),
  circle: z.enum(['family', 'friends', 'professional']),

  // NO `fullName` OR `sortName` HERE, and their absence is the same decision as
  // the sheet's. §10 draws that form at eight fields on the argument that a
  // form demanding nine to add a friend is a form you avoid — so adding a ninth
  // to reach a column would contradict the reason the column's own sheet was
  // designed the way it was. The columns exist (§9) and the export carries
  // them; the piece that needs them gives them a surface.
  epithet: nullableText(280),
  location: nullableText(120),

  birthMonth: nullableInt(1, 12),
  birthDay: nullableInt(1, 31),
  birthYear: nullableInt(1850, 2200),
  knownSinceYear: nullableInt(1850, 2200),

  /** In MONTHS on the wire, days in the database — see `monthsToDays`. */
  cadenceMonths: z.coerce.number().int().min(1).max(120).default(12),
  birthdayLeadDays: z.coerce.number().int().min(0).max(365).default(30),
});

/** The longest a month can be. February takes 29 — a leap-day birthday is real. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * The birthday rules, checked here so they fail as a sentence rather than as a
 * constraint violation.
 *
 * These mirror `people_birthday_is_a_pair`, `people_birth_year_needs_the_day`
 * and `people_birthday_exists` exactly. The database still holds them — this
 * layer is a courtesy, not the guarantee, and the migration says so.
 */
function assertBirthday(month: number | null, day: number | null, year: number | null): void {
  if ((month == null) !== (day == null)) {
    throw fail('A birthday needs both a month and a day.', 'BAD_REQUEST');
  }
  if (year != null && month == null) {
    throw fail('A birth year on its own has nowhere to show — add the month and day too.', 'BAD_REQUEST');
  }
  if (month != null && day != null && day > DAYS_IN_MONTH[month - 1]) {
    throw fail('That day doesn’t exist in that month.', 'BAD_REQUEST');
  }
}

/**
 * A slug nobody else is using.
 *
 * Its own function rather than `_shared`'s `uniqueSlug`, which is bound to the
 * `fragments` table — people and fragments do not share a namespace, and
 * nothing is gained by pretending they do. Archived rows still count: they keep
 * their address so an old link resolves.
 */
async function uniquePersonSlug(sb: DB, base: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { data, error } = await sb.from('people').select('id').eq('slug', candidate).limit(1);
    if (error) throw fail(error.message);
    if (!data || data.length === 0) return candidate;
  }
  throw fail('Could not find a free URL for that name.');
}

export const people = {
  /**
   * Create or update the fixed facts.
   *
   * ONE RULE SHAPES THE ADD SHEET: name + circle is enough to create (§10).
   * Everything else is optional and fillable later from the profile, because a
   * form that demands nine fields to add a friend is a form you avoid — and an
   * avoided form means an empty roster, which is the failure mode the whole
   * workstream is written against.
   */
  save: defineAction({
    accept: 'json',
    input: facts,
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      assertBirthday(v.birthMonth, v.birthDay, v.birthYear);

      const values = {
        display_name: v.displayName,
        circle: v.circle,
        epithet: v.epithet,
        location: v.location,
        birth_month: v.birthMonth,
        birth_day: v.birthDay,
        birth_year: v.birthYear,
        known_since_year: v.knownSinceYear,
        cadence_days: monthsToDays(v.cadenceMonths),
        birthday_lead_days: v.birthdayLeadDays,
      };

      // THE SLUG IS MINTED ONCE AND NEVER RE-MINTED. Renaming somebody must not
      // move their profile: the URL is in browser history and in whatever else
      // has already linked to it, and a rename is a far more ordinary event
      // here than for a fragment — "Kate" becomes "Mum", a surname changes.
      // Nothing about the address needs to track the name.
      if (v.id) {
        const { data, error } = await sb.from('people').update(values).eq('id', v.id).select('id, slug').single();
        if (error) throw fail(error.message);
        return data;
      }

      const slug = await uniquePersonSlug(sb, personSlug(v.displayName));
      const { data, error } = await sb
        .from('people')
        .insert({ ...values, slug })
        .select('id, slug')
        .single();
      if (error) throw fail(error.message);
      return data;
    },
  }),

  /**
   * The standing description — "who they are", in Michael's own words.
   *
   * Its own action because it is its own block with its own pencil, and because
   * it is the one long field here: sending a few paragraphs of prose every time
   * somebody corrects a birthday would be silly, and sending the birthday every
   * time the prose changes is how a stale form overwrites a fresh fact.
   */
  saveBio: defineAction({
    accept: 'json',
    input: z.object({ id: z.string().uuid(), bio: nullableText(20_000) }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const { data, error } = await sb.from('people').update({ bio: v.bio }).eq('id', v.id).select('id').single();
      if (error) throw fail(error.message);
      return data;
    },
  }),

  /**
   * Record the photo the browser has just uploaded, and clean up the old one.
   *
   * The upload itself happens client-side against the private bucket, using the
   * signed-in session — storage RLS (`is_admin()`) is the boundary there, the
   * same as every other upload in the app. This action only moves the pointer.
   *
   * ⚠ The path is CHECKED AGAINST THE PERSON'S OWN PREFIX. Without that, a
   * caller could point one person's `photo_path` at any object in the bucket,
   * and the render path signs whatever the column says. It is a cheap check and
   * the alternative is a confused-deputy hole in the one private bucket.
   */
  setPhoto: defineAction({
    accept: 'json',
    input: z.object({ id: z.string().uuid(), path: z.string().max(400).nullable() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      if (v.path && !v.path.startsWith(`people/${v.id}/`)) {
        throw fail('That photo doesn’t belong to this person.', 'BAD_REQUEST');
      }

      const { data: before, error: readErr } = await sb.from('people').select('photo_path').eq('id', v.id).single();
      if (readErr) throw fail(readErr.message);

      const { data, error } = await sb
        .from('people')
        .update({ photo_path: v.path })
        .eq('id', v.id)
        .select('id, photo_path')
        .single();
      if (error) throw fail(error.message);

      // Delete the replaced object AFTER the row is updated, and never let a
      // failure here fail the call: a stale byte in a private bucket costs
      // nothing, while a photo that appears not to have saved because the
      // cleanup threw would send you round the loop again.
      const old = before?.photo_path;
      if (old && old !== v.path) {
        await sb.storage.from(PHOTO_BUCKET).remove([old]);
      }

      return data;
    },
  }),

  /**
   * Archiving — the only way somebody leaves the roster (§3).
   *
   * EXPLICIT, NEVER AUTOMATIC, however long the silence, and reversible from
   * the archived section. It keeps every row: this is putting a photo in a
   * drawer, not a judgement, and it is also the release valve for the one-year
   * drift notice that arrives with Piece 4.
   */
  setArchived: defineAction({
    accept: 'json',
    input: z.object({ id: z.string().uuid(), archived: z.boolean() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const { data, error } = await sb
        .from('people')
        .update({ archived_at: v.archived ? new Date().toISOString() : null })
        .eq('id', v.id)
        .select('id, slug, archived_at')
        .single();
      if (error) throw fail(error.message);
      return data;
    },
  }),
};
