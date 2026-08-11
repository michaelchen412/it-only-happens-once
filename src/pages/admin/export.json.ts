// GET /admin/export.json — the whole corpus as one portable file (plan 05·2).
//
// WHAT THIS IS FOR, precisely, because it is NOT disaster recovery. That job is
// already done: the nightly `pg_dump` into the private backups repo covers every
// table, and since 2026-07-31 the storage bucket too (docs/backups.md). Restoring
// from those is strictly better *into Postgres*.
//
// This is the copy that survives leaving Postgres. `data.sql` is `COPY` blocks —
// to read it anywhere else you first write a parser, and you'd be writing it on
// the day you least want to. JSON is the format you can hand to anything.
//
// An ENDPOINT rather than an action, deliberately: it's a file you download, so
// it wants a real URL, a `Content-Disposition`, and no devalue round-trip
// through the actions client. Middleware already gates everything under
// `/admin` on `role === 'admin'`, so this inherits exactly the same boundary as
// every other admin page — it does not invent one.
import type { APIRoute } from 'astro';

/**
 * Dependency order: an importer can insert these top to bottom without ever
 * tripping a foreign key. Subjects/authors/constellations own nothing; works
 * point at authors; fragments point at authors and works; the join tables and
 * versions point at fragments. HQ's tables follow, in their own order.
 *
 * ⚠ STANDING RULE (ADR-0012): **any piece that creates an HQ table appends it
 * here, in the same commit, in foreign-key order.** A piece is not done until
 * its tables are in this array. Doing it per-piece is what keeps the export
 * permanently right rather than wrong until somebody remembers — and it is
 * mechanical, because the list is already ordered for exactly this reason.
 *
 * ⚠ AND THE RULE DID NOT HOLD, WHICH IS WHY IT IS NO LONGER ONLY A COMMENT.
 * Five tables were missing when the 2026-08-08 audit looked: the three check-in
 * children (2026-08-06) and both push tables (plan 21). Every export taken
 * between those commits and 2026-08-09 was quietly incomplete, and nothing said
 * so — a truncated backup looks exactly like a whole one, which is the same
 * failure `fetchAll`'s count check exists to prevent one table down.
 *
 * `src/tests/export-tables.test.ts` now derives the full table list from the
 * generated `Database` types and fails `verify` on any table that is neither
 * here nor in its `EXCLUDED` allowlist. The comment above is the intent; that
 * test is the enforcement, and the difference between them is five tables.
 *
 * Exported for exactly that test. It is not read anywhere else.
 */
export const TABLES = [
  'subjects',
  // The vocabulary of feelings (plan 33 §1) — beside `subjects` because it is
  // the same KIND of row and deliberately not the same table: a subject is what
  // a piece is about, a feeling is what a song does to you.
  //
  // ⚠ ITS JOIN IS THE ONE ROW IN THIS EXPORT THAT CANNOT BE RE-DERIVED. A
  // subject can be re-tagged from the text and a citation re-read off the page;
  // `fragment_feelings` is a record of what a song did to somebody on a
  // particular evening, and plan 33 ruling 1 rules out ever regenerating it —
  // *"AI can't tell me what I feel."* Losing it is the one loss here that is
  // permanent rather than expensive.
  'feelings',
  'authors',
  'works',
  'constellations',
  'pages',
  'fragments',
  'fragment_subjects',
  // After `feelings` above and `fragments` directly above, both of which it
  // carries a key into, so an importer walking this list top to bottom can never
  // trip it.
  'fragment_feelings',
  'fragment_constellations',
  'fragment_versions',
  // ⚠ PRIVATE, AND THE ONLY THING IN THE CORPUS'S HALF THAT IS (ADR 0031).
  // Michael's own notes on a song — where it came from, what week it belongs
  // to — admin-only in RLS and revoked from `anon` at the privilege layer, so
  // it is never rendered anywhere. It belongs in the export for exactly that
  // reason: this file and the nightly dump are its ONLY other copy, and an
  // unpublished thing that is lost is lost completely.
  'fragment_private_notes',
  // --- HQ (private; never public, at any grain) ---------------------------
  'settings',
  'daily_checkins',
  // The night in pieces (2026-08-06). All three carry `checkin_id` into
  // `daily_checkins` above and nothing else, so they follow it directly and an
  // importer walking top to bottom can never trip one.
  //
  // ⚠ THEY ARE NOT DERIVED AND MUST BE HERE. `daily_checkins` alone is a night
  // whose dreams, wakings and naps are gone — and unlike a view, none of this
  // is recomputable from the parent row. The efficiency figure the whole
  // instrument turns on is derived FROM the wakings (lib/hq/checkin.ts), so an
  // export without them restores to nights that quietly score differently.
  'checkin_dreams',
  'checkin_wakings',
  'checkin_naps',
  'people',
  // `interactions` owns nothing; `interaction_people` carries BOTH foreign keys,
  // so it must come after `people` and after `interactions` — an importer
  // walking this list top to bottom can never trip either one.
  'interactions',
  'interaction_people',
  // The agenda (13 · Pieces 1 and 2). FK order: `goals` first, because
  // `tasks.goal_id` points at it; then `task_events`, which points at `tasks`.
  // An importer walking this list top to bottom can never trip either one.
  // ⚠ NOT `goal_last_done` — a VIEW, and exporting a derived value would put a
  // stored copy of a computation into the artefact you restore from.
  'goals',
  'tasks',
  'task_events',
  // 13 · Piece 4. `event_people` carries a key into BOTH `events` above and
  // `people` far above, so it lands after each of them.
  'events',
  // 13 · Piece 3. The Google mirror. It owns no foreign key at all — the tags
  // that reference it do so by TEXT (`event_people.external_id` is a series id,
  // deliberately not an FK) — so its only ordering requirement is to precede
  // `event_people`, which reads better anyway.
  //
  // ⚠ IT IS EXPORTED EVEN THOUGH IT IS A COPY, and the reason is the tags: an
  // export holding the annotations without the rows they hang off would restore
  // to a set of person tags pointing at nothing until the next sync.
  'external_events',
  // The cursor and the mirror's health. One row.
  'calendar_sync',
  'event_people',
  // Push (plan 21 · Phases 1–2). Neither owns a foreign key — a subscription is
  // identified by the endpoint the push service minted, and a claim by a local
  // date — so their position is free and they sit here, after the rest of HQ
  // and before the seam below, purely so the list keeps reading in the order it
  // was built.
  //
  // ⚠ THE SUBSCRIPTIONS ARE DEVICE STATE AND RESTORE AS STALE ROWS. That is the
  // honest reading, and they are exported anyway: an endpoint is the only record
  // that a given phone was ever reachable, the prune retires a dead one on the
  // first 404/410, and the app re-asserts its own subscription on every open.
  // `push_day_claims` is the one that genuinely must survive — it is what makes
  // "was today's push already sent" answerable, and restoring without it means
  // the first tick after a restore sends a second time.
  'push_subscriptions',
  'push_day_claims',
  // The one seam with the corpus. Both carry a foreign key into the PUBLIC half
  // — `works` and `fragments`, already listed far above — as well as into
  // `people`, so they land last and an importer walking top to bottom is safe.
  'person_works',
  'person_fragments',
  // ⚠ NOT `person_last_contact`. It is a VIEW, derived from the two rows above,
  // and exporting it would put a stored copy of a computed value into the
  // artefact people restore from — the exact drift data-model.md §7 forbids.
  // The type union below would reject it anyway, which is the check working.
] as const;

/**
 * Typing the table name as this union rather than `string` is load-bearing:
 * the generated `Database` types then check the list above against the real
 * schema, so a renamed or dropped table is a compile error here instead of a
 * runtime "relation does not exist" inside a backup nobody was watching.
 */
type Table = (typeof TABLES)[number];

/** PostgREST caps a response at 1000 rows, silently. */
const PAGE = 1000;

/**
 * Every row of one table, `select('*')` so a column added later appears here
 * without anyone remembering to update this list.
 *
 * Paged, and then checked against the exact count. That check is the point: a
 * backup truncated at row 1000 looks exactly like a complete one, and would
 * stay wrong until the day it mattered.
 */
async function fetchAll(sb: App.Locals['supabase'], table: Table): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let total = 0;
  for (;;) {
    const { data, error, count } = await sb
      .from(table)
      .select('*', { count: 'exact' })
      .range(rows.length, rows.length + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    total = count ?? 0;
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data?.length || rows.length >= total) break;
  }
  if (rows.length !== total) throw new Error(`${table}: read ${rows.length} rows but the table holds ${total}`);
  return rows;
}

export const GET: APIRoute = async ({ locals, url }) => {
  const sb = locals.supabase;
  const tables: Record<Table, Record<string, unknown>[]> = {} as Record<Table, Record<string, unknown>[]>;

  try {
    // Sequential, not parallel: small queries, and a partial failure part way
    // through is easier to reason about than a page of racing ones. (It said
    // "nine" until 2026-08-09, when it was twenty-eight — the same drift the
    // test beside this list now catches, in a comment nobody was checking.)
    for (const table of TABLES) tables[table] = await fetchAll(sb, table);
  } catch (e) {
    // Never hand back a partial export dressed as a whole one.
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Export failed', partial: true }, null, 2),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const counts = Object.fromEntries(TABLES.map((t) => [t, tables[t].length]));
  const payload = {
    // `personal`, not `corpus`, since 2026-08-02: the file stopped being the
    // publishable half of the site the moment HQ tables joined it (ADR-0012).
    // The rename is the point — an importer that keys off `format` should fail
    // loudly on the change rather than quietly treat a private export as a
    // corpus one, and the version bump says the shape widened.
    format: 'it-only-happens-once/personal',
    version: 2,
    exportedAt: new Date().toISOString(),
    source: url.origin,
    // Images are referenced by URL, never embedded. They live in the `site`
    // bucket and are archived nightly into the backups repo; base64 here would
    // duplicate that at several times the size and make the file unreadable.
    notes: 'Image and media URLs point at Supabase Storage; the bytes are archived separately (docs/backups.md).',
    counts,
    tables,
  };

  const date = payload.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // `-personal-` in the filename, deliberately: this is the most sensitive
      // artefact the app can emit, and the name is the only part of it visible
      // in a downloads folder six months later.
      'content-disposition': `attachment; filename="it-only-happens-once-personal-${date}.json"`,
      // The corpus, drafts, private notes and every HQ table. Never store this.
      'cache-control': 'private, no-store',
    },
  });
};
