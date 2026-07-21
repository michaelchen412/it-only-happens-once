# 0008 — Provenance (authors & works) as query facets, decoupled from display

Status: Accepted
Date: 2026-07-20

## Context

Quotes (and songs) repeat their sources heavily — Marcus Aurelius ×20, Ocean Vuong ×6, Seth Godin ×9; only a handful of distinct works. Michael wants to **browse and query by source** ("everything from *Meditations*", "all quotes by Ocean Vuong") and to **manage** that vocabulary (rename, merge duplicates). Free-text `attribution` / `details.source_title` can't do this cleanly — typos fork entities, and there's no groupable identity.

This is a **provenance** axis (*where a fragment comes from*), orthogonal to **subjects** (*what it's about*). It only applies to quotes/songs; essays have no external author.

The stress test that fixed the design: **the Bible.** Michael wants every verse to be queryable as one group, but each must still *display* its own book+verse — "Matthew 5:43-48", never "The Bible". So the thing you **group by** and the thing you **show** must be allowed to differ.

## Decision

Add `authors` and `works` tables (a work belongs to an author) and reference them from fragments as **optional query facets** — `fragments.author_id` / `work_id`, both `on delete set null`. Migration `0003`; managed at [`/admin/library`](../admin.md).

Crucially, the facets are **additive and decoupled from display**:

- **Display stays where it was** — the visible attribution line is still `attribution` (+ `details.source_title`), rendered by a `author → citation → work` fallback. Nothing about rendering changed; no joins needed to show a row.
- **`author_id` / `work_id` are for grouping and search only.** "All Bible verses" = `where work_id = <the-bible>`; the verse still displays "Matthew 5:43-48" from `attribution`, and the work's title never appears. Scripture is detected by a chapter:verse pattern and grouped under one "The Bible" work with no author.
- **Both optional, with a free-text escape hatch.** Not everything fits author/work (scripture, anonymous, a composite aphorism). The display fallback + optional facets absorb all of these without forcing the schema.
- **Facets follow the shown fields.** In the editor, Author/Work are datalist fields that auto-mirror attribution/source-title (overridable for scripture); on save, `resolveAuthor`/`resolveWork` upsert by slug. Songs derive them from artist/album automatically.
- **`subjects.definition`** is added in the same migration; the **DB becomes the runtime source of truth** for the taxonomy the AI reads ([ADR 0007](0007-ai-subject-tagging.md)). `scripts/reflections-subjects.json` is now only the seed.

## Consequences

- **Real browse/query axis** with clean dedup and a management surface (`/admin/library`: edit, merge, delete — FK-safe, a fragment is never orphaned).
- **Zero display risk from the migration.** Because facets are additive, existing rendering was untouched; the backfill only *added* `author_id`/`work_id`. Editing a fragment without touching the facets preserves them.
- **The Bible rule generalizes.** Any collection can group members that each display their own locus — the display/query split is the reusable idea, not a scripture special-case.
- **Mild denormalization.** `attribution` and `author.name` can drift (they're display vs. canonical). Accepted: display is intentionally free, the facet is the identity. New scripture entry is slightly manual (type the verse; pick "The Bible") — rare enough to not optimize.

## Alternatives

- **Full normalization** (drop `attribution`; derive the display from joined author/work). Rejected — forces joins into every render, and can't express "group under The Bible but show the verse" without re-introducing a display field anyway.
- **Combobox over distinct free-text values, no tables.** Rejected — no canonical identity, so no clean merge/rename and typos keep forking.
- **One field doing double duty** (the work is both the facet and the shown string). Rejected — it's exactly what breaks the Bible case (would show "The Bible").
- **Provenance as subjects.** Rejected — "all Bible verses" is a *source* query, not a *theme*; conflating them pollutes the subject vocabulary.
