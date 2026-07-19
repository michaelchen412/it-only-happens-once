# 0003 — Single `fragments` table

Status: Accepted
Date: 2026-07-18

## Context

The domain (see `vision.md`) has three kinds of shareable atom — **writing, quote, song** — that share most attributes (slug, dates, status, constellation membership, subject tags) and differ in a few type-specific fields. The blog surface needs to query "all fragments of a type, newest first," and the Sky needs a single fragment to belong to many constellations regardless of type. The type set is small and stable.

## Decision

Model all three as rows in **one `fragments` table** with a `type` enum, shared columns for the common attributes, and a `jsonb details` column for the handful of type-specific fields. See [`data-model.md`](../data-model.md).

## Consequences

- "All fragments chronologically," "all songs," "everything in this constellation" are trivial single-table queries — exactly the blog/Sky access patterns.
- Constellation and subject joins are uniform (one FK target), instead of polymorphic across three tables.
- RLS is written once per operation instead of three times.
- Some columns are null for some types (e.g. `attribution` on writing); accepted as a small, legible cost.
- Type-specific fields in `details` are less self-documenting and not efficiently queryable — accepted because they're rarely filtered on. Any field that becomes a filter/sort target graduates to a real column.

## Alternatives

- **Table per type** (`posts`, `quotes`, `songs`). Cleaner per-type columns, but every cross-type feature (the chronological stream, constellation membership, the Sky) needs `UNION`s or polymorphic joins, and RLS triples. Rejected — the whole model is built on treating the three as one kind of thing.
- **EAV / fully generic attributes.** Maximum flexibility, minimum clarity and type-safety. Overkill for three stable types. Rejected.
