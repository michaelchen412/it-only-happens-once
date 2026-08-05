-- Whose words are these? (17 · provenance, and its specification 17a.)
--
-- A quote can be silent for two opposite reasons, and until now the database
-- could not tell them apart:
--
--   Michael wrote it       → silent, because on your own site your own words
--                            are the default voice. The essays don't sign
--                            themselves either; the site IS the attribution.
--   Nobody knows who did   → silent, because there is nothing to say.
--
-- Both render as no attribution line. A blank column cannot mean both in a
-- corpus that only grows — you could never filter for "what have I actually
-- written in a line?", and the workshop would show a gap where every other row
-- shows a citation, which reads as forgotten data every single time you scan
-- past it. So the distinction is STORED, and the renderers stay silent.
--
-- ⚠ NOT A `details` KEY, and not an `authors` row. Both are the tempting
-- shortcut and both are wrong:
--
--   `details` — plan 17 exists partly because that column became a drawer of
--   write-only fields (`source_author`, `work_year`: zero rows, three files,
--   no reader). Adding another while migrating the last ones out would be
--   perverse, and a column can be indexed and filtered.
--
--   An `authors` row named "Michael Chen" — it would make the Who field
--   uniform, and it would give the derivation a name to lead with, so every
--   self-authored quote would render "— Michael Chen" on a site that is
--   already his. Me sets this flag and leaves `author_id` NULL.
--
-- ⚠ NOTHING TO BACKFILL. Exactly one quote in the corpus has no attribution —
-- the golden-rule one — and it is NOT Michael's; it is Chris Williamson,
-- confirmed 2026-08-05. So this ships at zero rows and the first `true` will be
-- written through the form, which means the feature gets tested by use rather
-- than by assertion.
--
-- No index: 76 quotes. `where is_self` scans nothing worth an index, and a
-- partial index added before the first row exists is a guess about a query
-- nobody has written yet. Add one when the filter feels slow.
alter table public.fragments
  add column if not exists is_self boolean not null default false;

comment on column public.fragments.is_self is
  'Michael wrote these words himself. Silences the attribution line (the site is the attribution) while staying distinguishable from "source unknown", which is also silent. See docs/plans/17a-quote-matrix.md, "The two silences".';
