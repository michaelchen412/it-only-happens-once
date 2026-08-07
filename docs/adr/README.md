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
| [0008](0008-provenance-and-facets.md) | Authors/works as optional query facets, decoupled from display (the "Bible rule") | Accepted — display half superseded by 0017 |
| [0009](0009-music-three-roles.md) | Music in three roles (score / paired / annotated fragment); a song's `body` is its "why" | Accepted |
| [0010](0010-online-first-writing.md) | The workshop is online-first; offline capture lives in iCloud Notes | Accepted |
| [0011](0011-paired-media-is-a-fragment.md) | A paired song is a fragment row, and it leads the essay | Accepted |
| [0012](0012-hq-is-a-private-second-domain.md) | HQ is a private second domain in the same app — its own tables, no `anon` policy | Accepted |
| [0013](0013-absence-never-accumulates.md) | Absence never accumulates: a recurrence is a rule plus one date, and a row is written only on disposition | Accepted |
| [0014](0014-calendar-is-one-way.md) | The calendar is one-way: Google reads in, HQ owns the personal, and tags are additive | Accepted |
| [0015](0015-admin-root-becomes-today.md) | `/admin` becomes Today; the Fragment Manager moves to `/admin/fragments`; the building is the Observatory | Accepted |
| [0016](0016-hq-layering.md) | HQ's three layers — rules are pure, loaders gather, pages render; routing belongs to the page | Accepted |
| [0017](0017-quote-provenance-three-facts.md) | A quote is three facts (Who / From / Where); the line under it is derived, and the citation opens behind the attribution itself | Accepted |
| [0018](0018-notes-use-the-composer-editor.md) | Notes use the composer's editor on both surfaces; plan 14 §4's "plain `<textarea>`, ever" rule is retired, with the dictation trade on the record | Accepted |
| [0019](0019-push-is-a-contract-you-sign.md) | Push: HQ may reach you when nothing is open — two contracts (ambient signal vs. an escalation you sign), no service worker, scheduler in Supabase | **Proposed** |
| [0020](0020-the-about-page-does-not-summarise.md) | The About page does not summarise the sky — interests, headline and thesis are removed; no surface restates what a constellation delivers | **Proposed** |
| [0021](0021-dark-is-the-default-not-the-system-preference.md) | Dark is the default, not the system preference: `dusk` is unconditional and `paper` is a sticky opt-in; scoped to `prefers-color-scheme` only | **Proposed** |

**Every HQ draft has now graduated.** 0012 and 0015 landed 2026-08-02 with the
move; **0013 and 0014 on 2026-08-03**, each with the thing that made it real —
0013 with `tasks`/`task_events`, 0014 with the Google mirror. That is the
pattern the four were written to follow: an ADR is *written* when the decision is
made and *published* when it is load-bearing, and a decision sitting in a
git-ignored folder is one nobody outside this repo can read.

⚠ **0014's Context was corrected before it was accepted, not after.** Its draft
justified the mirror by invitations from other people; reading the live calendar
end to end found one event in forty-eight created by anyone else, and that what
actually arrives is Gmail-extracted bookings — flights, hotels, reservations.
The decision was unchanged and the reasoning was not. ADRs are immutable once
Accepted, which is exactly why a false premise had to be fixed on the way in.
