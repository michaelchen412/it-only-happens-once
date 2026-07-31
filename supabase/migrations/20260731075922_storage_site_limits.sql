-- ============================================================================
-- storage: constrain what the `site` bucket will accept.
--
-- Until now the bucket had file_size_limit = null and allowed_mime_types = null,
-- so an admin session could put an object of ANY type and ANY size into a
-- public bucket. That was tolerable while the only uploader was a single
-- portrait field; plan 03 adds image uploads from the essay composer (a file
-- picker, paste, and drag-and-drop), which turns this bucket into a routine
-- destination rather than a one-off.
--
-- src/scripts/upload.ts validates and downscales before uploading, but the
-- client is not the boundary. This is.
--
-- NO SVG, deliberately. An SVG can carry script, and objects here get public
-- URLs on our own origin — a browser won't run it inside an <img>, but opening
-- the URL directly would execute it as us. Nothing an essay needs is worth that.
--
-- Worth knowing about this bucket, unchanged by this migration: it is PUBLIC,
-- so anything uploaded is readable by URL even when the essay embedding it is
-- still a draft or a note. The paths are unguessable (fragment uuid + content
-- hash) and that is the whole protection. The alternative — a private bucket
-- with signed URLs — would put an expiry on every image in every published
-- essay, so this is the right trade, but it should be a known one.
-- ============================================================================

update storage.buckets
set
  file_size_limit = 10485760, -- 10 MB, matching MAX_UPLOAD_BYTES in upload.ts
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
where
  id = 'site';
