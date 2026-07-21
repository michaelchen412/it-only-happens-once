-- ============================================================================
-- 0003 vocabulary entities — subject definitions, authors, works
-- Domain: docs/data-model.md · Admin: docs/admin.md §8
--
-- Adds the cross-cutting reference entities the admin curates:
--   • subjects.definition — the taxonomy's meaning, previously file-only. Now the
--     DB is the single source of truth the AI classifier reads.
--   • authors / works — the PROVENANCE axis (who said it / where it's from),
--     distinct from subjects (what it's ABOUT). Both optional; essays have neither.
--
-- Display vs. query (the Bible rule): the visible attribution stays in
-- fragments.attribution / details.source_title. author_id / work_id are QUERY
-- FACETS only. So a verse can display "Matthew 5:43-48" while grouping under the
-- work "The Bible" — the collection name never leaks into what's shown.
-- ============================================================================

-- 1. Subject definitions -----------------------------------------------------
alter table public.subjects add column if not exists definition text;

-- 2. Authors -----------------------------------------------------------------
create table if not exists public.authors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  sort_name  text,        -- "Aurelius, Marcus" for ordering (optional)
  note       text,        -- freeform: dates, a one-liner (optional)
  created_at timestamptz not null default now()
);

-- 3. Works (belong to an author; optional) -----------------------------------
create table if not exists public.works (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  slug       text not null unique,
  author_id  uuid references public.authors(id) on delete set null,
  year       int,
  kind       text,        -- 'book' | 'collection' | 'album' | 'essay' | … (optional)
  created_at timestamptz not null default now()
);

-- 4. Fragment → author/work facets (query axis; display stays denormalized) ---
alter table public.fragments add column if not exists author_id uuid references public.authors(id) on delete set null;
alter table public.fragments add column if not exists work_id   uuid references public.works(id)   on delete set null;
create index if not exists fragments_author_idx on public.fragments (author_id);
create index if not exists fragments_work_idx   on public.fragments (work_id);
create index if not exists works_author_idx     on public.works (author_id);

-- 5. Grants (mirror subjects: anon read; authenticated CRUD gated by RLS) -----
revoke all on public.authors from anon, authenticated;
revoke all on public.works   from anon, authenticated;
grant select on public.authors to anon;
grant select on public.works   to anon;
grant select, insert, update, delete on public.authors to authenticated;
grant select, insert, update, delete on public.works   to authenticated;

-- 6. RLS: public reads all labels; admin writes ------------------------------
alter table public.authors enable row level security;
alter table public.works   enable row level security;

create policy "authors_select_all" on public.authors
  for select to anon, authenticated using (true);
create policy "authors_insert_admin" on public.authors
  for insert to authenticated with check ((select public.is_admin()));
create policy "authors_update_admin" on public.authors
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "authors_delete_admin" on public.authors
  for delete to authenticated using ((select public.is_admin()));

create policy "works_select_all" on public.works
  for select to anon, authenticated using (true);
create policy "works_insert_admin" on public.works
  for insert to authenticated with check ((select public.is_admin()));
create policy "works_update_admin" on public.works
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "works_delete_admin" on public.works
  for delete to authenticated using ((select public.is_admin()));
