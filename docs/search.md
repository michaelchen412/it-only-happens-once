# Search & highlighting

*How fragment search and match-highlighting work, and the decisions/lessons behind them. The engine lives in [`../src/lib/search-highlight.ts`](../src/lib/search-highlight.ts); the admin Fragment Manager is its first consumer ([`admin.md`](admin.md) §2). **This document exists so the public blog can replicate the same behaviour without re-learning the pitfalls.***

---

## 1. What search does today

The admin list search is a **literal, case-insensitive substring match** — the same match the DB `ilike '%term%'` performs — surfaced two ways:

1. **Filter** — the server narrows the fragment list to rows whose title/attribution/body contain the term.
2. **Highlight** — matches are wrapped in `<mark class="hl">` in the title and attribution, and for `writing` fragments the body is shown as **windowed excerpts** around each match (option #2: *all* matches shown, each in its own context window).

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

A one-character term matches nearly everything and is never a useful query. Below `MIN_SEARCH` the term is **ignored entirely** — no filter, no highlight, the full list shows. Enforced in three places, all reading the one constant:

- **Server** ([`admin/index.astro`](../src/pages/admin/index.astro)): `const searching = q.length >= MIN_SEARCH` gates both the `ilike` filter and whether `searchTerm` is passed to rows.
- **Client** ([`admin-list.ts`](../src/scripts/admin-list.ts)): the debounce compares an *effective* query (`raw.length >= MIN_SEARCH ? raw : ''`) against `lastSearch` and skips the fetch when unchanged — so typing/clearing a single letter fires **no** request.
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

## 6. Porting to the public frontend — checklist

The engine (`search-highlight.ts`) and `Highlighted.astro` are **presentation-agnostic and reusable as-is**. When building public search:

- [ ] Reuse `search-highlight.ts` unchanged — do not fork the matching logic.
- [ ] Keep the **segments-as-data** rendering boundary (§2). Never build `<mark>` via string replace.
- [ ] Respect `MIN_SEARCH` on both server and any client debounce (§3).
- [ ] Always call `excerpts()` (bounded) for long bodies — never `highlight()` on a full essay body (§4).
- [ ] Run `toPlain()` before excerpting Markdown bodies so `#`, `*`, links etc. don't leak into snippets.
- [ ] If the public corpus is large, reconsider `ilike` vs Postgres FTS (§5) — but keep highlighting literal so client and server agree on what "matched".
- [ ] Add/keep the density unit test (100 matches → 8 shown) as a regression guard.
