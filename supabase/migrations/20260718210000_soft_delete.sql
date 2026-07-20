-- ============================================================================
-- Soft delete — fragments go to Trash (deleted_at set) instead of a hard DELETE,
-- so they can be restored. Permanent removal ("purge") is a separate, explicit
-- action. See docs/admin.md (Fragment Manager) + docs/data-model.md.
--
-- Public/anon reads must exclude trashed rows. The admin keeps seeing everything
-- (including Trash) via the existing is_admin() select policy — that's what
-- powers the Trash view.
-- ============================================================================

alter table public.fragments add column if not exists deleted_at timestamptz;

-- Feed queries always want live rows; index the common shape excluding trash.
create index if not exists fragments_active_feed_idx
  on public.fragments (type, status, occurred_at desc)
  where deleted_at is null;

-- Public reads: published AND not trashed.
drop policy if exists "fragments_select_published" on public.fragments;
create policy "fragments_select_published" on public.fragments
  for select to anon, authenticated
  using (status = 'published' and deleted_at is null);

-- A placement/subject is publicly visible only if its fragment is published
-- AND not trashed.
drop policy if exists "fc_select_public" on public.fragment_constellations;
create policy "fc_select_public" on public.fragment_constellations
  for select to anon, authenticated
  using (exists (
    select 1 from public.fragments f
    where f.id = fragment_id and f.status = 'published' and f.deleted_at is null
  ));

drop policy if exists "fs_select_public" on public.fragment_subjects;
create policy "fs_select_public" on public.fragment_subjects
  for select to anon, authenticated
  using (exists (
    select 1 from public.fragments f
    where f.id = fragment_id and f.status = 'published' and f.deleted_at is null
  ));
