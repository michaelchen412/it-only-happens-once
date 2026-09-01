// ============================================================================
// Shelves — where a jotting lives when it is never going to be a piece.
// Bench: /lab/shelves · decided 2026-09-01 · migration
// `20260901171801_a_jotting_lives_on_a_shelf.sql`
//
// THE CLAIM, in one line: **filing to a shelf is triage.** The pile's four
// exits — the Agenda, a log entry, a quote, a piece — all REMOVE the note, so
// a thought kept on purpose was indistinguishable from one not yet dealt with
// and the pile could only ever grow. Unshelved is the inbox; shelved is kept.
//
// ⚠ THIS IS NOT A SUBJECT AND THE TWO MUST NOT MERGE. A subject is what a piece
// is ABOUT and it is PUBLIC (rendered on `PostCard` and `PostArticle`); a shelf
// is what a jotting is FOR and no reader ever sees one. The migration header
// argues it at length — read that before adding a `kind` column to either.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

type DB = SupabaseClient<Database>;

/**
 * How many drawers one note may sit in.
 *
 * ⚠ DECIDED ON THE BENCH (2026-09-01), against the cheaper single-valued
 * schema, and enforced on the SERVER rather than left to the chooser — the
 * whole difference between the two designs is this number, and a cap that lives
 * only in a menu is a cap that a second caller will not have. It is also what
 * keeps the axis honest: two is *"this is reading I keep, and it is also a note
 * to myself"*; unbounded is a tag vocabulary arriving by the back door, which
 * is the failure mode `/lab/shelves` names as its second way of losing.
 *
 * One owner, imported by the action and by the room — the `MIN_SEARCH` pattern.
 */
export const MAX_SHELVES = 2;

export interface ShelfRef {
  id: string;
  name: string;
  slug: string;
}

/** The vocabulary, in its authored order (`sort`, not alphabetical). */
export async function listShelves(sb: DB): Promise<ShelfRef[]> {
  const { data } = await sb.from('shelves').select('id, name, slug').order('sort');
  return data ?? [];
}

/**
 * Which shelves each of `ids` sits on, in the vocabulary's own order — so a
 * note's chips always read in the same sequence as the filter row above them.
 * (`constellationsByFragment` in `fragment-query.ts` sorts for the same reason.)
 */
export async function shelvesByFragment(sb: DB, ids: string[], vocab: ShelfRef[]): Promise<Record<string, ShelfRef[]>> {
  const out: Record<string, ShelfRef[]> = {};
  if (!ids.length) return out;
  const byId = new Map(vocab.map((s) => [s.id, s]));
  const order = new Map(vocab.map((s, i) => [s.id, i]));
  const { data } = await sb.from('fragment_shelves').select('fragment_id, shelf_id').in('fragment_id', ids);
  for (const l of data ?? []) {
    const ref = byId.get(l.shelf_id);
    if (ref) (out[l.fragment_id] ??= []).push(ref);
  }
  for (const refs of Object.values(out)) refs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return out;
}

/**
 * How many live notes sit on each shelf, plus how many sit on none.
 *
 * ⚠ COUNTED OVER THE WHOLE PILE, NEVER THE FILTERED SLICE. Pressing a shelf
 * must not change the number beside another one — the manager's type segments
 * take their counts from a separate query for exactly this reason, and a badge
 * that moves when you press its neighbour is a badge nobody can trust.
 */
export async function shelfCounts(sb: DB): Promise<{ byShelf: Record<string, number>; inbox: number }> {
  const { data: notes } = await sb.from('fragments').select('id').eq('status', 'note').is('deleted_at', null);
  const ids = (notes ?? []).map((n) => n.id);
  const byShelf: Record<string, number> = {};
  if (!ids.length) return { byShelf, inbox: 0 };

  const { data: links } = await sb.from('fragment_shelves').select('fragment_id, shelf_id').in('fragment_id', ids);
  const shelved = new Set<string>();
  for (const l of links ?? []) {
    byShelf[l.shelf_id] = (byShelf[l.shelf_id] ?? 0) + 1;
    shelved.add(l.fragment_id);
  }
  return { byShelf, inbox: ids.length - shelved.size };
}
