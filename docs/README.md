# Documentation

Durable records of what this site is and how it's built — so that neither a human nor an AI collaborator has to re-derive the architecture, and so the design doesn't drift as we build.

## Read in this order

1. **[`../vision.md`](../vision.md)** — product vision & conceptual model (the "what and why"). The walkable self-portrait, the Sky, the fragments/constellations model.
2. **[`../design.md`](../design.md)** — visual design system (the "how it looks"). Type, color, iconography, components, the anti-drift law.
3. **[`../about-michael.md`](../about-michael.md)** — who this is for.
4. **[`architecture.md`](architecture.md)** — system architecture: rendering, hosting, data flow, public vs. admin, the incremental admin roadmap.
5. **[`data-model.md`](data-model.md)** — database schema, ERD, and how the domain maps to tables.
6. **[`auth.md`](auth.md)** — authentication (Supabase Auth), Row Level Security, admin protection, secrets.
7. **[`admin.md`](admin.md)** — the Observatory: the third room. Every surface that writes, the editor, the fragment tiers, draft versions, and how installing it to a home screen works.
8. **[`search.md`](search.md)** — search & match-highlighting: the engine, the XSS boundary, the perf traps, and the checklist for reusing it on the public frontend.
9. **[`backups.md`](backups.md)** — how the corpus is protected: the nightly dump (private repo), what it covers, what it doesn't.
10. **[`adr/`](adr/)** — Architecture Decision Records: the reasoning, alternatives, and consequences behind each major choice.

## Decisions locked so far

| Area | Decision | ADR |
|---|---|---|
| Content surface name | Stays **"blog"** for now (Library/Commonplace/Record judged misleading) | — |
| Rendering | Astro **`output: 'server'`** + Vercel adapter; public SSR + edge caching; admin SSR | [0001](adr/0001-rendering-and-hosting.md) |
| Auth | **Supabase Auth** — Google OAuth + passkeys (single admin) | [0002](adr/0002-authentication-provider.md) |
| Data model | Single **`fragments`** table, three types | [0003](adr/0003-fragments-single-table.md) |
| Content store | **Supabase** is the single source of truth; **no** content collections | [0004](adr/0004-supabase-over-content-collections.md) |
| Type direction | **Editorial** — Newsreader + Atkinson Hyperlegible | `design.md` |
| Themes | **dusk** (dark) / **paper** (light), OKLCH, semantic tokens only | `design.md` |
| Composer editor | **TipTap** (ProseMirror), fixed toolbar, stores Markdown | [0006](adr/0006-composer-editor-tiptap.md) |
| AI subject tagging | **Claude Haiku 4.5**, structured output, human-in-loop | [0007](adr/0007-ai-subject-tagging.md) |
| Provenance | **authors/works** as query facets (the browse axis) | [0008](adr/0008-provenance-and-facets.md) |
| Quote provenance | A quote is **three facts — Who / From / Where**; the shown line is *derived* from them, and the citation opens behind the attribution itself | [0017](adr/0017-quote-provenance-three-facts.md) |
| Music | Three roles — **score / paired / annotated fragment**; a song's `body` is its *why*, the embed is the citation | [0009](adr/0009-music-three-roles.md) |
| Offline | **Online-first.** No outbox, no service worker, no queue — one was built and removed within two days | [0010](adr/0010-online-first-writing.md) |
| Paired media | A song paired to an essay is **a fragment**, not a column | [0011](adr/0011-paired-media-is-a-fragment.md) |
| HQ | A **private second domain** — its tables carry no `anon` policy at all; private by omission | [0012](adr/0012-hq-is-a-private-second-domain.md) |
| Arrears | **Absence never accumulates.** One row and one date per answer, so a queue of overdue occurrences cannot come into existence | [0013](adr/0013-absence-never-accumulates.md) |
| Google calendar | **One-way mirror.** The token carries `calendar.events.readonly`, so the rule is enforced by the credential rather than by discipline | [0014](adr/0014-calendar-is-one-way.md) |
| The front door | `/admin` is **Today**; the Fragment Manager moved to `/admin/fragments`; the building is the Observatory | [0015](adr/0015-admin-root-becomes-today.md) |
| HQ layering | **Rules are pure, loaders gather, pages render** — and routing belongs to the page | [0016](adr/0016-hq-layering.md) |
| Editing a published piece | Never mutates the canonical row: edits autosave into a **draft version**, and **promotion** is a deliberate act that preserves what it replaces | [admin.md §5a](admin.md) |
| Fragment tiers | **note → draft → published**, one linear promotion. Notes are a `status`, private by RLS allowlist | [admin.md §5b](admin.md) |
| Notes editor | **The composer's editor on both note surfaces** — the ✚ box and the pile. Plan 14's "plain `<textarea>`, ever" rule is retired, and the dictation trade is on the record rather than in the past | [0018](adr/0018-notes-use-the-composer-editor.md) |

## Status

*As of 2026-08-04.*

**Built and live:** the public blog (writing / quotes / music, with search and subject filters), the **Sky** (constellation overview and typeset suites), About with a contact form, the **Workshop** (fragment manager, composer, versions, constellations, Library, About builder), and **HQ** (Today, People, the Agenda, Notes).

**What's open** is not new surfaces but the rough edges on these — freshness, controls, accessibility, and a set of verification items that need a real morning rather than a test run.

## Before you commit

```
npm run verify     format:check + lint + astro check + test
```

A pre-commit hook formats and lints staged files. ⚠ **Green checks are necessary and nowhere near sufficient** — see [`architecture.md`](architecture.md) §9a for why that sentence is here.
