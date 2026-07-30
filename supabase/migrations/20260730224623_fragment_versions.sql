-- Draft versions and the promote model (docs/plans/07).
--
-- Editing a published piece never mutates the canonical row: it writes here.
-- Two jobs in one table:
--
--  1. Crash safety. Published pieces save on explicit intent only, so a browser
--     crash mid-edit used to lose the work outright (the offline outbox had
--     been quietly covering this until ADR-0010 removed it). The 'working'
--     version is a server-side snapshot by construction.
--  2. History. Promotion preserves the outgoing canonical as a 'snapshot', so
--     rewriting a piece can never destroy the opening you decide you preferred.
--
-- A separate table rather than fragments.parent_id, deliberately:
--  · fragments.slug is NOT NULL UNIQUE and uniqueSlug() probes across the whole
--    table with a hard cap of 60 suffixes — every version would burn a slug.
--  · a version has no slug, no subjects, no constellation membership, and never
--    appears in a list; under parent_id, every existing query would need a new
--    filter and forgetting one would leak versions into the UI.
--  · and this table gets NO anon policy at all, which is a stronger privacy
--    posture than "hidden because its status isn't published" — especially
--    during a promote, when statuses are being moved around.
create table public.fragment_versions (
  id uuid primary key default gen_random_uuid(),
  fragment_id uuid not null references public.fragments(id) on delete cascade,

  -- Only the fields a version can differ in. Slug, dates, status, subjects and
  -- placements belong to the fragment: promoting rewrites the words, never the
  -- piece's identity or its URL.
  title text,
  excerpt text,
  body text,

  -- 'working'  — the single autosaving scratch copy (the crash-safety target).
  -- 'snapshot' — a preserved past state: the outgoing canonical on promote,
  --              or one kept by hand.
  kind text not null default 'working' check (kind in ('working', 'snapshot')),
  label text, -- optional "why this variant"

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one working version per fragment — autosave overwrites rather than
-- accumulating ten thousand one-character rows.
create unique index fragment_versions_one_working
  on public.fragment_versions (fragment_id) where kind = 'working';

create index fragment_versions_by_fragment
  on public.fragment_versions (fragment_id, created_at desc);

create trigger fragment_versions_set_updated_at
  before update on public.fragment_versions
  for each row execute function extensions.moddatetime(updated_at);

alter table public.fragment_versions enable row level security;

-- The admin, and nobody else. There is deliberately no `to anon` policy of any
-- kind: an unfinished rewrite of a published essay must be unreadable even if
-- some future join forgets to filter.
create policy fv_all_admin on public.fragment_versions
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.fragment_versions to authenticated;
