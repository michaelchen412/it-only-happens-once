-- ============================================================================
-- A private note is not a column
-- Plan: docs/plans/37 · §1 · Ruling 3 · ADR 0031
--
-- ADR 0009 gave a song a VOICE — `body`, the annotation, "why this one" — so
-- that music would qualify as a fragment alongside writing and quotes. In
-- seventeen days one song in forty-eight used it, and the sentence it used it
-- for was an observation about a sideman's playing: a NOTE, not a why. Michael,
-- 2026-08-11: *"I don't think I would ever talk about why this one… I want to
-- let the music do its own speaking."*
--
-- So the annotation becomes notes, and there are two of them, divided by
-- AUDIENCE rather than by length:
--
--   · the PUBLIC note stays in `fragments.body`, which already means "the words
--     of this fragment" and still does. It renders in the music room behind a
--     popover and nowhere else. No migration is owed for it — the one existing
--     annotation becomes the public note by doing nothing, because it was
--     always a note.
--   · the PRIVATE note is this table: where a song came from, what week it
--     belongs to, what to listen for at 2:41. It has never had a home.
--
-- ⚠ WHY THIS IS A TABLE AND NOT A COLUMN ON `fragments`, WHICH IS THE OBVIOUS
-- SAVING AND IS WRONG. `fragments` is read with `select *` by the public site,
-- by `/admin/export.json` and by the nightly backup. A "private" column on that
-- row is public the moment anything selects it, and every one of those readers
-- already does. Postgres can express the exception — `grant select (col, …)`
-- withholds one column — and doing that would turn every existing `select *` on
-- the corpus's busiest table into a query that ERRORS for `anon`, and make every
-- future one a trap for whoever writes it.
--
-- THE RULE THIS ENCODES: a field whose secrecy depends on nobody selecting it is
-- not private. It belongs in a table whose policy says so.
--
-- ⚠ AND THE POSTURE HERE IS HQ'S, NOT THE CORPUS'S — do not "align" it with
-- `fragment_feelings` next door. That table carries FIVE policies because its
-- rows are public data gated on publication. This one carries ONE, `for all to
-- authenticated` with `is_admin()`, exactly as `goals` and `tasks` do, and
-- there is deliberately NO `anon` POLICY. ADR 0012's line — HQ's tables have no
-- `anon` policy — is the one being followed, because this is the first thing in
-- the CORPUS's half of the schema that a reader may never see.
--
-- ⚠ AND THE POLICY IS THE WHOLE BOUNDARY, BECAUSE THE GRANT BELOW IS A NO-OP.
-- This was written believing `grant … to authenticated` withheld anything from
-- `anon`; checking the live catalog immediately after applying showed `anon`
-- holding SELECT/INSERT/UPDATE/DELETE here anyway. Supabase bootstraps
-- `alter default privileges in schema public grant all on tables to anon,
-- authenticated`, so EVERY new table in this schema starts wide open at the
-- privilege layer and RLS is what actually closes it — verified identical on
-- `goals`, `tasks`, `daily_checkins` and `interactions`, which is to say on
-- every private table this database already has.
--
-- So: RLS enabled + zero policies matching `anon` = zero rows, and that is the
-- real lock. The grant is corrected in the very next migration
-- (`private_notes_are_not_reachable_by_anon`), which is belt to this brace.
-- Left standing here rather than rewritten, because history is not edited.
--
-- SONGS-ONLY IS ENFORCED IN THE ACTION, NOT HERE, and the precedent is
-- `fragment_feelings`: generically named, songs-only in practice, and the type
-- check lives in `songs.setFeelings` where a refusal can be a sentence. A
-- composite FK on (id, type) would need a generated column and buys nothing —
-- see ADR 0011 on why `paired_song_id` made the same call. Generalising this to
-- quotes or writing later therefore costs nothing but a widened action.
-- ============================================================================

create table public.fragment_private_notes (
  -- One note per fragment, so the fragment's own id IS the key. A surrogate id
  -- would allow two notes on one song and then need a unique index to forbid
  -- what the shape should never have permitted.
  fragment_id uuid primary key references public.fragments(id) on delete cascade,
  -- `not null default ''` rather than nullable: there is no difference here
  -- between "no note" and "an empty note", and a nullable text column invents
  -- one for every reader to handle.
  notes       text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.fragment_private_notes is
  'Michael''s own notes on a fragment (songs, in practice). ADMIN-ONLY — no anon policy, no anon grant. Never rendered on a public page. See ADR 0031.';

-- The audit stamp every table here maintains rather than hand-edits.
create trigger fragment_private_notes_set_updated_at
  before update on public.fragment_private_notes
  for each row execute function extensions.moddatetime(updated_at);

alter table public.fragment_private_notes enable row level security;

create policy fragment_private_notes_all_admin on public.fragment_private_notes
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Explicit rather than relying on Supabase's default privileges — which, as the
-- header records, already granted this to `anon` too. See the next migration.
grant select, insert, update, delete on public.fragment_private_notes to authenticated;
