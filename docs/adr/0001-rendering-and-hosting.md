# 0001 — Rendering & hosting strategy

Status: Accepted
Date: 2026-07-18

## Context

The site has two very different surfaces: a **public** content site that should be fast, cheap, and age well through long dormant periods (see `about-michael.md` — the author goes dark for stretches), and a **private admin** where content is created and edited. Content lives in a database (Supabase, [ADR 0004](0004-supabase-over-content-collections.md)) and changes through the admin, not through code commits. Auth is Supabase Auth ([ADR 0002](0002-authentication-provider.md)), run server-side via cookie sessions (`@supabase/ssr`). Between DB-backed content and an auth-gated admin, the app must be server-capable regardless of other choices.

## Decision

- **`output: 'server'`** with the **Vercel adapter**.
- **Public pages: server-rendered from Supabase, cached at the edge** (Cache-Control / on-demand revalidation / ISR). Cache hits are effectively static; publishing revalidates.
- **Genuinely static pages** (e.g. About) opt into `export const prerender = true`.
- **Admin (`/admin`): `prerender = false`, auth-gated** via middleware.
- **Host on Vercel** for first-class Astro + on-demand revalidation ergonomics.

## Consequences

- Content edited in the admin appears without any manual rebuild step — lowest operational friction for a solo author.
- Cache hits give near-static performance and cost; the origin is hit only on miss/revalidate.
- We depend on a server runtime and on Vercel's caching model; a wholly static export is no longer possible (acceptable — the DB-backed, auth-gated design already precluded it).
- We must be deliberate about cache keys and revalidation so published changes surface promptly.

## Alternatives

- **Pure SSG + rebuild-on-publish (Supabase webhook → deploy hook).** Max raw performance and a static artifact, but every publish triggers a rebuild, adding latency and a moving part. The auth-gated admin already requires a server runtime, undercutting the "fully static" appeal. Rejected for friction.
- **SSR with no caching.** Simplest mentally, but pays origin + DB cost on every request and is slower. Rejected — caching is cheap insurance.
- **`@astrojs/node` self-hosted.** Viable and adapter-swappable later, but we'd hand-roll the CDN/ISR layer Vercel gives for free. Rejected for now; the adapter is a one-line change if we move.
