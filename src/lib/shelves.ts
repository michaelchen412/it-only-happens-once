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

/** One read of the whole shelf picture — see `readShelfIndex`. */
export interface ShelfIndex {
  /** The vocabulary, in its authored order (`sort`, not alphabetical). */
  vocab: ShelfRef[];
  /** Every LIVE note, newest-touched first. Ids and stamps only — no bodies. */
  notes: { id: string; updatedAt: string }[];
  /** Note id → the shelves it sits on, in the vocabulary's order. */
  byFragment: Record<string, ShelfRef[]>;
  /** Shelf id → how many live notes sit on it. */
  byShelf: Record<string, number>;
  /** How many live notes sit on no shelf at all — the inbox. */
  inbox: number;
  /** The live notes that sit on at least one shelf; the inbox is the complement. */
  shelved: Set<string>;
}

/**
 * Everything the pile needs to know about shelves, in ONE round trip.
 *
 * ⚠ THIS REPLACED THREE SEQUENTIAL FUNCTIONS — `listShelves`, `shelfCounts`
 * and `shelvesByFragment` — AND THE POINT WAS THE LATENCY, NOT THE TIDINESS.
 * The room awaited them one after another, and `shelfCounts` fetched the whole
 * of `fragment_shelves` only for the page to fetch it AGAIN a line later to
 * work out the inbox. Measured 2026-09-18: **eight sequential Supabase round
 * trips** to render this room at ~53ms each, of which these were four — about
 * 210ms of the ~420ms that stood in front of the first byte, every time a shelf
 * was pressed or a search key was typed. Michael: *"a lot of these actions on
 * the notes page seem to take a long time."*
 *
 * The three queries here are independent, so they cost one round trip rather
 * than three, and everything downstream is derived in memory from what they
 * bring back. That is affordable precisely because all three are narrow: two id
 * columns and a 40-character name.
 *
 * ⚠ THE COUNTS ARE OVER THE WHOLE PILE, NEVER A FILTERED SLICE — the rule
 * `shelfCounts` carried and the reason it queried separately. Pressing a shelf
 * must not change the number beside another one, and a badge that moves when
 * you press its neighbour is a badge nobody can trust. Deriving from the whole
 * link table keeps that true by construction rather than by a second query.
 *
 * ⚠ AND A LINK CAN OUTLIVE ITS NOTE. `fragment_shelves` cascades on a hard
 * delete, but the pile deletes SOFTLY (`deleted_at`), so the link table holds
 * rows for notes no room should count. `live` is the filter that makes every
 * number here a number of things you can actually see.
 */
export async function readShelfIndex(sb: DB): Promise<ShelfIndex> {
  const [{ data: vocabRows }, { data: noteRows }, { data: linkRows }] = await Promise.all([
    sb.from('shelves').select('id, name, slug').order('sort'),
    // Newest-touched first, and the ORDER IS LOAD-BEARING: the room slices this
    // list to its ceiling, so the notes it keeps must be the newest ones.
    // Editing a thought is thinking about it again, and it belongs at the top.
    sb
      .from('fragments')
      .select('id, updated_at')
      .eq('status', 'note')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false }),
    sb.from('fragment_shelves').select('fragment_id, shelf_id'),
  ]);

  const vocab = vocabRows ?? [];
  const notes = (noteRows ?? []).map((n) => ({ id: n.id, updatedAt: n.updated_at }));

  const byId = new Map(vocab.map((s) => [s.id, s]));
  const order = new Map(vocab.map((s, i) => [s.id, i]));
  const live = new Set(notes.map((n) => n.id));

  const byFragment: Record<string, ShelfRef[]> = {};
  const byShelf: Record<string, number> = {};
  const shelved = new Set<string>();

  for (const l of linkRows ?? []) {
    if (!live.has(l.fragment_id)) continue;
    const ref = byId.get(l.shelf_id);
    if (!ref) continue;
    (byFragment[l.fragment_id] ??= []).push(ref);
    byShelf[ref.id] = (byShelf[ref.id] ?? 0) + 1;
    shelved.add(l.fragment_id);
  }

  // In the vocabulary's own order, so a note's chips always read in the same
  // sequence as the filter row above them (`constellationsByFragment` in
  // `fragment-query.ts` sorts for the same reason).
  for (const refs of Object.values(byFragment)) {
    refs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  return { vocab, notes, byFragment, byShelf, inbox: notes.length - shelved.size, shelved };
}

/**
 * Which note ids the room should show, newest-touched first and UNCAPPED.
 *
 * ⚠ PURE, AND SEPARATE FROM THE FETCH, so the one piece of reasoning that
 * decides what the inbox means can be unit-tested without a database. The rule
 * it encodes is the room's founding claim: **unshelved is the inbox.**
 *
 * ⚠ IT RETURNS THE WHOLE SET RATHER THAN A PAGE, and the caller slices. That is
 * what lets the room say how many it is holding back instead of the older
 * "there are more than this" — see `notes.astro`'s ceiling.
 */
export function idsInView(index: ShelfIndex, shelf: ShelfRef | null): string[] {
  const on = (id: string) => (index.byFragment[id] ?? []).some((s) => s.id === shelf!.id);
  return index.notes.filter((n) => (shelf ? on(n.id) : !index.shelved.has(n.id))).map((n) => n.id);
}

/** The vocabulary, in its authored order (`sort`, not alphabetical). */
export async function listShelves(sb: DB): Promise<ShelfRef[]> {
  const { data } = await sb.from('shelves').select('id, name, slug').order('sort');
  return data ?? [];
}
