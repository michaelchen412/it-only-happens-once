-- ============================================================================
-- 0006 storage: stop public listing of the `site` bucket.
--
-- The original `site_public_read` policy granted SELECT on storage.objects to
-- everyone (role `public`) for the whole bucket, which lets any client LIST /
-- enumerate every object (Supabase advisor 0025_public_bucket_allows_listing).
-- Public object *access* does not need it: `site` is a public bucket, so objects
-- are served by the /object/public/ endpoint (getPublicUrl), bypassing RLS.
-- We drop the anon-listing policy and give the admin an is_admin()-scoped SELECT
-- (so a future media picker can still list), mirroring site_admin_insert/…/delete.
-- ============================================================================

drop policy if exists "site_public_read" on storage.objects;

create policy "site_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'site' and (select public.is_admin()));
