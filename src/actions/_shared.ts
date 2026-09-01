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
import { slugify } from '../lib/slug';

export type DB = SupabaseClient<Database>;

// --- Zod helpers: an empty form field is ABSENT, and Astro got there first ---
//
// ⚠ AN EMPTY FIELD NEVER REACHES YOUR SCHEMA AS `''`, WHICH IS THE OPPOSITE OF
// WHAT THIS HEADER USED TO SAY. `accept: 'form'` runs the FormData through
// Astro's own coercion first, and `handleFormDataGet` answers on FALSINESS:
// a plain `z.string().optional()` gets `undefined`, and a `z.preprocess(…)`
// (a pipe, so not an optional at the outer layer) gets `null`. Either way the
// empty string is gone before Zod runs, and `blankToUndef` earns its keep on
// the `v == null` half, not the `v === ''` one.
//
// So AN ACTION CANNOT TELL "cleared" FROM "not sent". `constellations.save`
// tried, with a `!== undefined` sentinel meaning "absent → leave as-is, empty →
// clear", and the clearing half was dead code: emptying a constellation's score
// and pressing Save wrote nothing (fixed 2026-08-11). If a field needs to be
// clearable, the ACTION must own the whole row and write `null` for what didn't
// arrive — and callers that mean to change one field get their own narrow
// action, as `constellations.setStatus`/`setColor` do.
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
 *
 * The tuple is exported beside the schema because the DEFAULT is not always
 * wanted: `constellations.save` needs it (an unchecked switch sends no field,
 * and that is what makes a draft a draft), while `setStatus` must not have it
 * (there the field is the entire message, so a missing one is a bug, not a
 * draft). One list, two schemas over it.
 */
export const CONSTELLATION_STATUSES = ['draft', 'published'] as const;
export const constellationStatus = z.enum(CONSTELLATION_STATUSES).default('draft');

/**
 * The codes that mean **something broke**, as opposed to **the answer is no**.
 *
 * The distinction is the whole of the logging rule below, and it maps to the
 * HTTP families it is named after: a 5xx is this application failing at its job
 * and nobody outside can act on it; a 4xx is a refusal working exactly as
 * designed, and the person who caused it is already reading the sentence.
 */
const SERVER_FAULT = new Set([
  'INTERNAL_SERVER_ERROR',
  'NOT_IMPLEMENTED',
  'BAD_GATEWAY',
  'SERVICE_UNAVAILABLE',
  'GATEWAY_TIMEOUT',
]);

/**
 * The one constructor for every refusal and every fault in this layer.
 *
 * ⚠ A SERVER FAULT IS LOGGED HERE, AND A REFUSAL IS NOT — plan 41 · §6.
 *
 * Before this, **a production failure had nowhere to go.** There were four
 * `console.error` calls in the entire server tree, all for model calls, and
 * everything else failed into a sentence on the reader's screen and vanished.
 * The most common shape in this layer by a distance is
 * `if (error) throw fail(error.message)` — a Postgres error, converted to a
 * user sentence, never recorded: **144 of the calls here take that default.**
 * So a broken query, a policy that started refusing, a column that moved,
 * looked from the server exactly like a quiet afternoon.
 *
 * ⚠ WHY HERE AND NOT AT THE 144 CALL SITES, which is what §6 first proposed:
 * one edit cannot be applied to 143 of them. The failure mode of a convention
 * that has to be re-remembered at every new site is written all over this
 * codebase — it is why `action-error.ts` exists, and why `requireAdmin` is
 * mandatory rather than judged per action. A rule with 144 chances to be
 * forgotten is not a rule.
 *
 * ⚠ AND THE STACK IS THE PART THAT MAKES IT USEFUL. The message is a sentence
 * written for a stranger — "Couldn't save that" names nothing a maintainer can
 * search for. The stack's second frame is the `throw fail(…)` that produced it,
 * so the log line carries the file and line without any handler having to name
 * itself.
 *
 * ⚠ IT IS `console.error`, DELIBERATELY, AND NOTHING MORE. Vercel retains
 * function logs, so this is findable; it does not ALERT, and nobody is told.
 * That gap is real and was accepted rather than overlooked — closing it means a
 * reporting dependency inside the server bundle, which means the `noExternal`
 * closure question, which is a decision rather than a detail.
 */
export const fail = (
  message: string,
  code: ConstructorParameters<typeof ActionError>[0]['code'] = 'INTERNAL_SERVER_ERROR',
) => {
  const error = new ActionError({ code, message });
  if (SERVER_FAULT.has(code)) console.error(`[action] ${code}: ${message}`, error.stack);
  return error;
};

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
export type SluggedTable =
  'fragments' | 'subjects' | 'authors' | 'works' | 'people' | 'goals' | 'constellations' | 'sets' | 'shelves';

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

/**
 * The slug a fragment save should write.
 *
 * ⚠ **A FRAGMENT THAT HAS EVER BEEN PUBLISHED KEEPS THE SLUG IT HAS.** Both
 * save paths used to re-derive on every write — writing from its title, a quote
 * from its attribution plus the first words of its body — and neither sheet
 * sent a slug, so the derivation ran unopposed every time. Retitling a
 * published essay therefore *changed its URL*, and the old one hard 404s
 * (`blog/[slug].astro` sets the status explicitly). For a quote it was worse:
 * the slug comes from the BODY, so fixing a typo moved the address. Nothing
 * warned, and every link already handed out died silently.
 *
 * `published_at` is the right question rather than `status === 'published'`,
 * and the difference is a real case: a piece that was published and later
 * pulled back to draft has still been out in the world, so its URL is still
 * owed to whoever holds it. The column is set once, on first publish, and never
 * cleared — which is exactly the fact "has this ever had a public address?"
 * needs. No new column, and no migration.
 *
 * An explicit `override` still wins, because the escape hatch is the point: the
 * freeze makes a URL durable, and the field in the sheet makes changing one a
 * decision rather than a side effect of editing prose. The override is still
 * slugified and still uniquified — a hand-typed value cannot smuggle in
 * punctuation or collide with someone else's row.
 *
 * ⚠ `id` being present does NOT mean the row exists: ids are minted
 * client-side, so a first save is an insert-with-id. A miss here is a create,
 * and falls through to the derivation.
 */
export async function fragmentSlug(sb: DB, args: { id?: string; override?: string; base: string }): Promise<string> {
  const explicit = args.override?.trim();
  if (args.id && !explicit) {
    const { data, error } = await sb.from('fragments').select('slug, published_at').eq('id', args.id).maybeSingle();
    if (error) throw fail(error.message);
    if (data?.published_at && data.slug) return data.slug;
  }
  return uniqueSlug(sb, 'fragments', slugify(explicit || args.base), args.id);
}
