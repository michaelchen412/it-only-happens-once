-- ============================================================================
-- A jotting lives on a shelf
-- Bench: /lab/shelves · decided 2026-09-01 (inbox + shelves · a note may sit on
-- two · search escapes the inbox)
--
-- THE CLAIM THIS SERVES. The pile has four exits — the Agenda, a log entry, a
-- quote, a piece — and every one of them REMOVES the note. There was no way to
-- say *"I am keeping this and it is not going anywhere"*, so a note kept
-- deliberately looked exactly like one not yet dealt with. Shelving is the
-- fifth exit: unshelved is the inbox, shelved is kept on purpose.
--
-- ⚠ WHY THIS IS NOT `subjects`, WHICH ALREADY EXISTS AND WOULD HAVE COST
-- NOTHING. Two reasons, and the second is a disclosure risk rather than a
-- tidiness one.
--
--   1. DIFFERENT AXIS. A subject is what a piece is ABOUT; a shelf is what a
--      jotting is FOR. `philosophy` as a shelf means *this is reading I keep*;
--      `stoicism` as a subject means *this essay is about stoicism*. One list
--      holding both axes is how a vocabulary rots — you filter by purpose and
--      get topics back. This is the same argument
--      `feelings_are_not_subjects` (2026-08-11) makes about songs, and it is
--      made here for the same reason: two tables make the category error
--      impossible to spell.
--
--   2. THE PUBLIC TAXONOMY IS PUBLIC. `subjects` is 22 curated themes rendered
--      on `PostCard` and `PostArticle` for readers. And **make a piece** is a
--      tier move on the SAME ROW, so `fragment_subjects` links survive the
--      conversion — shelving a jotting under `job applications`, promoting it
--      and publishing it would have printed that phrase under the essay.
--
-- ⚠⚠ AND THAT LAST HAZARD DOES NOT GO AWAY BY MOVING TABLES — IT ONLY STOPS
-- BEING PUBLIC. `fragment_shelves` rows survive a status flip exactly the same
-- way, because it is the same row. A promoted essay would silently keep
-- `Applications` forever, invisible to every room that renders it. So
-- `fragments.tier` MUST DELETE A ROW'S SHELVES WHEN IT LEAVES `status = 'note'`
-- — that is application code, it is not enforced here, and this paragraph is
-- the reason a later reader will find it if it goes missing.
--
-- ⚠ THE MIRROR IS `feelings` / `fragment_feelings`, WITH ONE DELIBERATE
-- DIVERGENCE, so nobody later "aligns" them: **a shelf is entirely private.**
-- Feelings and subjects both carry an anon SELECT gated on the fragment being
-- published; a shelf has no public reading at all, because the things it
-- describes are by definition the ones that never publish. The privilege-layer
-- revoke at the bottom follows `private_notes_are_not_reachable_by_anon`
-- (2026-08-11) for the same reason it was written there: RLS already closes
-- this, and the revoke is what protects against a policy added later with
-- `to anon` — the shape the corpus's own tables legitimately use, one file away.
-- ============================================================================

create table public.shelves (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- FROZEN once created, like `feelings.slug`: this lands in the pile's URL
  -- (`?shelf=applications`), and plan 32 §1 found that moving a slug hard-404s
  -- every old link. A rename changes the name and leaves this alone.
  slug       text not null unique,
  -- Authored order, not alphabetical. The row of segments above the pile reads
  -- in this order, and which drawer comes first is a claim about which one you
  -- reach for — claims belong in data, not in a hardcoded array.
  sort       integer not null,
  created_at timestamptz not null default now()
);

-- The pile prints the word itself, so `Philosophy` and `philosophy` existing at
-- once would show the same shelf twice in the filter row. `feelings` carries
-- this index for exactly that reason; `subjects` does not need it.
create unique index shelves_name_ci on public.shelves (lower(name));

create table public.fragment_shelves (
  fragment_id uuid not null references public.fragments(id) on delete cascade,
  shelf_id    uuid not null references public.shelves(id)   on delete cascade,
  primary key (fragment_id, shelf_id)
);

-- The room's question is "which notes are on this shelf", which reads the join
-- backwards — the same index `fragment_feelings` and `fragment_subjects` carry.
create index fragment_shelves_shelf_idx on public.fragment_shelves (shelf_id);

alter table public.shelves          enable row level security;
alter table public.fragment_shelves enable row level security;

-- --- shelves: admin only, all four -------------------------------------------
-- ⚠ NO `select … to anon`, UNLIKE `subjects` AND `feelings`. Deliberate; see the
-- header. A reader has no business knowing the names of Michael's drawers.
create policy shelves_select_admin on public.shelves
  for select to authenticated using ((select public.is_admin()));

create policy shelves_insert_admin on public.shelves
  for insert to authenticated with check ((select public.is_admin()));

create policy shelves_update_admin on public.shelves
  for update to authenticated using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy shelves_delete_admin on public.shelves
  for delete to authenticated using ((select public.is_admin()));

-- --- fragment_shelves: admin only, all four ----------------------------------
create policy fsh_select_admin on public.fragment_shelves
  for select to authenticated using ((select public.is_admin()));

create policy fsh_insert_admin on public.fragment_shelves
  for insert to authenticated with check ((select public.is_admin()));

create policy fsh_update_admin on public.fragment_shelves
  for update to authenticated using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy fsh_delete_admin on public.fragment_shelves
  for delete to authenticated using ((select public.is_admin()));

-- The privilege layer, which does not depend on getting a policy right. See the
-- header, and the file this copies.
revoke all on public.shelves          from anon;
revoke all on public.fragment_shelves from anon;

-- --- the vocabulary Michael named, and nothing else ---------------------------
-- ⚠ THREE, FROM HIS OWN WORDS (2026-09-01: *"job application writing, random
-- notes to myself, philosophy related notes"*) — not a starter set somebody
-- guessed at. The room can add more; the point of seeding exactly these is that
-- an empty vocabulary makes the filter row a control with no options on the day
-- it ships, and a guessed fourth would be a drawer nobody asked for.
insert into public.shelves (name, slug, sort) values
  ('Applications',  'applications', 1),
  ('Notes to self', 'self',         2),
  ('Philosophy',    'philosophy',   3);
