-- Applied 2026-11-14 00:23 UTC, rehearsed first in a rolled-back block, and
-- verified straight after:
--
--     still carrying the backfill stamp      0
--     set to published_at                   48
--     real edits restored from the backup    2
--     fragments_set_updated_at enabled      yes
--
-- ══════════════════════════════════════════════════════════════════════════
-- The music backfill was not an edit either — and it was stamped as one.
--
-- `an_essay_carries_its_music_as_a_link` copied 50 links with an UPDATE at
-- 2026-11-13 21:46:28 UTC, BEFORE `music_is_not_an_edit` existed — so the old
-- trigger stamped all 50 essays (every one published) as edited at that moment.
-- Michael found it from the outside: essays that had not changed in years read
-- "Last updated … November 13, 2026".
--
-- The originals come from the nightly backup taken twelve minutes earlier
-- (it-only-happens-once-backups @ ffe9643, 2026-11-13 21:34:41 UTC) — not
-- retyped. Each row is restored ONLY if it still carries the backfill's exact
-- stamp, so an essay edited since then keeps its real, newer time.
--
-- ⚠ 48 OF THE 50 ORIGINALS WERE A MIGRATION STAMP TOO, and those go to
-- `published_at` instead (Michael's call, 2026-11-13). They read
-- 2026-08-15 16:27:35.078122 — the moment `details_media_was_the_last_
-- squarespace_shape` rewrote `details` on every imported essay — not an edit
-- anyone made. Restored as-is, a 2023 essay would say "Last updated Saturday,
-- August 15, 2026" now that the line shows for any later-day update. Setting
-- `updated_at` to `published_at` says what is true: never edited after it went
-- live. The other 2 carry real edits (2026-08-19, 2026-09-19) and get them
-- back exactly.
--
-- ⚠ THE TRIGGER IS OFF FOR THE ONE STATEMENT. An update that sets only
-- `updated_at` is not a music-only update, so `fragments_set_updated_at` would
-- overwrite every restored value with now() — the restore would re-break the
-- thing it fixes. `apply_migration` is one transaction, so the trigger cannot
-- be left disabled: either all three statements land or none do.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.fragments disable trigger fragments_set_updated_at;

update public.fragments f
set updated_at = case
  when o.updated_at = '2026-08-15 16:27:35.078122+00' then coalesce(f.published_at, o.updated_at)
  else o.updated_at
end
from (values
  ('eee12c4e-c245-4ead-a604-299c83e1593a'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('6767f691-a3e0-4b6d-be3d-ac0df1cd7865'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('0fe636ae-6187-47cf-bfeb-992f722fccc0'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('89785b76-4af8-4aef-88fc-1c8e49532e4a'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('a140fb06-9eb4-4242-9120-5bcbfc0e891e'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('e0c0fb13-758f-4728-ab8b-12da8a3de6a6'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('ea5f48aa-3610-4770-8377-593addb6099c'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('d54acf61-d069-4cdc-86b1-ed0397748706'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('c08e034b-be8d-4043-b6cb-3901b5285a43'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('509296cd-5130-498b-b61a-261ad79cb53e'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('0cfdbaf0-62c4-4015-be7f-1f8df04bba13'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('5768802b-f541-4977-9b72-d8146372bd12'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('8949a880-7dc6-46b9-8b09-5d7e3a1e513d'::uuid, '2026-08-19 14:23:04.388373+00'::timestamptz),
  ('272c5a5a-93e7-43fb-982e-8e509969076a'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('e97e4139-f503-468b-a313-c2f16a7de479'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('47ad0114-db2a-4b99-9746-51a4f4240073'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('0f7e9900-ebd1-4e83-bc21-38d1ae018642'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('52a7e30a-20d5-4581-b6de-8069f104cacc'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('2a574a2e-9627-4919-9fb1-3c626901a791'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('888997e7-d78c-48b8-8861-20c668c6028b'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('8c97ed55-8593-4a77-80f3-a80f7650af4d'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('e84f3165-82cc-407e-955f-fbf3dcf256bd'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('abba2cdc-873c-46d5-9d7b-08daad279cba'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('8bb99184-a634-420a-a045-92c95d6e1b82'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('33419571-5ecc-46c2-8460-cc90655c4da7'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('a16928d4-5a7a-41e2-84ae-f4076e2dd8d8'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('34e9dcc5-ed2a-4b6a-83ca-73083adddec6'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('839ece8c-4cc1-40fa-ab97-af82f227f4b7'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('8537f26e-fb07-430d-82b4-a8410fa77318'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('fa76ac6f-5b2d-4808-a28d-9c16afb24711'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('14c6c185-8140-4bab-a548-fc3c3386649c'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('9f0011b2-3723-4077-ace3-36c16a5905a8'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('1ae7564a-3726-430b-ab82-b010a8354a52'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('1466d61a-8988-4b5d-b182-ed173771f0f3'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('46ae5d03-85c2-4ad1-83cc-6e06b03ea6ee'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('ebad33e6-9949-44de-a894-1485c0a4a869'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('80c3dcc0-b44b-441d-9d36-75205adc6947'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('3f741cd7-1145-4c52-af73-2924e8415b5c'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('02c7d09f-f489-43cd-868f-68b357f9a161'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('4d2af27a-4a43-44b5-8d16-8400903bd485'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('591659e1-cf8f-47a4-a103-f1e3065be35e'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('9d74ea96-3c92-41a6-94f5-5d3f59e8f521'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('c1734a39-d20f-493d-b565-cf721d1ee4c6'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('2e2d082a-214c-4d6c-a4e3-c98ff868172f'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('74659499-ecb7-47c0-9012-dc81013f4b7a'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('9c0c1f1c-ffe9-4490-8458-5de251f7d1f0'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('c878e4f7-d8a9-49ca-992b-46c92f7a9501'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('1cdfd81f-7e1b-4b63-bc0f-7a81817b1e51'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz),
  ('3f0dd41f-21d4-4af7-88fa-2dd730984977'::uuid, '2026-09-19 02:27:56.325161+00'::timestamptz),
  ('dd35b3ba-14c2-4d46-a88b-bb5b88ad9e62'::uuid, '2026-08-15 16:27:35.078122+00'::timestamptz)
) as o(id, updated_at)
where f.id = o.id
  and f.updated_at = '2026-11-13 21:46:28.133359+00';

alter table public.fragments enable trigger fragments_set_updated_at;
