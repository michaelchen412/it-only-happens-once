# Architecture

*How the site is assembled and rendered. Companion to [`data-model.md`](data-model.md) and [`auth.md`](auth.md). Decisions are recorded in [`adr/`](adr/).*

---

## 1. What the system is

One Astro application with two audiences:

- **The public site** — read-only, fast, cacheable. Currently: the **blog** (an index of writing, quotes, and music). Later: the **Sky** (constellation navigation) and **About**.
- **The admin** (`/admin`) — a private, auth-gated dashboard where Michael creates and edits content. Built **incrementally**.

Both are the same Astro app, sharing the design system and components. They differ in rendering mode and access.

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Astro 7** | `output: 'server'` (on-demand rendering) |
| Styling | **Tailwind 4 + daisyUI 5** | CSS-first; single source of truth in `src/styles/app.css` |
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

## 6. Incremental admin roadmap

The admin is built in shippable slices, not all at once. Full design in [`admin.md`](admin.md).

1. **Fragment list + quote/song quick-editors** — the unified list (filter/search/sort/bulk) plus the two light types. Songs auto-fill from a Spotify link (keyless oEmbed).
2. **Writing composer** — create / edit / publish a `writing` fragment: WYSIWYG-that-stores-Markdown, backdatable posted date, excerpt. This slice replaces Squarespace for posting *and* is the on-ramp for migrating the existing essays (§8).
3. **Subjects** — created inline (typeahead) in every editor from slice 1 onward; a management screen comes only if the tag set needs grooming.
4. **Constellations & placement** — create constellations, place fragments, order the suite (`position`). Deferred to ship *with the Sky*, where that UI belongs; the on-ramp toward the "synthesis instrument" in `vision.md`.
5. **Gathering aids** — further import helpers (Spotify Web API for artist/album, quote capture) to reduce context-switching.

Editing architecture (Astro Actions + Milkdown) is [ADR 0005](adr/0005-admin-editing-architecture.md).

## 7. Public build order (matches `vision.md`)

1. Schema + RLS live in Supabase; **migrate the existing Squarespace essays** in.
2. Public blog: writing-by-date list (the stream) + individual post pages (the `/reading` layout renders one `writing` fragment).
3. Quote and music indexes (their own view shapes — not infinite scroll).
4. Search + filters (the retrieval chrome).
5. Admin slices, per §6.

The **Sky** is a later, separate effort.

## 8. Migration

**Done (reflections).** The Squarespace WordPress-format export (`legacy/Squarespace-Wordpress-Export-07-18-2026.xml`, 523 posts across `/journal/`, `/reflections/`, `/for-someone/`) is the source. The **50 `/reflections/` essays** were imported via a one-off script ([`scripts/import-reflections.mjs`](../scripts/import-reflections.mjs), run with the service-role key): HTML→Markdown (turndown), authoritative dates from `wp:post_date`, the paired Spotify/YouTube embed captured into `details.media`, images dropped, published. Subjects came from an AI-proposed, human-reviewed taxonomy of 21 ([`scripts/reflections-subjects.json`](../scripts/reflections-subjects.json)). The script is idempotent (upsert by slug).

This **revised** the earlier "migrate through the composer" plan: once we knew the content was already clean Markdown at real volume (500+ posts, not ~12), a batch script was clearly right; the composer is for review/edits and new posts.

**Done (quotes).** The **72 quotes** in [`legacy/Quotes/*.md`](../legacy/Quotes/) (one `On X` file per theme, hand-written and inconsistently formatted) were imported via [`scripts/import-quotes.mjs`](../scripts/import-quotes.mjs) as published `quote` fragments. The parser normalizes the mess into a clean shape — em/en/bar-dash attributions, `**bold**` and curly-quote wrappers stripped, `#hashtag` sources (`#meditations` → Marcus Aurelius / *Meditations*) distinguished from `#hashtag` themes, and inline `(Book 2:2)` / `(34)` citations split into `details.citation` (chapter/verse/letter, text) vs `details.page` (bare number); duplicate quotes across folders merged. Per the quote-taxonomy decision, each quote carries **1–3 subjects reusing the existing 21** (no new subjects invented at import) — curated in [`scripts/quotes-subjects.json`](../scripts/quotes-subjects.json), keyed by body-slug — which naturally rebalances the folders' lopsided counts (the overloaded `On Self-Discipline…` scatters across `detachment`/`self-improvement`/`death`/…). Idempotent (upsert by slug).

**Deferred:** the `/journal/` (424 short dailies) and `/for-someone/` (49 personal letters) sections — each wants its own treatment/surface and privacy decision, not the essay feed.

## 9. Directory structure (target)

```
src/
  styles/app.css           ← single source of truth (theme, type, base)
  layouts/                 ← Base.astro, PostLayout, AdminLayout
  components/              ← FragmentCard, Timestamp, … (design-system primitives)
  lib/
    supabase.ts            ← client factories (browser / server session via @supabase/ssr)
    fragments.ts           ← typed queries
  pages/
    index.astro            ← home
    blog/                  ← the public blog (list + [slug])
    admin/                 ← auth-gated dashboard (prerender = false)
    auth/callback.astro    ← OAuth code exchange → session cookies
  middleware.ts            ← Supabase session refresh + /admin route protection
docs/                      ← this folder
supabase/
  migrations/              ← SQL migrations (schema + RLS)
astro.config.mjs           ← integrations: icon(); adapter: vercel; output: server; fonts
```

## 10. Environment & secrets

See [`auth.md`](auth.md) §Secrets for the full table. In short: `PUBLIC_*` keys are browser-safe (Supabase URL + anon key); `SUPABASE_SERVICE_ROLE_KEY` is server-only and never imported into client code. Google OAuth credentials live in the Supabase dashboard, not in env.
