-- ============================================================================
-- storage: the `hq` bucket — HQ's private half, for bytes (12-people.md §7,
-- 10-hq.md §7c, ADR-0012).
--
-- WHY A SECOND BUCKET AT ALL. `site` is `public = true`
-- (20260721120000_pages_and_site_storage.sql:49). Listing was closed off later,
-- but every object in it stays readable by anyone holding the URL — the paths
-- are unguessable and that is the entire protection. That trade is correct for
-- an essay's photographs, which are published anyway. It is not correct for a
-- friend's face. A person photo at a permanently public URL is not acceptable
-- at any level of path entropy, so these bytes need a bucket that says no.
--
-- PRIVATE MEANS SIGNED URLS, AND SIGNED URLS HAVE A COST WORTH KNOWING UP
-- FRONT: they expire. Sign at request time with a generous TTL and never bake
-- one into anything cached, or a page served from cache renders broken images
-- some minutes after it was built. src/pages/admin/people.astro signs per
-- render for exactly this reason.
--
-- NO GIF, on top of the `site` bucket's no-SVG rule. An animated avatar is not
-- a thing anyone wants, and GIF is also the one format upload.ts passes through
-- WITHOUT downscaling (a canvas keeps a single frame), so excluding it here
-- means every object in this bucket has been through the resize path.
--
-- ⚠ THIS BUCKET IS NOT COVERED BY THE NIGHTLY ARCHIVE, and copying the existing
-- step would not fix it. That workflow (docs/backups.md, in the private backups
-- repo) fetches each object's bytes from its PUBLIC URL — "the same one a
-- reader uses". A private bucket has no such URL, so the copied step would
-- archive nothing and the failure would look exactly like an empty bucket. It
-- needs a service-role download or a signed URL minted per object, plus a
-- non-zero manifest check. Tracked on the board; it lives in a repo this one
-- cannot reach.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'hq',
    'hq',
    false,
    10485760, -- 10 MB, matching MAX_UPLOAD_BYTES in src/scripts/upload.ts
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
  )
  on conflict (id) do nothing;

-- NO PUBLIC READ POLICY, and that omission is the entire point of the bucket.
-- `site` has `site_public_read`; this one deliberately has no counterpart, so
-- an unauthenticated request reads nothing even with a correct path. Four
-- policies rather than one `for all`, mirroring the `site` set so the two
-- buckets read the same way in `pg_policies` — the place anyone will actually
-- audit them.
create policy "hq_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'hq' and (select public.is_admin()));
create policy "hq_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'hq' and (select public.is_admin()));
create policy "hq_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'hq' and (select public.is_admin()))
  with check (bucket_id = 'hq' and (select public.is_admin()));
create policy "hq_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'hq' and (select public.is_admin()));
