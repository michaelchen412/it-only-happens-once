# 0006 — Composer editor: TipTap (supersedes the Milkdown choice in ADR-0005)

Status: Accepted
Date: 2026-07-18

Supersedes the **editor** decision in [ADR 0005](0005-admin-editing-architecture.md). The rest of 0005 (Astro Actions as the mutation layer; a WYSIWYG that stores Markdown) still stands.

## Context

ADR 0005 chose **Milkdown (Crepe)** for the writing composer. In use it presented a Notion-style floating/slash UI that felt unfamiliar and "weird" for long-form drafting. The requirement, stated plainly: the **most robust, most widely adopted** rich-text editor, with a **fixed, Google-Docs-style toolbar** and as refined an editing experience as possible — while still honoring the Markdown storage contract ([ADR 0003](0003-fragments-single-table.md), [data-model.md](../data-model.md) §4).

## Decision

Use **TipTap v3** (the ProseMirror-based editor behind Notion, Linear, GitLab — the most widely adopted headless editor) for the composer:

- **`@tiptap/starter-kit`** for the standard marks/nodes (headings, bold/italic/strike, lists, blockquote, link, code, hr, history).
- **`tiptap-markdown`** so the editor parses Markdown in and serializes Markdown out (`editor.storage.markdown.getMarkdown()`). **`body` stays Markdown** — the contract holds.
- **A custom fixed toolbar** we own (undo/redo · H2/H3 · B/I/S · quote/lists · link/divider), styled on our tokens, with active-state highlighting — the Google-Docs bar, not a floating menu.
- **The editor surface wears the `.reading` class**, so what you type looks like the published article (same typography, same measure). The editing surface and the reading page share one source of truth.

Milkdown/Crepe is removed.

## Consequences

- **Widest ecosystem + robustness.** ProseMirror is the industry-standard document model; TipTap is its most adopted framework. Extensions, docs, and longevity are the best available.
- **Familiar, fixed toolbar.** Matches the Google-Docs mental model Michael asked for; no floating surprises.
- **Markdown preserved.** Because storage stays Markdown, the editor is swappable later at low cost — we are not married to TipTap's internal model.
- **A community dependency.** `tiptap-markdown` is community-maintained (peer `@tiptap/core ^3`). Risk is bounded: it only touches serialization, and `body` remains portable Markdown if we ever replace it.
- **Client bundle.** ProseMirror ships only on the composer route (admin-only, never on public pages) — the same tradeoff 0005 already accepted.

## Alternatives

- **Keep Milkdown/Crepe.** Rejected — less widely adopted, and its editing UX is the thing we're moving away from.
- **TipTap storing HTML/JSON (its default).** Rejected — breaks the Markdown contract ([ADR 0003](0003-fragments-single-table.md)) and splits stored-vs-rendered. `tiptap-markdown` gives the same UX without that cost.
- **Lexical (Meta).** Capable and modern, but a smaller ecosystem than ProseMirror and less mature Markdown tooling for our needs. Rejected.
- **Raw Markdown textarea + preview.** Rejected earlier in 0005 — Michael wants a true WYSIWYG surface.
