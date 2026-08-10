// ============================================================================
// Shared internals for the action modules (docs/admin.md §4, ADR-0005).
//
// Not a namespace — nothing here is callable from the client. This file holds
// the pieces more than one domain needs: the Zod helpers that cope with Astro's
// form encoding, the error constructor, the admin guard, and slug uniqueness.
// Domain-specific helpers stay with their domain (see `persist` in fragments.ts).
// ============================================================================
import { ActionError } from 'astro:actions';
import { z } from 'astro/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';

export type DB = SupabaseClient<Database>;

// --- Zod helpers: empty form fields arrive as '' — treat them as absent ------
//
// ⚠ USE THESE. Three action modules had re-declared `blankToUndef` verbatim and
// two had written `hhmm` byte-identically, because it was private here and easy
// to retype. It is exported now for exactly that reason: a validation helper
// that is cheaper to copy than to import will be copied.
export const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);
export const optText = z.preprocess(blankToUndef, z.string().optional());
export const optUrl = z.preprocess(blankToUndef, z.url('That doesn’t look like a URL').optional());
export const optInt = z.preprocess(blankToUndef, z.coerce.number().int().optional());
export const optUuid = z.preprocess(blankToUndef, z.uuid().optional());

/**
 * The two scalars HQ passes around as strings rather than as `Date`s.
 *
 * A local date is `YYYY-MM-DD` and a wall-clock time is `HH:MM`, both for the
 * reasons `src/lib/hq/time.ts` opens with: a `Date` has a zone to get wrong and
 * these do not. The regexes are the wire format's own shape — the semantic
 * check ("is 31 February a day?") is `parseYmd`'s job, not Zod's.
 */
export const optYmd = z.preprocess(
  blankToUndef,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
    .optional(),
);
/**
 * What `<input type="datetime-local">` puts on the wire: `YYYY-MM-DDTHH:MM`,
 * with some browsers adding `:SS`.
 *
 * ⚠ IT IS A REGEX BECAUSE THE ALTERNATIVE WAS A 500. This field used to be a
 * bare `optText` fed straight to `new Date(…).toISOString()`, so anything that
 * wasn't a date threw `RangeError` out of the handler and surfaced as an opaque
 * server error on a save — where a rejected *field* is the whole point of
 * having a schema. Same family as `optYmd` above, and the same division of
 * labour: this is the wire format's shape, and the "is that a real instant?"
 * check belongs at the conversion site (see `occurredAtFrom` in fragments.ts).
 */
export const optDatetimeLocal = z.preprocess(
  blankToUndef,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Expected a date and time')
    .optional(),
);
/** `<input type="time">` gives HH:MM, and some browsers add :SS. */
export const optHhmm = z.preprocess(
  blankToUndef,
  z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected HH:MM')
    .optional(),
);
/**
 * A comma-joined id list where EMPTY is a meaningful value, not absence
 * ("belongs to no constellation"). Astro's form→object step turns a blank
 * field into `null`, so a bare z.string() rejects the very case we mean.
 */
export const idList = z.preprocess((v) => (v == null ? '' : v), z.string());

/**
 * A fragment's tier: note → draft → published (docs/plans/09 Piece 2). `note`
 * is the private scratch level, and it is private *by construction* — the
 * public RLS policy is an allowlist on `status = 'published'`, so a new tier
 * can never leak by omission.
 */
export const fragmentStatus = z.enum(['note', 'draft', 'published']).default('draft');

/**
 * Constellations have no notes tier — and they need their own schema to say so.
 * `constellations.status` is a plain `text` column with a CHECK for
 * ('draft','published'), NOT the fragment_status enum, so a shared Zod const
 * would happily have let a constellation be filed as a note and only failed at
 * the database. Two lists, because they are two vocabularies.
 */
export const constellationStatus = z.enum(['draft', 'published']).default('draft');

export const fail = (
  message: string,
  code: ConstructorParameters<typeof ActionError>[0]['code'] = 'INTERNAL_SERVER_ERROR',
) => new ActionError({ code, message });

/**
 * Guard an action to the authenticated admin. `role` lives in app_metadata,
 * which is server-controlled — a user cannot grant it to themselves.
 *
 * **EVERY MUTATING HANDLER CALLS THIS, AND THAT IS THE WHOLE RULE.** No
 * judgement per action, nothing to weigh when adding one: if it writes, the
 * first line is `requireAdmin(ctx)`.
 *
 * ⚠ It is not the security boundary and never was — RLS is (architecture.md
 * §6), and the audit on 2026-08-08 verified the policies hold. Two reasons it
 * is mandatory anyway:
 *
 *   1. **RLS refuses silently.** A non-admin's `update`/`delete` matches zero
 *      rows, which is not an error, so the handler returns `{ ok: true }` and
 *      the interface says the save worked. A guard is the difference between
 *      "no" and a lie.
 *   2. **The old rule was "guard the actions that touch no RLS-protected
 *      table"** — the AI suggester and the Spotify lookup, which reach paid
 *      third-party APIs. It was correct and it did not survive contact with a
 *      growing tree: guarding ended up following module ancestry rather than
 *      policy, so every HQ namespace guarded and `constellations`, `vocabulary`
 *      and `site` did not, along with eight fragments handlers. Nobody decided
 *      that. A rule with an exception clause is a rule that gets copied wrong,
 *      and the copy is always the unguarded one.
 *
 * The one deliberate exception is `contact.send` — the public form on /about,
 * whose entire job is to be callable by a stranger. It says so in place.
 */
export function requireAdmin(ctx: { locals: App.Locals }): void {
  if (ctx.locals.user?.app_metadata?.role !== 'admin') {
    throw fail('Not authorized.', 'FORBIDDEN');
  }
}

/**
 * Every table that addresses a row by slug. Each one is its own namespace —
 * a subject and a fragment may both be `forgiveness` and neither is wrong.
 */
export type SluggedTable = 'fragments' | 'subjects' | 'authors' | 'works' | 'people' | 'goals' | 'constellations';

/**
 * A slug nobody else in `table` is using (data-model.md §6).
 *
 * ⚠ **THE TABLE IS A PARAMETER BECAUSE IT USED NOT TO BE, AND THAT COST US
 * THREE COPIES AND A BUG.** This function was hard-wired to `fragments`. So
 * `people` and `goals` each wrote their own probe rather than check the wrong
 * namespace (both said so in a comment), `constellations.save` inlined a fourth
 * loop, and `subjects`/`authors`/`works` called this one *as-is* — checking
 * vocabulary slugs against the fragments table, which is not a check at all.
 * A real collision surfaced there as a raw Postgres unique-violation string,
 * and the `.catch(() => slugify(…))` that wrapped every one of those calls
 * swallowed genuine database errors on the way past. One function with a table
 * argument is what all four of those were working around.
 *
 * The probe is linear rather than a single `like` query on purpose: these are
 * small tables, the loop is readable, and it stops at the first free number
 * instead of sorting a result set to find one.
 */
export async function uniqueSlug(sb: DB, table: SluggedTable, base: string, excludeId?: string): Promise<string> {
  const root = base || 'untitled';
  for (let i = 0; i < 60; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    // One cast, at the one boundary, and it is narrow on purpose: `from()`
    // over a UNION of table names gives a union of builders, and TypeScript
    // collapses the column names across it to `never` — `.eq('slug', …)` stops
    // compiling even though every table involved has that column. Standing in
    // one concrete table keeps the query typed instead of widening it to `any`.
    // What makes it safe is `SluggedTable` itself: membership of that union IS
    // the claim that the row has `id` and `slug`, so adding a table without
    // them is the mistake to catch, and it is caught one line up rather than
    // here.
    let q = sb
      .from(table as 'fragments')
      .select('id')
      .eq('slug', candidate)
      .limit(1);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q;
    if (error) throw fail(error.message);
    if (!data || data.length === 0) return candidate;
  }
  throw fail('Could not find a free URL for that name.');
}
