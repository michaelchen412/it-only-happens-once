# Architecture

*How the site is assembled and rendered. Companion to [`data-model.md`](data-model.md) and [`auth.md`](auth.md). Decisions are recorded in [`adr/`](adr/).*

⚠ **This file describes the app as it stands today.** When something changes,
this changes with it — the historical record of *why* a thing is the way it is
lives in [`adr/`](adr/), and a superseded narrative left here is worse than no
narrative, because it reads as current. *(Rule set 2026-08-04, after this file
spent a week describing a pre-HQ app that used an editor we had replaced.)*

---

## 1. What the system is

One Astro application with **three** surfaces:

- **The public site** — read-only, fast, cacheable. The **blog** (writing, quotes and music, with search and subject filters), the **Sky** (constellation navigation), and **About**.
- **The Workshop** (`/admin/fragments` and its neighbours) — where the corpus is written and groomed: the fragment manager, the composer, constellations, the Library, the About builder.
- **HQ** (`/admin`, `/admin/people`, `/admin/agenda`, `/admin/notes`) — a private daily dashboard: the morning check-in, the people you are seeing, the agenda, brain dumps. It is a **second domain**, not a feature of the first ([ADR 0012](adr/0012-hq-is-a-private-second-domain.md)): its tables carry no `anon` policy and nothing in it ever becomes public content.

All three are the same Astro app, sharing the design system and components. The building the two private halves live in is the **Observatory**, and its front door is Today ([ADR 0015](adr/0015-admin-root-becomes-today.md)).

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Astro 7** | `output: 'server'` (on-demand rendering) |
| Styling | **Tailwind 4 + daisyUI 5** | CSS-first; tokens and themes in `src/styles/app.css`, which imports `admin.css` and `hq.css` |
| Fonts | **Astro Fonts API** | self-hosted Newsreader + Atkinson Hyperlegible |
| Icons | **astro-icon + Phosphor** | only used icons bundled |
| Database | **Supabase (Postgres)** | single source of truth for all content |
| Auth | **Supabase Auth** | single admin; Google OAuth + passkeys (beta); native RLS ([`auth.md`](auth.md)) |
| Hosting | **Vercel** | adapter provides SSR + on-demand revalidation (ISR) |

## 3. Rendering strategy

The app runs on demand (**`output: 'server'` + an adapter**) so DB-backed pages render fresh and the admin can be auth-gated server-side. We then choose per surface:

- **Public pages → server-rendered from Supabase, cached at the edge.** Read published content via the Supabase anon key (RLS-protected), and cache responses (`Cache-Control` / Vercel on-demand revalidation). On a cache hit these are as fast as static; on publish they revalidate. Content appears without a manual rebuild.
- **Truly static pages** (e.g. About) → `export const prerender = true`, baked at build time.
- **Admin (`/admin`) → `export const prerender = false`, auth-gated.** Middleware redirects unauthenticated requests to sign-in; server code reads the Supabase user from the cookie session (`@supabase/ssr`).

Rationale and alternatives (pure SSG + rebuild-on-publish, etc.) in [ADR 0001](adr/0001-rendering-and-hosting.md).

## 4. Data flow

```
Public read:
  Browser ──▶ Astro (SSR, edge-cached) ──▶ Supabase (anon key, RLS: published only) ──▶ HTML

Admin write:
  Browser ──▶ Supabase Auth (Google / passkey) ──▶ Astro /admin (SSR, cookie session)
                                                   │
                                     Supabase server client (@supabase/ssr, user session)
                                                   ▼
                                     Supabase (RLS: is_admin()) ──▶ INSERT/UPDATE/DELETE
```

- The **anon key** is public and safe to ship to the browser — RLS guarantees it can only read published rows.
- The **service-role key** never reaches the client. It is used only for server-side maintenance (migrations, one-off scripts).
- Admin database access is authorized by the **Supabase Auth session** (cookie-based via `@supabase/ssr`); RLS checks `is_admin()` (see [`auth.md`](auth.md)).

## 5. Public vs. admin separation

| | Public | Admin (`/admin`) |
|---|---|---|
| Rendering | SSR + edge cache (some prerendered) | SSR, uncached |
| Access | anyone | authenticated admin only |
| DB access | anon key, RLS = published only | user session, RLS = admin write |
| Build cadence | independent of content changes (SSR reads live data) | — |

⚠ **The HQ tables are a third case and are stricter than "admin".** They carry
**no `anon` policy at all** — private by omission rather than by a rule that
could be edited wrongly ([ADR 0012](adr/0012-hq-is-a-private-second-domain.md)).
The one seam between the halves runs in a single direction: a person's profile
renders public fragments they shared with you. Nothing private ever becomes
public content.

## 6. The private half, as built

Both halves are shipped. Full design in [`admin.md`](admin.md).

**The Workshop** — the fragment manager (filter / search / sort / bulk), the writing composer (TipTap, storing Markdown — [ADR 0006](adr/0006-composer-editor-tiptap.md)), quote and song quick-editors with Spotify/YouTube auto-fill, draft versions and promotion ([ADR 0010](adr/0010-online-first-writing.md)), constellations and placement, the Library (subjects / authors / works), and the About builder.

**HQ** — Today (the check-in, the day, coming up, people, practice, past due), People (roster, profiles, interactions, drift), the Agenda (calendar, tasks, goals), and Notes. Its three load-bearing decisions: absence never accumulates ([ADR 0013](adr/0013-absence-never-accumulates.md)), the Google calendar mirror is one-way ([ADR 0014](adr/0014-calendar-is-one-way.md)), and HQ is private by construction ([ADR 0012](adr/0012-hq-is-a-private-second-domain.md)).

Editing architecture (Astro Actions, and a WYSIWYG that stores Markdown) is [ADR 0005](adr/0005-admin-editing-architecture.md); the editor itself is TipTap, which supersedes 0005's original choice.

### How the private code is layered

[ADR 0016](adr/0016-hq-layering.md), in one table:

| Layer | Where | May import | Must not |
|---|---|---|---|
| **Rules** — pure, tested, run on both sides | `src/lib/hq/{today,tasks,dates,time,goals,recurrence,checkin,drift}.ts` | other rule modules | a Supabase client, at runtime |
| **Loaders** — queries and shaping | `src/lib/hq/{today-data,brief,links}.ts` | rules; Supabase as a **type** | rendering concerns |
| **Actions** — the one write path | `src/actions/*.ts` | rules, `_shared.ts` | the service-role key |
| **Pages & zones** — render | `src/pages/admin/`, `src/components/admin/` | all of the above | build a view-model of their own |

Three conventions fall out of it and are worth stating separately:

- **A local date is a `YYYY-MM-DD` string, never a `Date`.** `new Date('2026-08-01')` is midnight UTC, so `.getDate()` gives 31 July west of Greenwich. `src/lib/hq/time.ts` is the only place that decides what day it is, and the zone is a row in `settings` rather than the server's clock.
- **Nothing renders UTC on screen.** Server-rendered stamps use the configured home zone; `src/scripts/local-time.ts` then rewrites them into the reader's device zone. The browser may say what o'clock it was, never what day.
- **A module that reaches the browser imports Supabase as a type only**, and takes its client as an argument.

### The write path

Every mutation is an [Astro Action](https://docs.astro.build/en/guides/actions/) in `src/actions/`, composed by `index.ts` — *add a namespace by adding a file, never by growing the index*. Handlers run on `ctx.locals.supabase`, the caller's cookie-session client, so **RLS is the trust boundary and an action is a validation layer, not a security one**. `requireAdmin` is used where an action does not touch an RLS-protected table (the AI parser, the Spotify lookup), and as a readable refusal elsewhere.

Client scripts (`src/scripts/`) are plain TypeScript modules imported by a page's `<script>` — no UI framework, no hydration. The DOM is the state: a selected segment lives in `aria-pressed`, a date lives in the date input, and there is no JavaScript copy of a form beside the form.

⚠ **On the client, an action THROWS on a dead network — it does not return `{ error }`.** The fetch underneath rejects, so a bare `await actions.x.y(…)` skips everything after it: the re-enable, the close, the sentence. `src/scripts/action-error.ts` is the single owner of that invariant and offers three things — `submitAction` (the whole disable → label → await → format → restore lifecycle, and the first choice), `callAction` (turns a throw into `{ error }` where the control is not one button), and `formatActionError` (one human sentence from either kind of failure; **never hand-roll `err instanceof Error ? err.message : …`**, because `TypeError` extends `Error` and that idiom prints `Failed to fetch` in exactly the case its friendly fallback was written for). `src/tests/action-guard.test.ts` holds the line: it fails on any new bare `await actions.` and carries an allowlist of the files whose throw is caught elsewhere.

## 7. The public surfaces, as built

- **The Sky** (`/`) — the constellation overview; `/{slug}` is one constellation as a typeset suite. Canonical and shareable: the zoom is navigation, and home *is* the overview (`design.md` §13).
- **The blog** (`/blog`) — writing by date, with quote and music indexes in their own view shapes, plus search and subject filters ([`search.md`](search.md)).
- **A single piece** (`/blog/[slug]`) — the `/reading` layout, rendering one `writing` fragment. An unpublished one is visible to the admin behind a preview bar and 404s for everyone else.
- **About** (`/about`) — built from the About builder, with a contact form (Resend + Cloudflare Turnstile).

## 8. Migration

**Done (reflections).** The Squarespace WordPress-format export (`legacy/Squarespace-Wordpress-Export-07-18-2026.xml`, 523 posts across `/journal/`, `/reflections/`, `/for-someone/`) is the source. The **50 `/reflections/` essays** were imported via a one-off script ([`scripts/import-reflections.mjs`](../scripts/import-reflections.mjs), run with the service-role key): HTML→Markdown (turndown), authoritative dates from `wp:post_date`, the paired Spotify/YouTube embed captured into `details.media`, images dropped, published. Subjects came from an AI-proposed, human-reviewed taxonomy of 21 ([`scripts/reflections-subjects.json`](../scripts/reflections-subjects.json)). The script is idempotent (upsert by slug).

This **revised** the earlier "migrate through the composer" plan: once we knew the content was already clean Markdown at real volume (500+ posts, not ~12), a batch script was clearly right; the composer is for review/edits and new posts.

**Done (quotes).** The **72 quotes** in [`legacy/Quotes/*.md`](../legacy/Quotes/) (one `On X` file per theme, hand-written and inconsistently formatted) were imported via [`scripts/import-quotes.mjs`](../scripts/import-quotes.mjs) as published `quote` fragments. The parser normalizes the mess into a clean shape — em/en/bar-dash attributions, `**bold**` and curly-quote wrappers stripped, `#hashtag` sources (`#meditations` → Marcus Aurelius / *Meditations*) distinguished from `#hashtag` themes, and inline `(Book 2:2)` / `(34)` citations split into `details.citation` (chapter/verse/letter, text) vs `details.page` (bare number); duplicate quotes across folders merged. Per the quote-taxonomy decision, each quote carries **1–3 subjects reusing the existing 21** (no new subjects invented at import) — curated in [`scripts/quotes-subjects.json`](../scripts/quotes-subjects.json), keyed by body-slug — which naturally rebalances the folders' lopsided counts (the overloaded `On Self-Discipline…` scatters across `detachment`/`self-improvement`/`death`/…). Idempotent (upsert by slug).

**Deferred:** the `/journal/` (424 short dailies) and `/for-someone/` (49 personal letters) sections — each wants its own treatment/surface and privacy decision, not the essay feed.

## 9. Directory structure

As it stands. *(This section describes the tree today; history lives in the ADRs.)*

```
src/
  styles/
    app.css                ← the law: theme, type, base — and it imports the other two, LAST
    admin.css              ← the workshop's component classes (.admin-*, the sheets, the rows)
    hq.css                 ← the Observatory's primitives (.zone, .row, .chip, .stamp, …)
  layouts/                 ← Base · SiteLayout (public) · AdminLayout (the Observatory)
  components/              ← public primitives: PostCard, Reader, Timestamp, StarMark, …
    admin/                 ← private ones: Zone, PageHeader, the *Sheet dialogs, the *Zone cards
      checkin/             ← the Morning card's two heavy panels (DonePanel, FillPanel)
  lib/
    supabase.ts            ← client factories (browser / server session via @supabase/ssr)
    database.types.ts      ← GENERATED from the live schema; never hand-edit
    blog.ts, media.ts, markdown.ts, fragment-query.ts, …   ← the corpus half
    hq/                    ← the private half: rules, then loaders (ADR 0016)
  actions/                 ← the one write path; index.ts only composes (ADR 0005)
  scripts/                 ← client-side modules, imported by a page's <script>
  pages/
    index.astro            ← the Sky (constellation overview)
    [slug].astro           ← one constellation
    blog/, about, reading, constellations, styleguide
    admin/                 ← Today (index), people/, agenda/, notes, fragments, library, …
    auth/callback.ts       ← OAuth code exchange → session cookies
  tests/                   ← vitest: pure functions only (*.test.ts)
  middleware.ts            ← Supabase session refresh + /admin route protection
tests/e2e/                 ← Playwright, against the live project — read-only by construction
docs/                      ← this folder; adr/ holds the decisions
supabase/migrations/       ← SQL migrations (schema + RLS)
scripts/                   ← one-off Node tooling (imports, backfills, build checks)
```

## 9a. Working on it

```
npm run dev        astro dev
npm run verify     format:check + lint + astro check + test   ← before pushing
npm run test       vitest (pure functions)
npm run test:e2e   Playwright — needs a dev server and a real admin session
npm run format     prettier across the tree
```

**`npm run verify` is the gate.** A pre-commit hook (husky + lint-staged) formats
and lints *staged files only* — deliberately not the test suite, because a slow
hook is a bypassed hook. Formatting is Prettier's alone; ESLint carries no style
rule.

⚠ **Green checks are necessary and nowhere near sufficient.** Twice, work has
shipped with a clean typecheck, a clean build and green unit tests and been
broken within ten minutes of a human using it. Anything whose behaviour depends
on state a compiler cannot see — network conditions, dialogs, sessions, the
authenticated admin — wants the e2e harness or a real look.

⚠ **`.git-blame-ignore-revs`** lists the whole-tree reformat of 2026-08-04.
Turn it on once per clone: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## 10. Environment & secrets

See [`auth.md`](auth.md) §Secrets for the full table. In short: `PUBLIC_*` keys are browser-safe (Supabase URL + anon key); `SUPABASE_SERVICE_ROLE_KEY` is server-only and never imported into client code. Google OAuth credentials live in the Supabase dashboard, not in env.
