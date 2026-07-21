-- ============================================================================
-- 0005 pages + site storage — the editable singleton pages (About, …) and a
-- public bucket for the images they reference (e.g. the About portrait).
--
-- A `page` is NOT a fragment: it never appears in a feed, has no
-- provenance/constellation/subject semantics, and there is exactly one of each.
-- It is a slug-keyed singleton whose `content` JSONB holds a per-page structured
-- shape (validated in the app by the `pages.save` action's Zod schema).
--
-- Security posture mirrors fragments' public metadata: anyone READS a page
-- (there's one, it's meant to be public); only the admin WRITES. See docs/auth.md.
-- ============================================================================

-- Pages ----------------------------------------------------------------------
create table public.pages (
  slug       text primary key,                       -- 'about', later 'now', 'colophon', …
  content    jsonb not null default '{}'::jsonb,      -- per-page structured shape
  updated_at timestamptz not null default now()
);

create trigger pages_set_updated_at
  before update on public.pages
  for each row execute function extensions.moddatetime(updated_at);

revoke all on public.pages from anon, authenticated;
grant select on public.pages to anon;
grant select, insert, update, delete on public.pages to authenticated;

alter table public.pages enable row level security;

create policy "pages_select_all" on public.pages
  for select to anon, authenticated using (true);
create policy "pages_insert_admin" on public.pages
  for insert to authenticated with check ((select public.is_admin()));
create policy "pages_update_admin" on public.pages
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "pages_delete_admin" on public.pages
  for delete to authenticated using ((select public.is_admin()));

-- Seed the About row so the builder always edits an existing singleton.
insert into public.pages (slug, content) values ('about', '{}'::jsonb)
  on conflict (slug) do nothing;

-- Site storage bucket --------------------------------------------------------
-- One public bucket for reader-facing images the admin uploads (the About
-- portrait for now). Public read is served by the /object/public/ endpoint;
-- writes are admin-only via RLS on storage.objects.
insert into storage.buckets (id, name, public)
  values ('site', 'site', true)
  on conflict (id) do nothing;

create policy "site_public_read" on storage.objects
  for select using (bucket_id = 'site');
create policy "site_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site' and (select public.is_admin()));
create policy "site_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'site' and (select public.is_admin()))
  with check (bucket_id = 'site' and (select public.is_admin()));
create policy "site_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site' and (select public.is_admin()));
