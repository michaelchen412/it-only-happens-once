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

## When one is owed

*Added 2026-08-10 (plan 35 · §1). This file defined the SHAPE of an ADR and said
nothing about **when** one is due, so the habit ran on memory — and a sweep of
all 36 plan files found five decisions that met every test below and had never
been written down. Four of them were load-bearing enough to be cited as
precedent by later work.*

**Three questions. All three must be yes.**

1. **Does it constrain work that hasn't been specified yet?** A decision about
   *this* feature is a code comment. A decision about *every future feature of a
   kind* is an ADR. [0013](0013-absence-never-accumulates.md) is the model — it
   ends *"this constrains every future HQ surface."*
2. **Is there a rejected alternative a competent person would re-propose?** If
   nobody would argue the other way, it is a fact rather than a decision, and
   facts belong in the `docs/` file that describes the thing.
3. **Could someone with only this repository — no `docs/plans/`, no
   `design.md` — reconstruct it?** If yes, don't write one.

⚠ **Question 3 is the one that catches the actual drift**, because it is the
only one of the three that fails on the two homes that are **git-ignored**. The
worked example: plan 18 rejected an entire navigation architecture by citing
`design.md` §13 as binding precedent — quoting both the rule and a reversal that
had been *built, felt and reversed* — so for a year a reader could work through
every ADR here and still not learn why the Sky navigates the way it does. That
is what [0024](0024-the-sky-is-navigation.md) exists to fix.

**Every plan ends with an `## ADR` line, and "none, because…" is a valid answer
that still has to be written.** See GROUND-RULES (`docs/plans/GROUND-RULES.md`).
Writing the *refusal* is what makes the acceptance reliable: an optional prompt
gets skipped by exactly the sessions that most needed it — the ones deep in a
build, where the ADR-grade decision was taken two hours ago and now reads as
obvious.

## Immutability, and what it binds

ADRs are immutable once Accepted. To change a decision, write a new ADR that supersedes the old one (and update its Status).

⚠ **Immutability binds the CLAIM, not the POINTERS.** *(Ruled 2026-08-10, plan
35 · §3, after plan 31 left it open.)* A path, a link, a filename or a typo may
be corrected in place, and should be. A premise, a decision, a consequence or a
rejected alternative may not — those need a superseding ADR.

The case that forced the ruling: `0017` is **Accepted** and its §Decision linked
`/reveal-lab`, a dev bench deleted in plan 31 · §7. Repairing the link changes
where the sentence points and not what it says. Under a rule with no maintenance
category, the only compliant options were *leave a published document linking to
nothing* or *supersede a decision that had not changed* — and every source path
named in an Accepted ADR is a future instance of the same bind.

**The test is whether a reader who accepted the original would object.** Nobody
accepted 0017 *because* the bench was at that URL.

## A plan is cited, never linked

⚠ **`docs/plans/` is git-ignored, so a link into it is dead for every reader who
is not Michael.** An ADR is a *published* document; a published document whose
provenance citations all 404 fails question 3 above — the one it was written
under.

So a plan is named in prose with its path in code —
*plan 18 (`docs/plans/archive/18-sky-return.md`)* — which stays copy-pasteable
locally and is honest that it is not in the repository. Same for `design.md`,
`vision.md` and `about-michael.md`: **quote them, don't link them.**

*Applied to all 21 such links on 2026-08-10 (plan 35 · §2), across nine files
including three Accepted ADRs — which is the immutability ruling above doing
exactly the job it was made for. Three of the twenty-one were already broken
even locally, because plans 18, 22 and 23 had moved to `archive/`.*

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-rendering-and-hosting.md) | SSR (`output: 'server'`) + Vercel, edge-cached public pages | Accepted |
| [0002](0002-authentication-provider.md) | Supabase Auth (Google OAuth + passkeys), native RLS | Accepted — **the passkey half was never built** ([`auth.md`](../auth.md) §1) |
| [0003](0003-fragments-single-table.md) | Single `fragments` table for all three content types | Accepted |
| [0004](0004-supabase-over-content-collections.md) | Supabase as the content store; not Astro content collections | Accepted |
| [0005](0005-admin-editing-architecture.md) | Admin edits via Astro Actions; WYSIWYG editor that stores Markdown | Accepted (editor choice superseded by 0006) |
| [0006](0006-composer-editor-tiptap.md) | Composer editor is TipTap (ProseMirror) with a fixed toolbar; stores Markdown | Accepted |
| [0007](0007-ai-subject-tagging.md) | AI subject suggestions via Claude Haiku 4.5 (structured output, human-in-loop, privacy) | Accepted |
| [0008](0008-provenance-and-facets.md) | Authors/works as optional query facets, decoupled from display (the "Bible rule") | Accepted — display half superseded by 0017 |
| [0009](0009-music-three-roles.md) | Music in three roles (score / paired / annotated fragment); a song's `body` is its "why" | Accepted — the annotated-fragment role superseded by 0031, then retired by 0035; the score and the pairing stand |
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
| [0020](0020-the-about-page-does-not-summarise.md) | The About page does not summarise the sky — interests, headline and thesis are removed; no surface restates what a constellation delivers | Accepted |
| [0021](0021-dark-is-the-default-not-the-system-preference.md) | Dark is the default, not the system preference: `dusk` is unconditional, `paper` is a sticky opt-in, `prefers-color-scheme` is not consulted, and the standalone status bar follows the choice | **Proposed** |
| [0022](0022-the-sky-affords-differently-on-a-thumb.md) | The Sky affords differently on a thumb: every affordance used to be a `:hover` rule, so touch gets three signals arriving as one — and touch and pointer are two models, each consulting exactly one ambient input, never one model with a fallback | **Proposed** |
| [0023](0023-the-apparatus-closes-the-reading.md) | A fragment's apparatus sits at the FOOT; a word is only for a stanza that is incomplete without the click | Proposed |
| [0024](0024-the-sky-is-navigation.md) | The zoom is navigation and the overview is home: `/{slug}` is canonical and shareable, returning is remember-and-restore, and a suite resolves upward | Accepted |
| [0025](0025-an-element-names-its-table.md) | If an element cannot name a table, it does not belong on the page — and a suggestion is never an automatic write | Accepted |
| [0026](0026-a-multi-row-write-is-one-transaction.md) | A write that must not partly happen is a `plpgsql` function, `SECURITY INVOKER`, so RLS stays the trust boundary | Accepted |
| [0027](0027-one-lifecycle-for-every-action-call.md) | Every action call goes through `submitAction`/`callAction`, and a per-file allowlist test — not a lint rule — enforces it | Accepted |
| [0028](0028-the-e2e-suite-is-read-only-against-live.md) | The e2e suite runs against the live project; read-only is a fixture that blocks `/_actions/**` by default, and branching is refused with three named triggers | Accepted — **trigger 2 fired**; the seeded-write case it anticipated is [0037](0037-a-seeded-write-is-throwaway-gated-and-swept.md), and trigger 3 now counts write-capable opt-outs only |
| [0029](0029-a-writing-stanza-sits-on-a-page.md) | A writing stanza sits on a page and the page has no left edge, so the drawn figure passes through it; quotes and songs stay typeset | Accepted |
| [0030](0030-the-page-carries-the-masthead.md) | The top bar is a running head with no accent and no hairline, the room's own switch is the masthead, and the footer is an address block rather than an ending | Accepted |
| [0031](0031-a-song-carries-a-feeling-not-an-idea.md) | A song carries a feeling, not an idea: no subjects, never a suite stanza, filed by feeling, and the annotation becomes a public note and a private one | **Superseded by [0035](0035-a-set-is-a-listen-you-can-take-away.md)** — 1 song of 48 was ever tagged |
| [0032](0032-a-sheet-is-dismissible-and-says-what-that-costs.md) | Every sheet is dismissible by its backdrop and must answer what that costs — nothing (it applies or flushes) or something (so it guards, on all three gestures); a test enforces it | Accepted |
| [0033](0033-the-observatory-has-one-field-grammar.md) | One field grammar for every admin form — `.f__k` carrying `.admin-label`'s register at an ink that passes AA in both themes; the geometry converges, the domain hues never do | Accepted |
| [0034](0034-a-relation-may-be-edited-from-either-end.md) | The invariant is one write **path**, not one control — a relation may be edited from either end, where the question it answers actually arises; and where the cardinality is asymmetric, the end that can take another row's slot must say so | Accepted |
| [0035](0035-a-set-is-a-listen-you-can-take-away.md) | A set is a listen you can take away: one curated playlist, one quote, one description, replacing the feelings room — a constellation is where an idea is worked out, a set is where a feeling is isolated | Accepted |
| [0036](0036-a-reload-is-how-the-observatory-tells-the-truth.md) | After a write, an admin surface re-derives by reloading, and patches only where a reload would destroy something the page holds — the database is the only model | Accepted |
| [0037](0037-a-seeded-write-is-throwaway-gated-and-swept.md) | A spec may create rows in the live project only if all five hold: flagged off by default, `zzz-e2e-throwaway` prefix, `afterEach` sweep, service key under `tests/` only, real control driven through the admin's own session. Extends [0028](0028-the-e2e-suite-is-read-only-against-live.md) | Accepted |
| [0038](0038-a-private-admin-surface-may-require-javascript.md) | A private single-user admin surface may require JavaScript; progressive enhancement is not on its own a reason to keep a page-scoped form. Scoped to `/admin` — it does not touch the public side | Accepted |

⚠ **0024–0028 are a BACKFILL, written 2026-08-10 in one sitting**
(plan 35 (`docs/plans/35-the-decision-has-one-home.md`) · §2), after a sweep of all
36 plan files found five decisions that met every test above and had never been
written down. Each had been governing work for weeks or months from a
**git-ignored** file — `design.md`, or the plans folder — and four had already
been cited as precedent by later plans.

**They are relocations rather than reconstructions**, which is why they could be
written at all and why they are Accepted rather than Proposed: three of the five
arguments already existed in full, in a migration header, a test fixture header,
and a script header. What they lacked was an address a stranger could find. The
two that were genuinely homeless are 0024 (quoted out of `design.md`, which
cannot be linked) and 0027.

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
