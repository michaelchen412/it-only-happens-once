# Architecture Decision Records

Each ADR captures one decision: its context, the decision itself, the consequences (good and bad), and the alternatives we rejected and why. They are the antidote to "why did we do it this way?" six months from now.

## Format

```
# NNNN — Title
Status: Proposed | Accepted | Superseded by ADR-XXXX
Date: YYYY-MM-DD

## Context      — the forces at play; what made this a decision
## Decision     — what we chose, stated plainly
## Consequences — what follows, including the downsides we accept
## Alternatives — what else we considered and why we passed
```

ADRs are immutable once Accepted. To change a decision, write a new ADR that supersedes the old one (and update its Status).

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-rendering-and-hosting.md) | SSR (`output: 'server'`) + Vercel, edge-cached public pages | Accepted |
| [0002](0002-authentication-provider.md) | Supabase Auth (Google OAuth + passkeys), native RLS | Accepted |
| [0003](0003-fragments-single-table.md) | Single `fragments` table for all three content types | Accepted |
| [0004](0004-supabase-over-content-collections.md) | Supabase as the content store; not Astro content collections | Accepted |
| [0005](0005-admin-editing-architecture.md) | Admin edits via Astro Actions; WYSIWYG editor that stores Markdown | Accepted (editor choice superseded by 0006) |
| [0006](0006-composer-editor-tiptap.md) | Composer editor is TipTap (ProseMirror) with a fixed toolbar; stores Markdown | Accepted |
| [0007](0007-ai-subject-tagging.md) | AI subject suggestions via Claude Haiku 4.5 (structured output, human-in-loop, privacy) | Accepted |
| [0008](0008-provenance-and-facets.md) | Authors/works as optional query facets, decoupled from display (the "Bible rule") | Accepted |
| [0009](0009-music-three-roles.md) | Music in three roles (score / paired / annotated fragment); a song's `body` is its "why" | Accepted |
| [0010](0010-online-first-writing.md) | The workshop is online-first; offline capture lives in iCloud Notes | Accepted |
| [0011](0011-paired-media-is-a-fragment.md) | A paired song is a fragment row, and it leads the essay | Accepted |
| [0012](0012-hq-is-a-private-second-domain.md) | HQ is a private second domain in the same app — its own tables, no `anon` policy | Accepted |
| [0015](0015-admin-root-becomes-today.md) | `/admin` becomes Today; the Fragment Manager moves to `/admin/fragments`; the building is the Observatory | Accepted |

**0013 and 0014 are reserved**, not missing: they were drafted alongside 0012
and 0015 and graduate with the work that makes them real — 0013 (*absence never
accumulates*) with the task model, 0014 (*the calendar is one-way*) with the
Google mirror. An ADR is written when the decision is made and published when
the decision is load-bearing; the numbers were allocated at the first.
