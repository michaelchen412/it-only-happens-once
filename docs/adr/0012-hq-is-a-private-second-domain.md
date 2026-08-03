# 0012 — HQ is a private second domain in the same app, not a fragment type

Status: **Accepted** *(2026-08-02, with [0015](0015-admin-root-becomes-today.md);
the boundary stated here becomes load-bearing the moment `/admin` stops being
the corpus workshop)*
Date: 2026-07-31

## Context

The application so far has exactly one domain: the **corpus**. Everything
shareable is a `fragment` ([ADR 0003](0003-fragments-single-table.md)), the
Observatory exists to author it, and RLS is built around a single question —
*is this published?*

Michael wants the site to become his HQ: a people database, a calendar and task
agenda, and a daily morning check-in covering sleep, affect, and dreams. His
stated reason is that these things currently live across Google Calendar,
Obsidian, a to-do app and iPhone Reminders, and *"you have to click in multiple
places to accomplish one task."*

Three forces shape the decision.

**1. The real payoff is correlation, not convenience.** "One place" is available
from any off-the-shelf tool. What four vendors' databases structurally cannot do
is answer *do difficult mornings cluster before weeks with back-to-back
obligations?* or *are they the ones following days with no writing?* That
requires one database, which is an argument for the same app — not merely the
same browser tab.

**2. The two domains have opposite privacy defaults.** The corpus is authored to
be *published*; RLS is an allowlist (`status = 'published'`) so that a tier added
below the line is private by construction. HQ is authored to be *never* seen: it
holds other people's birthdays, personal circumstances and things said in
confidence, alongside Michael's own daily health records. Confirmed 2026-07-31:
no HQ data is ever public, even in aggregate.

**3. There is a real temptation to reuse `fragments`.** It already has a type
enum, a status ladder, dates with precision, Markdown bodies, subjects, an
editor, a list UI, search, trash, and versions. A `person` type or an
`interaction` type would inherit all of it in an afternoon.

That temptation must be refused, and the reason is precisely point 2: the
fragments table's entire security model is organised around a published/unpublished
axis that HQ data does not have. Putting private third-party information behind a
policy whose default posture is "this is destined to be public" means one
mis-scoped query, one forgotten `.eq('status', …)`, or one future feature that
relaxes the allowlist would leak someone's medical situation. The corpus RLS is
safe *because* it is an allowlist; HQ's safety comes from a different property
entirely — **the absence of any `anon` policy at all**, the pattern
`fragment_versions` already uses ([data-model.md](../data-model.md) §6).

Michael also confirmed the domains do not blend in the other direction: a private
log entry about a conversation **never** gets promoted into an essay or a quote.

## Decision

**HQ is a second domain inside the same Astro app and the same Supabase
database, with its own tables, and is private by construction.**

- **Same app, same DB, same sign-in.** Cross-domain correlation is the entire
  thesis; two apps cannot have it.
- **Its own tables** — `daily_checkins`, `people`, `interactions`, `tasks`,
  `events`, and the join tables. **Not** new `fragment_type` values, and not new
  columns on `fragments`.
- **RLS: `is_admin()` for every operation, and no `anon` policy on any HQ
  table.** Private by omission, not by predicate.
- **No public route may read an HQ table.** Not filtered, not aggregated, not
  anonymised.
- **The seam is links, and links are private.** A person may be linked to a
  `fragment` or a `work`. The linked fragment stays as public as it was; the
  *link row* is HQ data with no `anon` policy.

## Consequences

- The corpus's security model is untouched. Nothing about HQ can widen what the
  anon key can read, because the anon key has no grant on any HQ table.
- HQ pays for its own machinery: its own editors, its own list surfaces, its own
  actions namespace. The fragments UI is not reusable wholesale. This is the
  accepted cost, and it is smaller than it looks — HQ's surfaces genuinely want
  to be different (a roster of ~25 people is not a sortable table of 126
  fragments).
- The `fragments` table stays a coherent concept: *things curated for other
  people.* Its type enum does not acquire members that are nothing like the
  other three.
- **New obligations that are nobody's default:**
  - `/admin/export.json` must not silently grow to include HQ tables.
  - The nightly backup repo now carries third-party personal data. Private is
    necessary; whether it is sufficient is a decision to make consciously.
  - Person photos cannot use the `site` bucket, which is `public = true`.
  - Seeds, fixtures and the Playwright harness's discovered fixtures must never
    contain real people.
- `docs/` is committed to a public repo, so **documenting** HQ publicly is a
  separate decision from **building** it. The split settled on: the technical
  architecture graduates — schema, RLS, routes, surfaces, and the reasoning
  behind each shape — while real examples and the personal substance behind any
  particular field do not. A doc may say *what the system does and why that
  shape*, never *what the data says*.

## Alternatives

**New `fragment_type` values (`person`, `interaction`, `task`).** Fastest to
build, and wrong on security: it places private third-party data behind a policy
whose organising axis is publication. It also corrupts the domain model — a
chore is not a curated piece of Michael, and `vision.md`'s definition of a
fragment would have to be gutted to accommodate it.

**A separate app or a second Supabase project.** Cleanly private, and it deletes
the only reason to build this at all: correlation across domains requires one
database. It would also mean two deploys, two sign-ins, and two mental models —
reproducing the exact fragmentation HQ exists to end.

**A private schema (`hq.*`) in the same database.** Genuinely attractive: it
makes "no anon grant" a schema-level property rather than a per-table discipline.
Not chosen for v1 only because PostgREST needs the schema exposed to reach it,
which adds configuration that must be got right, and because `is_admin()` +
no-`anon`-policy is a pattern already proven in this codebase. **Worth
revisiting** if HQ grows past a dozen tables.

**Keep using Obsidian / Notion / Google, better organised.** The stated failure
is not that those tools are bad; it is that four of them cannot be one of them,
and none of them can correlate. Rejected by the premise.
