# Documentation

Durable records of what this site is and how it's built — so that neither a human nor an AI collaborator has to re-derive the architecture, and so the design doesn't drift as we build.

## Read in this order

1. **[`../vision.md`](../vision.md)** — product vision & conceptual model (the "what and why"). The walkable self-portrait, the Sky, the fragments/constellations model.
2. **[`../design.md`](../design.md)** — visual design system (the "how it looks"). Type, color, iconography, components, the anti-drift law.
3. **[`../about-michael.md`](../about-michael.md)** — who this is for.
4. **[`architecture.md`](architecture.md)** — system architecture: rendering, hosting, data flow, public vs. admin, the incremental admin roadmap.
5. **[`data-model.md`](data-model.md)** — database schema, ERD, and how the domain maps to tables.
6. **[`auth.md`](auth.md)** — authentication (Supabase Auth), Row Level Security, admin protection, secrets.
7. **[`search.md`](search.md)** — search & match-highlighting: the engine, the XSS boundary, the perf traps, and the checklist for reusing it on the public frontend.
8. **[`adr/`](adr/)** — Architecture Decision Records: the reasoning, alternatives, and consequences behind each major choice.

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
| Provenance | **authors/works** as query facets, decoupled from display | [0008](adr/0008-provenance-and-facets.md) |

## Status

Conceptual model and design system are settled and partly prototyped (`/styleguide`, `/reading`). The **blog surface** (public reads + admin writes) is the current build target. The **Sky** (constellation navigation) is a later, separate effort.
