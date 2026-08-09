# Search & highlighting

*How fragment search and match-highlighting work, and the decisions/lessons behind them. The engine lives in [`../src/lib/search-highlight.ts`](../src/lib/search-highlight.ts) and has **two live consumers** — the admin Fragment Manager ([`admin.md`](admin.md) §2) and the public blog. This document is why they behave identically instead of by coincidence.*

---

## 1. What search does today, on both surfaces

Search is a **literal, case-insensitive substring match** — the same match the DB `ilike '%term%'` performs — surfaced two ways:

1. **Filter** — the server narrows the list to rows containing the term.
2. **Highlight** — matches are wrapped in `<mark class="hl">` in the title and attribution, and for `writing` fragments the body is shown as **windowed excerpts** around each match (option #2: *all* matches shown, each in its own context window).

**Two consumers, one engine.** They differ only in which columns they may search, and that difference is the RLS boundary rather than a design choice:

| | Where | Columns searched |
|---|---|---|
| **The Fragment Manager** | [`fragment-query.ts`](../src/lib/fragment-query.ts) (server) + [`fragment-panel.ts`](../src/scripts/fragment-panel.ts) (client) | `title`, `body`, `attribution` **and `excerpt`** — the admin sees every field it stores |
| **The public blog** | [`blog.ts`](../src/lib/blog.ts) (server) + [`blog-feed.ts`](../src/scripts/blog-feed.ts) (client) | writing: `title` + `body`; quotes: `body` + `attribution`. No `excerpt`: a card blurb is a *rendering*, and a hit in one the reader never sees reads as a false positive |

⚠ **The public half shipped on 2026-08-05 and this file described it as future work until 2026-08-09** — §6 below still opened *"when building public search"* after it had been built. The two live consumers are the reason the checklist there is now a contract rather than a plan.

There is **no ranking, stemming, or fuzzy matching** yet. This is deliberate — see §5.

## 2. Architecture: segments as data, not HTML strings

The engine never emits HTML. It returns **segment arrays** (`Seg[] = { text, hit }[]`) and the `.astro` component ([`Highlighted.astro`](../src/components/admin/Highlighted.astro)) renders them, so Astro auto-escapes every text node and the only real markup inserted is `<mark>`. **This is the XSS boundary** — user/DB text is never interpolated into an HTML string. Any public reimplementation MUST keep this shape; do not "optimize" it into a `.replace(term, '<mark>…')` string builder.

Key exports (`search-highlight.ts`):

| Export | Purpose |
| --- | --- |
| `MIN_SEARCH` | Minimum term length before search activates (see §3). Shared by server + client so they never disagree. |
| `highlight(text, term)` | Inline highlight of a short field (title, attribution) — every match. |
| `excerpts(text, term, ctx, maxHits)` | Windowed, **bounded** excerpts for long bodies (see §4). |
| `toPlain(md)` | Strips Markdown → readable text before excerpting. |
| `hasMatch(text, term)` | Boolean match test. |

`ranges()` uses `indexOf` in a loop (not `RegExp`), so the term needs **no regex escaping** — a search for `c++` or `(34)` just works. This is a correctness lesson, not a micro-opt: the moment you build a `RegExp` from user input you inherit escaping bugs and ReDoS risk.

## 3. Minimum search length (`MIN_SEARCH = 2`)

A one-character term matches nearly everything and is never a useful query. Below `MIN_SEARCH` the term is **ignored entirely** — no filter, no highlight, the full list shows. Enforced at every layer of **both** consumers, all reading the one constant:

- **Server, admin** — [`fragment-query.ts:68`](../src/lib/fragment-query.ts): `searching: q.length >= MIN_SEARCH` gates both the `ilike` filter and whether `searchTerm` is passed to rows. *(It lived in `admin/index.astro` until 2026-08-02, when that route became Today; the query moved to a module because the composer's browser sheet needed the same one.)*
- **Server, public** — [`blog/index.astro:42`](../src/pages/blog/index.astro): the same line, with the same comment pointing back here.
- **Client, admin** — [`fragment-panel.ts:173`](../src/scripts/fragment-panel.ts): the debounce compares an *effective* query (`raw.length >= MIN_SEARCH ? raw : ''`) against `lastSearch` and skips the fetch when unchanged — so typing/clearing a single letter fires **no** request. *(Was `admin-list.ts`, which is now only the page-specific half: bulk bar, trash, the Add ▾ menu.)*
- **Client, public** — [`blog-feed.ts`](../src/scripts/blog-feed.ts): the same comparison against `lastEffective`, plus the token guard that stops a stale response clobbering a newer one.
- **URL hygiene**: `params.delete('q')` when below min, so a stray short `q` never lands in the address bar or history.

> Lesson: gate the term in one place conceptually (a shared constant) but enforce at *every* layer. If only the server gates, the client still round-trips on every keystroke; if only the client gates, a hand-typed URL bypasses it.

## 4. The performance trap (and the real fix)

**Symptom:** typing a broad term like `h`, or clearing a term that had matched everything, caused *extreme* lag; a real word felt instant.

**Cause:** highlighting is O(matches), not O(rows). `h` matches hundreds of times *per essay* across dozens of essays → thousands of `<mark>` nodes to build and then tear down on the next keystroke. Narrow terms were fine only because they had few matches.

**Two-part fix:**
1. `MIN_SEARCH` kills the single-letter case outright (§3).
2. `excerpts()` **caps the number of highlighted matches per field at `maxHits` (default 8)** and returns `{ windows, more }`, where `more` is the count of un-shown matches. The row renders a `+N more matches` line instead of N more `<mark>`s.

> **The subtle part — why capping *windows* was not enough.** The first attempt bounded the number of context *windows*. It failed: when matches are dense (every few characters), all their windows overlap and **merge into one giant window** containing hundreds of marks. The count that actually bounds the DOM is the number of **highlights**, not windows. Cap the hits, then build windows from the capped set.

Verified with a unit test: a body containing 100 matches renders exactly 8 highlights + `more: 92`. Any reimplementation should keep a test like this — the failure mode is invisible until the data is dense.

`excerpts()` also: snaps window edges to word boundaries (`ctx` chars each side, max 12-char nudge), merges overlapping windows, and reports `lead`/`trail` flags so the component can render `…` ellipses only where text was actually clipped.

## 5. Deliberate non-goals (for now)

- **No ranking / relevance sort** — results keep the list's normal order (drafts pinned, then the active sort column). Fine for an admin tool over dozens of rows.
- **No stemming / fuzzy / synonyms** — literal substring only. Predictable and escaping-free.
- **No Postgres FTS / `tsvector`** — `ilike` is sufficient at this scale and keeps the same match semantics on client and server. Revisit if the public corpus (500+ posts) makes `ilike` scans slow.

## 6. The contract a third consumer inherits

The engine (`search-highlight.ts`) and `Highlighted.astro` are **presentation-agnostic**, and the public blog took them as-is rather than forking — which is the only reason a term typed into the workshop and the same term typed into `/blog` mean the same thing. Every line below is a rule the second consumer already keeps, so it reads as a checklist and is really a description:

- [x] **Reuse `search-highlight.ts` unchanged** — the matching logic is not forked, and there is no second `ranges()` anywhere.
- [x] **Keep the segments-as-data boundary** (§2). Neither surface builds `<mark>` by string replace; both render `Seg[]` through the component.
- [x] **Respect `MIN_SEARCH` on server *and* client debounce** (§3) — four enforcement sites, one constant.
- [x] **Always `excerpts()` (bounded) for long bodies**, never `highlight()` on a full essay.
- [x] **Run `toPlain()` before excerpting Markdown** so `#`, `*` and link syntax don't leak into snippets.
- [x] **Keep the density unit test** (100 matches → 8 shown) as the regression guard — the failure mode is invisible until the data is dense.
- [ ] **Postgres FTS** stays deferred (§5). If the corpus grows enough to make `ilike` scans slow, keep highlighting literal anyway, or client and server stop agreeing about what "matched".

⚠ **The one thing a new consumer must decide for itself is which columns it may search**, because that is a privacy question and not a search question — see the table in §1. The public feed searches fewer columns than the manager, and it is not an oversight.
