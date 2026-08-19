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
| Styling | **Tailwind 4 + daisyUI 5** | CSS-first; tokens and themes in `src/styles/app.css`. It imports `admin.css`; **`hq.css` is loaded by `AdminLayout` instead** (see §9) |
| Fonts | **Astro Fonts API** | self-hosted Newsreader + Atkinson Hyperlegible |
| Icons | **astro-icon + Phosphor** | only used icons bundled |
| Images | **Vercel Image Optimization** | `<Image>` over Supabase-hosted originals; AVIF/WebP + per-breakpoint widths. Supabase's own transform endpoint is a paid add-on and is **off** — see the width allowlist and `domains` warnings in `astro.config.mjs` |
| Database | **Supabase (Postgres)** | single source of truth for all content |
| Auth | **Supabase Auth** | single admin; **Google OAuth only**; native RLS ([`auth.md`](auth.md)) |
| Hosting | **Vercel** | adapter provides SSR + on-demand revalidation (ISR) |

## 3. Rendering strategy

The app runs on demand (**`output: 'server'` + the Vercel adapter**) so DB-backed pages render fresh and the admin can be auth-gated server-side. **Every route is server-rendered; the difference between surfaces is the cache header, not the render mode.**

- **Public pages → server-rendered from Supabase, cached at the edge.** Read published content via the Supabase anon key (RLS-protected), and set `Cache-Control: public, s-maxage=60, stale-while-revalidate=86400` — the Sky, `/blog`, `/blog/[slug]`, `/{slug}` and `/about` each set it themselves. On a cache hit these are as fast as static; a publish is visible within the minute. Content appears without a manual rebuild.
- **⚠ A page an admin is previewing flips to `private, no-store`** instead. A draft renders for Michael and 404s for everyone else, so caching that response at the edge would hand a draft to the next stranger. `[slug].astro` and `blog/[slug].astro` both branch on it, and `PreviewBar` says so in its own header.
- **The Observatory → uncached, auth-gated.** Middleware sets `Cache-Control: no-store` on the whole of `/admin` and redirects unauthenticated requests to sign-in; server code reads the session from the cookie (`@supabase/ssr`). The cost is bfcache for the admin, taken deliberately — a restored workshop is a lying workshop ([`admin.md`](admin.md) §2a).

⚠ **There is no prerendered tier, and there never was one in this tree.** This section described "truly static pages (e.g. About) → `export const prerender = true`" until 2026-08-09; `grep -rn prerender src/` returns **nothing**, and `about.astro` is SSR with an edge cache like its neighbours. Astro's `output: 'server'` makes on-demand the default, so a page becomes static only by opting in — and nothing here ever did. The claim was plausible enough to survive a year of reading, which is exactly what makes it worth a line rather than a silent delete.

Rationale and alternatives (pure SSG + rebuild-on-publish, etc.) in [ADR 0001](adr/0001-rendering-and-hosting.md).

## 4. Data flow

```
Public read:
  Browser ──▶ Astro (SSR, edge-cached) ──▶ Supabase (anon key, RLS: published only) ──▶ HTML

Admin write:
  Browser ──▶ Supabase Auth (Google OAuth) ──▶ Astro /admin (SSR, cookie session)
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
| Rendering | SSR + edge cache (`s-maxage=60`) | SSR, `no-store` |
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
- **Nothing renders UTC on screen — but only instants have a zone to render in.** Server-rendered stamps use the configured home zone; `src/scripts/local-time.ts` then rewrites them into the reader's device zone. The browser may say what o'clock it was, never what day. ⚠ **A CALENDAR DATE IS THE EXCEPTION AND IT IS NOT A LOOPHOLE** — `occurred_at` at day precision is the day a piece belongs to, not a moment; it is written as that day's UTC midnight and read back in UTC, with no time of day, so it says the same thing in every zone. Applying the rule above to it literally is what dated 30% of the published essays a day early. See [ADR 0039](adr/0039-an-instant-and-a-calendar-date-are-different-values.md).
- **A module that reaches the browser imports Supabase as a type only**, and takes its client as an argument.

### The write path

Every mutation is an [Astro Action](https://docs.astro.build/en/guides/actions/) in `src/actions/`, composed by `index.ts` — *add a namespace by adding a file, never by growing the index*. Handlers run on `ctx.locals.supabase`, the caller's cookie-session client, so **RLS is the trust boundary and an action is a validation layer, not a security one**.

**Every action's first line is `requireAdmin(ctx)`**, with exactly one exception — `contact.send`, the public form on /about. The older rule was narrower (guard only what touches no RLS-protected table: the AI parser, the Spotify lookup) and it did not survive a growing tree — by 2026-08-08 guarding followed module ancestry rather than policy, leaving 27 mutating handlers open. They were never *exploitable*, because RLS held; the problem is that **RLS refuses silently** — a non-admin's update matches zero rows, which is not an error, so the action answers `{ ok: true }` and the screen reports a save that never happened. `src/tests/actions-admin-guard.test.ts` holds the line, with a one-entry allowlist.

⚠ **One write is not in this layer at all.** Merging two subjects, authors or works is a plpgsql function called over `rpc` (`supabase/migrations/20260809013157_*.sql`), because a merge remaps several tables and then deletes a row — and a merge that fails halfway is worse than one that fails, since the FKs it leaves behind are `set null` and `cascade`. One function is one transaction; the actions in `vocabulary.ts` are only the door.

Client scripts (`src/scripts/`) are plain TypeScript modules imported by a page's `<script>` — no UI framework, no hydration. The DOM is the state: a selected segment lives in `aria-pressed`, a date lives in the date input, and there is no JavaScript copy of a form beside the form.

⚠ **On the client, an action THROWS on a dead network — it does not return `{ error }`.** The fetch underneath rejects, so a bare `await actions.x.y(…)` skips everything after it: the re-enable, the close, the sentence. `src/scripts/action-error.ts` is the single owner of that invariant and offers three things — `submitAction` (the whole disable → label → await → format → restore lifecycle, and the first choice), `callAction` (turns a throw into `{ error }` where the control is not one button), and `formatActionError` (one human sentence from either kind of failure; **never hand-roll `err instanceof Error ? err.message : …`**, because `TypeError` extends `Error` and that idiom prints `Failed to fetch` in exactly the case its friendly fallback was written for). `src/tests/action-guard.test.ts` holds the line: it fails on any new bare `await actions.` and carries an allowlist of the files whose throw is caught elsewhere.

## 7. The public surfaces, as built

- **The Sky** (`/`) — the constellation overview; `/{slug}` is one constellation as a typeset suite. Canonical and shareable: the zoom is navigation, and home *is* the overview (`design.md` §13).
- **The blog** (`/blog`) — writing by date, with quote and music indexes in their own view shapes, plus search and subject filters ([`search.md`](search.md)).
- **A single piece** (`/blog/[slug]`) — one `writing` fragment in the `.reading` type treatment (`app.css`). An unpublished one is visible to the admin behind a preview bar and 404s for everyone else.
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
    app.css                ← the law: theme, type, base — and it imports admin.css, LAST
    admin.css              ← component classes; NOT admin-only — 50 of them are public (the
                             Sky, the suites, the Reader, the feed cards), which is why it
                             is still in app.css while hq.css is not
    hq.css                 ← the Observatory's primitives (.zone, .row, .chip, .stamp, …).
                             56 KB, loaded by AdminLayout so it never reaches a reader
  layouts/                 ← Base · SiteLayout (public) · AdminLayout (the Observatory)
  components/              ← public primitives: PostCard, Reader, Timestamp, StarMark, …
    admin/                 ← private ones: Zone, PageHeader, the *Sheet dialogs, the *Zone cards
      checkin/             ← the Morning card's two heavy panels (DonePanel, FillPanel)
  lib/
    supabase.ts            ← the SERVER client factory only (@supabase/ssr, request-bound).
                             createBrowserClient is imported at its three call sites — auth.md §4
    database.types.ts      ← GENERATED from the live schema; never hand-edit
    blog.ts, media.ts, markdown.ts, fragment-query.ts, …   ← the corpus half
    hq/                    ← the private half: rules, then loaders (ADR 0016)
  actions/                 ← the one write path; index.ts only composes (ADR 0005)
  scripts/                 ← client-side modules, imported by a page's <script>
  pages/
    index.astro            ← the Sky (constellation overview)
    [slug].astro           ← one constellation
    blog/, about, constellations
                           reading, styleguide
                             ← benches: both 302 to / in production. They are
                               REFERENCES (a type specimen, the design system),
                               which is why they outlived the three `*-lab`
                               A/B benches — each of those answered one question
                               and was deleted 2026-08-10 once it had. What
                               afford-lab argued is now ADR 0022.
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
npm run dev              astro dev
npm run verify           format:check + lint + astro check + test   ← ~22s
npm run build            verify, THEN astro build — what Vercel runs
npm run build:unchecked  the build alone; local iteration only
npm run test             vitest (pure functions)
npm run test:e2e         Playwright — needs a dev server and a real admin session
npm run format           prettier across the tree
```

**`npm run verify` is the gate, and since 2026-08-09 it is one literally.** It is
the first thing `npm run build` runs, and Vercel's build command is
`npm run build` — so **a failing check fails the build and the deploy never
happens.** The last good deployment keeps serving. This is the difference between
a tripwire and a gate, and on a repo where *pushing `main` is a production
deploy* only the gate actually stops anything: a GitHub Action would report the
breakage while the broken version was already live.

- **Roughly 22s per deploy** — format:check 5.6s, lint 3.1s, astro check 12.4s,
  test 1.0s. The e2e suite is deliberately **not** in it: it needs a live session
  key and a running server, and a slow gate is a bypassed gate — the same
  reasoning that keeps the pre-commit hook to staged files only.
- **`build:unchecked` exists for local iteration** on `astro.config.mjs`'s
  `noExternal` and on `check-server-bundle.mjs`, where the checks are 22s of
  noise per attempt. ⚠ **Never point Vercel's Build Command at it.** That setting
  is currently unset, which is what makes `package.json` the one place the gate
  is described; overriding it would remove the gate silently, from a web form,
  with no diff.
- **The precedent is `scripts/check-server-bundle.mjs`**, chained into the same
  script since 2026-07-31 because a production 500 got past every local check.
  The gate is not new machinery here — it is that idea applied to `verify`.

### The Action is the belt; Vercel is the braces

⚠ **Since 2026-08-10 there is also a GitHub Action
([`.github/workflows/verify.yml`](../.github/workflows/verify.yml)), and it does
not contradict the paragraph above.** The argument there is that an Action must
not *be* the gate, and it stays true — the gate is `package.json`'s `build`, run
by Vercel, where a red check stops a deploy rather than reporting one. The
Action is additive, and it exists for the two things the gate leaves open:

- **A ✓ or ✗ on the commit.** The gate stops a bad deploy but leaves no mark in
  the history. Anyone reading this repository — including its author, six months
  from now — otherwise has no signal either way.
- **`npm audit --omit=dev` on the calendar and on lockfile changes** — Mondays,
  any pull request, and any push that moves `package-lock.json`. This is the
  half that earns its keep independently: on 2026-08-10 the tree carried seven
  advisories, five of them `astro-icon`'s transitive tail, which is not
  maintained on this repo's schedule and will regrow. It regrew on 2026-08-19.
  A schedule is how that surfaces without remembering to look. ⚠ A red audit is
  a prompt to redo the **reachability** work, not proof of exposure — five of
  those seven never entered the deployed function, and two shipped *bundled*,
  absent from the function's `node_modules` entirely. Grep the server chunk,
  not the folder.
- **⚠ Deliberately not on every commit, since 2026-08-19** — and until then it
  was, because this section said "scheduled" while the YAML gated nothing. That
  mismatch is what hid the cost. `npm audit` reads `package-lock.json`: it
  measures the dependency **tree**, not the commit, so between lockfile changes
  its answer cannot move. In the nine days after the Action landed there were
  157 pushes to `main` and 9 touched the lockfile — so one standing advisory was
  re-reported 148 times, as 148 identical failure mails. ⚠ Narrowing it to
  `pull_request` + `schedule` would have been the *wrong* fix: all 9 of those
  dependency changes arrived as direct pushes, because CLAUDE.md's rule is to commit
  straight to `main`, and Dependabot has yet to open anything. The push trigger
  is the one that matters here; it is the lockfile that filters it.

**The `verify` job runs `npm run verify`, not `npm run build`** — deliberately.
The build additionally runs `check-server-bundle.mjs`, which is only meaningful
against the artifact **Vercel** produces; running it on a different machine's
bundle would read as coverage it is not. Vercel owns that half, and this is the
same boundary `check-server-bundle.mjs`'s own `stopAt` exists to enforce.

⚠ **The e2e suite is not in CI and that is a decision.** It needs
`SUPABASE_SERVICE_ROLE_KEY` to mint an admin session, and adding that key to
GitHub Actions secrets widens where the service-role key lives, to buy something
a local run already gives. The same trade as the one that keeps the e2e suite
pointed at the live project rather than a database branch.

A pre-commit hook (husky + lint-staged) formats and lints *staged files only* —
deliberately not the test suite, for the reason above. Formatting is Prettier's
alone; ESLint carries no style rule.

⚠ **Green checks are necessary and nowhere near sufficient.** Twice, work has
shipped with a clean typecheck, a clean build and green unit tests and been
broken within ten minutes of a human using it. Anything whose behaviour depends
on state a compiler cannot see — network conditions, dialogs, sessions, the
authenticated admin — wants the e2e harness or a real look.

⚠ **`.git-blame-ignore-revs`** lists the whole-tree reformat of 2026-08-04.
Turn it on once per clone: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## 10. Environment & secrets

[`auth.md`](auth.md) §6 holds the full table — **ten variables in this app's env, plus three that belong to Supabase** because that is where the code holding them runs. In short: four `PUBLIC_*` keys are browser-safe and are inlined into the bundle at build time (Supabase URL + anon key, the Turnstile site key, the VAPID public key); six server-only ones are read at runtime through `getSecret()` so an unset key is a sentence rather than a 500; `SUPABASE_SERVICE_ROLE_KEY` is never imported into client code *or* into request-handling code. Google OAuth credentials live in the Supabase dashboard, not in env.
