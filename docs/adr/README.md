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
