# 0005 — Admin editing architecture: Astro Actions + a Markdown-storing WYSIWYG

Status: Accepted — the specific editor (Milkdown) is superseded by [ADR 0006](0006-composer-editor-tiptap.md); Astro Actions and the Markdown-storage principle still stand.
Date: 2026-07-18

## Context

The admin ([`../admin.md`](../admin.md)) needs to create and edit fragments — write, quote, song — behind auth, writing to Supabase under RLS. Two architecturally significant choices had to be settled before building, because both are costly to reverse once content exists in the chosen shape:

1. **How mutations reach the database.** Astro 7 (`output: 'server'`) offers several paths: hand-rolled API routes (`src/pages/api/*`), raw `<form>` POSTs handled per-page, or **Astro Actions** (`defineAction` — typed server functions with Zod input, callable from forms or client JS).
2. **How long-form is authored and stored.** `fragments.body` is contractually **Markdown** ([`../data-model.md`](../data-model.md) §4, [ADR 0003](0003-fragments-single-table.md)). Michael chose a **WYSIWYG** editing experience over a raw-Markdown-with-preview one. But a typical WYSIWYG (e.g. Tiptap's default) persists **HTML** — which would silently break the Markdown contract and split what the published `.reading` page renders from what is stored.

## Decision

**1. Astro Actions are the single mutation layer.** All create/update/delete/bulk operations live in `src/actions/` as `defineAction` handlers with Zod-validated input. They run on the server and use the request-bound session client (`context.locals.supabase`, `@supabase/ssr`) — **never** the service-role key. Authorization is therefore the same as everywhere else: Michael's cookie session, re-checked by `is_admin()` in RLS. The action is a convenience and validation layer, **not** a trust boundary.

**2. The writing editor is WYSIWYG but stores Markdown.** We use **Milkdown (Crepe)** — a ProseMirror + remark editor that parses Markdown in and serializes Markdown out (`getMarkdown()`). The stored `body` stays portable Markdown; the published page renders that same Markdown; there is no HTML/Markdown divergence. Bonus: ProseMirror ingests pasted HTML, so migrating the Squarespace essays is a paste that converts to Markdown in place.

## Consequences

- **Type-safety end to end.** Supabase generates DB types; Zod guards runtime input at the action boundary; Actions give the client typed `data`/`error` returns and `isInputError` field errors. Progressive enhancement comes free — forms work as plain POSTs, then upgrade with JS.
- **RLS stays the only gate.** Because actions use the session client, no new trust surface is introduced. A bug that reaches an action still cannot write without the admin JWT claim. This is the property we most wanted to preserve.
- **The Markdown contract holds.** `body` is portable and renderer-agnostic; we could swap the editor later without migrating stored content. We accept a heavier client bundle on the composer route (ProseMirror) — acceptable because it loads only in the admin, never on public pages.
- **We depend on Crepe's opinionated surface.** Its theme is themed toward our tokens rather than being pixel-identical to `.reading`. Accepted: the workshop optimizes for speed, and the *published* page is the source of reading truth.

## Alternatives

- **Hand-rolled API routes.** More boilerplate, manual validation, no typed client, no free progressive enhancement. Rejected — Actions are the idiomatic Astro path and give more for less.
- **Raw Markdown textarea + live preview.** Lightest, fully controllable, `.reading`-accurate preview. Rejected because Michael chose WYSIWYG; the Markdown-storing editor delivers that without giving up the Markdown contract.
- **Tiptap (or any HTML-persisting WYSIWYG).** Familiar and capable, but stores HTML — breaks [ADR 0003](0003-fragments-single-table.md)'s Markdown contract and splits stored-vs-rendered. Rejected. (A Tiptap + markdown-serializer setup was possible but is strictly more work than a Markdown-native editor.)
- **Service-role writes from a trusted admin server.** Would bypass RLS and make the app itself the trust boundary. Rejected — it throws away defense-in-depth for no gain on a single-admin site.
