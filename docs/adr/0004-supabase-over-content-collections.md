# 0004 — Supabase as the content store (not Astro content collections)

Status: Accepted
Date: 2026-07-18

## Context

Astro offers **content collections** (with the Content Layer API): type-safe, Zod-validated collections loaded from local Markdown/MDX/JSON via `glob()`/`file()`, or from remote sources via a custom loader, and queried with `getCollection()`. Crucially, **collections resolve at build time** — the content is baked into a data store when the site builds. They are excellent for file-based, git-versioned, static content.

We evaluated them because a file-based Astro blog is the common path, and it was raised in an earlier planning conversation. But this project has since committed to an **auth-secured admin dashboard** for managing content, **relational fragments** (many-to-many constellations with composed ordering, plus subject tags), and three content types including songs and quotes.

## Decision

**Supabase (Postgres) is the single source of truth for all fragments.** We do **not** use content collections as the content store. Type-safety comes from Supabase's generated TypeScript types plus Zod validation at the data boundary. Content collections may still be used, optionally, for genuinely static in-repo pages (e.g. About) — never for fragments.

## Consequences

- Content is created and edited through the admin UI and appears via SSR without a rebuild — the entire point of having an admin ([ADR 0001](0001-rendering-and-hosting.md)).
- Relational data (constellation membership + `position`, subject tags, shared fragments) lives where it belongs — in SQL joins, not flat-file frontmatter.
- We forgo git-versioned Markdown authoring of essays. Mitigation: give the admin editor a Markdown mode, keeping the *authoring feel* without splitting where data lives.
- We take on a database dependency for content (already required for the rest of the app).

## Alternatives

- **Content collections as the store (files in the repo).** Static, git-versioned, no DB. Rejected: build-time resolution fights an admin-managed dynamic model, and relational fragments are painful as files.
- **Hybrid: essays as MDX collections, songs/quotes in Supabase.** Tempting for the writing-in-git nicety. Rejected: it splits the source of truth in two and makes the Sky ugly — a single constellation would have to join essays-from-files with songs-from-DB. Coherence outweighs the authoring perk.
- **Content-Layer loader over Supabase (build-time snapshot).** Would give the `getCollection()` DX while data lives in Postgres, but only makes sense under SSG; we chose SSR + caching, so it adds a layer without benefit. Rejected.
