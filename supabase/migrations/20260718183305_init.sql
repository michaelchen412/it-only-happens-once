-- ============================================================================
-- 0001 init — fragments schema + Row Level Security
-- Domain model: docs/data-model.md   ·   Security model: docs/auth.md
--
-- Everything shareable is a `fragment` (writing | quote | song). Constellations
-- are lenses; subjects are tags. Placement = a fragment_constellations row.
--
-- Security posture (single-admin site):
--   • Public (anon) may READ only published fragments and public lens/subject
--     metadata. Nothing else.
--   • The admin (a Clerk user carrying the custom claim user_role='admin') may
--     do everything. The reserved `role` claim stays 'authenticated' so Supabase
--     maps the Postgres role correctly; admin-ness lives in `user_role`.
--   • Until Clerk third-party auth is wired up, no request is ever
--     `authenticated`, so all writes are closed by construction.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists moddatetime schema extensions;  -- auto updated_at

-- Enums ---------------------------------------------------------------------
create type public.fragment_type   as enum ('writing', 'quote', 'song');
create type public.fragment_status as enum ('draft', 'published');
create type public.date_precision  as enum ('day', 'year');

-- Admin predicate -----------------------------------------------------------
-- Centralizes "is this request the admin?" so every policy stays consistent.
-- Reads the custom `user_role` claim from the (Clerk) JWT. search_path is
-- pinned empty for safety; auth.jwt() is schema-qualified.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'user_role') = 'admin', false)
$$;

-- Tables --------------------------------------------------------------------
create table public.fragments (
  id             uuid primary key default gen_random_uuid(),
  type           public.fragment_type   not null,
  slug           text not null unique,
  title          text,
  body           text,
  excerpt        text,
  attribution    text,
  source_url     text,
  details        jsonb not null default '{}'::jsonb,
  status         public.fragment_status not null default 'draft',
  occurred_at    timestamptz not null default now(),
  date_precision public.date_precision  not null default 'day',
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.constellations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  description text,
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

create table public.fragment_constellations (
  fragment_id      uuid not null references public.fragments(id)      on delete cascade,
  constellation_id uuid not null references public.constellations(id) on delete cascade,
  position         int  not null default 0,
  created_at       timestamptz not null default now(),
  primary key (fragment_id, constellation_id)
);

create table public.subjects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

create table public.fragment_subjects (
  fragment_id uuid not null references public.fragments(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id)  on delete cascade,
  primary key (fragment_id, subject_id)
);

-- Indexes -------------------------------------------------------------------
-- Feed queries ("all songs, newest first") and the RLS status filter.
create index fragments_feed_idx      on public.fragments (type, status, occurred_at desc);
create index fragments_published_idx on public.fragments (status, published_at desc);
-- Composed-suite ordering within a constellation.
create index fragment_constellations_order_idx
  on public.fragment_constellations (constellation_id, position);
-- Reverse lookups for the join tables (forward side is covered by the PK).
create index fragment_constellations_fragment_idx on public.fragment_constellations (fragment_id);
create index fragment_subjects_subject_idx        on public.fragment_subjects (subject_id);

-- updated_at trigger --------------------------------------------------------
create trigger fragments_set_updated_at
  before update on public.fragments
  for each row execute function extensions.moddatetime(updated_at);

-- Grants (least privilege) --------------------------------------------------
-- anon: read only. authenticated: full CRUD, but every write is gated by the
-- is_admin() policies below. RLS is the real gate; grants are defense in depth.
revoke all on public.fragments               from anon, authenticated;
revoke all on public.constellations          from anon, authenticated;
revoke all on public.fragment_constellations from anon, authenticated;
revoke all on public.subjects                from anon, authenticated;
revoke all on public.fragment_subjects       from anon, authenticated;

grant select on public.fragments               to anon;
grant select on public.constellations          to anon;
grant select on public.fragment_constellations to anon;
grant select on public.subjects                to anon;
grant select on public.fragment_subjects       to anon;

grant select, insert, update, delete on public.fragments               to authenticated;
grant select, insert, update, delete on public.constellations          to authenticated;
grant select, insert, update, delete on public.fragment_constellations to authenticated;
grant select, insert, update, delete on public.subjects                to authenticated;
grant select, insert, update, delete on public.fragment_subjects       to authenticated;

-- Row Level Security --------------------------------------------------------
alter table public.fragments               enable row level security;
alter table public.constellations          enable row level security;
alter table public.fragment_constellations enable row level security;
alter table public.subjects                enable row level security;
alter table public.fragment_subjects       enable row level security;

-- fragments: public reads published; admin reads/writes everything -----------
create policy "fragments_select_published" on public.fragments
  for select to anon, authenticated
  using (status = 'published');

create policy "fragments_select_admin" on public.fragments
  for select to authenticated
  using ((select public.is_admin()));

create policy "fragments_insert_admin" on public.fragments
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "fragments_update_admin" on public.fragments
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "fragments_delete_admin" on public.fragments
  for delete to authenticated
  using ((select public.is_admin()));

-- constellations: public reads all labels; admin writes ----------------------
create policy "constellations_select_all" on public.constellations
  for select to anon, authenticated using (true);
create policy "constellations_insert_admin" on public.constellations
  for insert to authenticated with check ((select public.is_admin()));
create policy "constellations_update_admin" on public.constellations
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "constellations_delete_admin" on public.constellations
  for delete to authenticated using ((select public.is_admin()));

-- subjects: public reads all labels; admin writes ----------------------------
create policy "subjects_select_all" on public.subjects
  for select to anon, authenticated using (true);
create policy "subjects_insert_admin" on public.subjects
  for insert to authenticated with check ((select public.is_admin()));
create policy "subjects_update_admin" on public.subjects
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "subjects_delete_admin" on public.subjects
  for delete to authenticated using ((select public.is_admin()));

-- fragment_constellations: public reads a placement only if its fragment is
-- published; admin reads/writes everything -----------------------------------
create policy "fc_select_public" on public.fragment_constellations
  for select to anon, authenticated
  using (exists (
    select 1 from public.fragments f
    where f.id = fragment_id and f.status = 'published'
  ));
create policy "fc_select_admin" on public.fragment_constellations
  for select to authenticated using ((select public.is_admin()));
create policy "fc_insert_admin" on public.fragment_constellations
  for insert to authenticated with check ((select public.is_admin()));
create policy "fc_update_admin" on public.fragment_constellations
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "fc_delete_admin" on public.fragment_constellations
  for delete to authenticated using ((select public.is_admin()));

-- fragment_subjects: same published-scoped public read; admin writes ---------
create policy "fs_select_public" on public.fragment_subjects
  for select to anon, authenticated
  using (exists (
    select 1 from public.fragments f
    where f.id = fragment_id and f.status = 'published'
  ));
create policy "fs_select_admin" on public.fragment_subjects
  for select to authenticated using ((select public.is_admin()));
create policy "fs_insert_admin" on public.fragment_subjects
  for insert to authenticated with check ((select public.is_admin()));
create policy "fs_update_admin" on public.fragment_subjects
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "fs_delete_admin" on public.fragment_subjects
  for delete to authenticated using ((select public.is_admin()));
