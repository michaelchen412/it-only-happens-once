# The admin

*The private workshop where Michael creates and edits content. Companion to [`architecture.md`](architecture.md) (rendering/data flow), [`data-model.md`](data-model.md) (the fragment schema), and [`auth.md`](auth.md) (who gets in). The editing-architecture decision is recorded in [ADR 0005](adr/0005-admin-editing-architecture.md).*

---

## 1. The third room

`design.md` names two registers: the **Sky** (evocative, curated, near-chromeless) and the **Index** (utilitarian retrieval — search, filters, pills). The admin is **neither**. It is a *third room*: a private workshop seen by no one but Michael, gated to a single account ([`auth.md`](auth.md)).

So its rule is different. It uses the same design tokens — the `dusk` theme, Atkinson for chrome, Newsreader on the actual writing surface so drafting *feels* like the published essay — but otherwise **optimizes for speed and density over poetry**. We deliberately do not over-invest in visual polish for a room only one person enters. Warmth here is expressed as *low friction*: paste a link and the fields fill; type a title and the slug follows; one keystroke publishes.

Everything under `/admin` is `prerender = false` and auth-gated by [`middleware.ts`](../src/middleware.ts) (must be the admin role). Nothing here is ever cached or public.

## 2. Surfaces

Everything the admin does maps to a small set of screens. The plumbing depth differs by type — that gradient is the whole reason for the shape in §3.

| Surface | Route | What it is |
|---|---|---|
| **Fragment list** | `/admin` | The Fragment Manager: a flat, **sortable table** over all fragments (Type · Title · Status · Posted · Edited; click Title/Posted/Edited to sort). The Title column absorbs all slack (`w-full`); date/status stay content-width. **Writing/song** show a one-line truncated title; **quotes** have no title, so the quote *text* fills that column (italic, clamped to 3 lines — short quotes in full, long ones clipped) with a citation line beneath — `— Author, Work`. **Drafts are always pinned to the top.** A segmented **type filter with live counts** (All · writing · quote · song) + subject filter + [**search with match-highlighting**](search.md); whole-row click opens the editor; shift-click range-selects; bulk actions; an **Add ▾** menu; a Trash button. Filtering/sorting swap the table in place (no reload). *(Posted = `occurred_at`, the public date; the separate `published_at` audit timestamp isn't shown — for a normal post it equals Posted.)* |
| **Trash** | `/admin?view=trash` | Soft-deleted fragments — restore, delete-forever, or empty. Delete is a *soft* delete (`deleted_at`); nothing is hard-deleted until explicitly purged. |
| **Quote quick-editor** | slide-over, any admin page | **Quote** (a minimal TipTap editor → Markdown, `breaks:true` so poetry survives) and **attribution** are required (marked, and they gate Save). Optional source metadata (title/author/work-year/page/citation/link) is tucked in a collapsible group. Subjects, with **✦ Suggest with AI** (Claude Haiku 4.5 reads the quote and pre-fills subjects — see §8). Date is **automatic** (now) unless "Set a specific date" is toggled to backdate a legacy quote — same convention as the writing sheet. **Quotes publish on save** — no draft picker (a quote has no draft lifecycle); unpublish via the list's bulk actions. |
| **Song quick-editor** | slide-over, any admin page | Light: paste a Spotify link → title/art/embed auto-fill; artist/album/year, subjects. **Publishes on save** (like quotes); unpublish via the list. |
| **Writing sheet** | near-fullscreen slide-over | Deep: title, auto-slug, WYSIWYG Markdown body, excerpt, backdatable posted date, subjects, draft↔publish (§5). An overlay like the quick-editors, just wide — the old standalone page `/admin/writing/[id]` is **retired** and 302s to `/admin#edit=<id>` / `#new-writing`, which auto-open the sheet. |
| **Constellations index** | `/admin/constellations` | Every constellation, draft + published: create (a "pile" is just a draft), publish/unpublish, reorder the sky's authored order, delete (placements cascade; fragments untouched). |
| **The composer** | `/admin/constellations/[id]` | The composing room (design.md §13): the suite in two views over one sequence — **Compose** (dense rows; drag or Alt+↑/↓ to reorder, ✕ unplaces) and **Read** (the public stanzas verbatim, drafts included) — plus the constellation's name/slug/colour/status/description/score, the three tests as quiet gauges, Preview → the real public page (drafts render for the admin only). One **Add** button opens the fragment browser. |
| **Fragment browser** | large slide-over on the composer | A mini Fragment Manager: the *same* toolbar + table as `/admin` (served by the `/admin/fragments-panel` partial in `mode=pick`). Rows already in this constellation render **dimmed and unselectable**; everything else places via a per-row ＋ or checkbox-select + "Place N". Its own Add ▾ creates fragments that auto-place (`body[data-place-in]`). Closing after any placement refreshes the suite. |

**The fragment → constellation view** (added 2026-07-24). The composer answers *what is in this constellation*; these answer *where does this fragment live* — the same join read from the other end:

- **A Constellations column** in the shared table (so it appears in the manager *and* the browser sheet): a filled ✦ chip per constellation, or a dashed **none** chip. The two treatments are deliberately different shapes, not just different text, so a column of orphans reads as absence while scanning. Hidden below `lg`.
- **A membership filter** (`?in=<slug>`, or `?in=none`). Note `in` is deliberately distinct from the `constellation` param, which only *marks* rows in pick mode. Empty is a meaningful value in this corner of the app: Astro turns a blank form field into `null`, so the membership action coerces it back (`idList`) — a bare `z.string()` rejected the exact case that means "belongs to none". The orphan view is the point: at the time of writing, 85 of 124 fragments belonged to no constellation, and nothing in the workshop could surface them.
- **A picker in each editor** ([ConstellationPicker](../src/components/admin/ConstellationPicker.astro)) — a checkbox list of the whole sky, living in its own **tab** (`Quote|Song` / `Document` beside `Constellations`, with a live count). It's a tab rather than a field or a popover because membership is a peer of the content, not chrome hanging off it — and because a draft essay never opens the publish dialog, so that was never a home for it. Each row shows the constellation's **full description** (four-line cap for a runaway one): you're deciding where a piece belongs, and a truncated opening clause just makes you hover to finish the thought. A filter field appears past eight constellations; there's no inner scrollbox, since the sheet already scrolls.
- **A toggle applies immediately** — membership is a relationship, not a field on the fragment, so it needs no save and is instantly reversible. Two consequences worth knowing: membership events are excluded from both sheets' dirty guards (otherwise closing warns about "unsaved edits" that were already written, and the writing sheet kicks off a spurious autosave), and a fragment that doesn't exist yet queues its ticks and flushes them the moment the first save mints an id — which *replaces* the old implicit `data-place-in` behavior with a pre-ticked box you can see and untick.
- The same full-description treatment appears in the bulk menu, and the browser sheet's header names the constellation you're composing into. **Everywhere a fragment can be assigned, you can read what you're assigning it to.**
- **Bulk elevate** from the selection bar. "Remove from" lists only constellations the selection actually belongs to, read off each row's `data-constellations`.

Adding from this side **appends** to the end of that suite — composed order stays the constellation's business (recompose in the composer).

**Constellation colour** (2026-07-24). Each constellation owns a hue from the sky's ramp (design.md §13); the composer picks it as a row of ✦ swatches, and a new constellation auto-takes the least-used slot. It tints the membership chips and the index's stars, which is the point: you can tell where a fragment lives without reading. The DB stores a slot NAME only — `app.css` owns the value, per theme. Consequently **TypeMark is no longer colour-coded**: the glyph shape already carried type, and two colour languages on one row read as noise.

**Back to top, in the thing that scrolls.** Long surfaces get a floating return control ([BackToTop](../src/components/BackToTop.astro)): the manager and Library via `AdminLayout`, and — because these scroll *inside* a container where window scroll never fires — the browser sheet, both editor sheets, and the public Reader, each naming its own scroller. Mounted inside a dialog it positions absolutely, so it rides the sheet's corner (above the browser's bulk bar) instead of the viewport's.

**Shared chrome.** The pieces every surface repeats have exactly one implementation: [`PageHeader`](../src/components/admin/PageHeader.astro) (back link + title + right-aligned actions + one-line explanation), [`TypeMark`](../src/components/admin/TypeMark.astro) (the ▤ ” ♪ mark in its type color, from `TYPE_META`), [`TypeCount`](../src/components/admin/TypeCount.astro) ("▤ 5 writing" badges), [`StatusChip`](../src/components/admin/StatusChip.astro), and the `.admin-*` utilities in `app.css` (`admin-alert`, `admin-label`, `admin-hint`, `admin-back`, `admin-stat`, `admin-chip`). Added 2026-07-23 after four pages had each hand-rolled their own chips, labels, and error banners — and drifted apart. **Type color is not decoration**: it's the same coding the public site uses (design.md §7), so a quote reads as a quote in the manager, the composer, and the browser alike. Navigation is never deeper than one level, so surfaces get a **back link, not a breadcrumb trail**.

**Every fragment edits in an overlay** — clicking a row anywhere (manager, browser, suite) opens the matching sheet; the page underneath never navigates away. One table implementation serves both the page and the browser: `FragmentListPanel` (class-scoped, wired per-instance by `fragment-panel.ts`) rendered by `/admin` directly and by the **`/admin/fragments-panel` partial** for in-place refreshes and the browser (auth-gated by the same middleware).

## 3. The shape decisions

The first four were made together with Michael on 2026-07-18. The architecturally significant two (mutations, editor) are in [ADR 0005](adr/0005-admin-editing-architecture.md).

1. **List + quick-editors + full composer.** One unified list is the spine (cross-type view, bulk actions live in one place). Light types (quote/song) edit in a slide-over so they stay fast; writing gets a dedicated page. This mirrors the plumbing gradient rather than fighting it.
2. **WYSIWYG that stores Markdown.** The writing editor is a true WYSIWYG surface, but the file it writes is **Markdown** — because `fragments.body` is contractually Markdown ([data-model.md](data-model.md) §4, [ADR 0003](adr/0003-fragments-single-table.md)). The editor is **TipTap** (ProseMirror) with `tiptap-markdown` for Markdown in/out and a fixed, Google-Docs-style toolbar. See [ADR 0006](adr/0006-composer-editor-tiptap.md) (which superseded the original Milkdown pick in [ADR 0005](adr/0005-admin-editing-architecture.md)).
3. **Songs auto-fetch from the Spotify link.** Paste a URL; we call Spotify's keyless **oEmbed** to fill the title, artwork, and embed, and parse the track id from the URL. See §6 for exactly what auto-fills and what stays manual.
4. **Constellation placement is deferred to the Sky phase.** Admin v1 is fragments + subjects + full CRUD/bulk. Placing fragments into constellations with composed order ([data-model.md](data-model.md) §4, `fragment_constellations.position`) ships alongside the Sky, where that UI belongs. This keeps the phase focused on getting content *in*.
5. **Quotes & songs publish on save; only writing has a draft lifecycle** (added 2026-07-20). A quote or song is a short, finished thing — a draft-then-publish cycle is pointless friction — so their quick-editors have no status picker and save straight to `published`. The `status` column stays (it's the public-visibility gate, and the list's bulk publish/unpublish still uses it); edits preserve the current state, so a deliberately-unpublished fragment isn't force-republished. Writing keeps drafts/autosave (§5), because essays genuinely evolve over time.
6. **Everything edits in an overlay; the writing page is retired** (2026-07-23, Michael's call). The original split — quotes/songs in a sheet, writing on its own page — broke context: clicking an essay while composing a constellation threw you out of the room. Now writing opens in a near-fullscreen sheet everywhere (with `#edit=<id>` in the hash so a refresh reopens it), and the composer adds fragments through a browser sheet that IS the Fragment Manager in miniature — one shared table implementation, not a parallel "shelf". The cost accepted knowingly: no more middle-click-to-new-tab on writing rows.
7. **The composer reads in the public's own register** (2026-07-25, Michael's call). A suite composed against 110-character snips can't be judged — you're sequencing database rows, not writing. So the suite gained a **Read** view beside Compose: the stanzas from [`SuiteStanza.astro`](../src/components/SuiteStanza.astro), shared *verbatim* with the public sky (§2.3 of design.md — the pattern became a primitive rather than a second copy), quotes whole, essays opening the blog's own Reader. It includes **drafts**, which the public page structurally can't — `getConstellation` stays published-only, so the composer builds its own items from the admin query. It deliberately stops at the content: no arcs, lamplight or score. **Read asks "is this composition any good?"; Preview asks "does the page look right?"** — two questions, two surfaces. In the same pass the row-nudge arrows became touch-only (`@media (hover: hover)` removes them): with a pointer you drag and with a keyboard you Alt+↑/↓, so on desktop they only reserved row width for a duplicate of drag.

## 4. How writes happen (mutation architecture)

All mutations go through **Astro Actions** (`src/actions/`) — type-safe server functions with Zod validation, callable from a `<form>` (progressive enhancement) or from client JS. Not hand-rolled API routes. See [ADR 0005](adr/0005-admin-editing-architecture.md).

The security chain is unchanged from [`architecture.md`](architecture.md) §4 and rests entirely on RLS:

```
form / JS ──▶ Astro Action (server) ──▶ context.locals.supabase  (user session, @supabase/ssr)
                                          │
                                          ▼
                          Supabase  ──  RLS: is_admin() gates every INSERT/UPDATE/DELETE
```

- Actions use the **request-bound session client** (`Astro.locals.supabase`, set by middleware) — never the service-role key. So every write is authorized by Michael's cookie session and re-checked by `is_admin()` in Postgres. An action is not a trust boundary; RLS is. Even a bug that let a request reach an action cannot write unless the JWT carries `app_metadata.role = 'admin'`.
- Actions **validate input with Zod** at the boundary (the other half of type-safety, since the DB types can't guard runtime shape).
- Redirect-after-write: on success an action redirects back to the list (or stays on the composer), so a refresh never re-submits.

## 5. The writing sheet

The deep end. A near-fullscreen `<dialog>` drawer ([`WritingSheet`](../src/components/admin/WritingSheet.astro)): command bar, fixed formatting toolbar, then the document (title + body) centered. No sidebar of metadata fields; the "last-mile" details live in the publish dialog (below). It opens from any writing row (`writing:edit` event), any `[data-new-writing]` button, or the `#edit=<id>` / `#new-writing` hash — the retired `/admin/writing/[id]` route 302s to the latter, so old links still land in the editor. While open the hash mirrors the document (refresh-safe); on close the previous hash is restored and, if anything was saved, the page reloads so lists/suites reflect it. Closing a draft flushes the pending autosave first; closing a published piece with unsaved edits asks before discarding.

- **Editor:** **TipTap** (ProseMirror) + `tiptap-markdown`, with a fixed Google-Docs-style toolbar we own (undo/redo · H2/H3 · bold/italic/strike · quote/lists · link/divider), active-state highlighted. **Markdown is the stored value** (`editor.storage.markdown.getMarkdown()` → the `body` field). The editor surface wears the `.reading` class, so drafting looks like the published article. See [ADR 0006](adr/0006-composer-editor-tiptap.md).
- **Paste-from-HTML migration path.** ProseMirror ingests pasted HTML natively, so pasting a Squarespace essay converts it to clean Markdown in place. This is how the existing back catalog of essays comes in — through the composer, from real use, **not** a scraper ([architecture.md](architecture.md) §8).
- **Drafts autosave; published posts don't.** While a piece is a **draft**, the working copy autosaves ~1.2s after you stop typing (debounced, in-flight-guarded), **even when untitled** (title/body are optional for a draft; both are required only to *publish*). The first autosave inserts the row and captures its id (hash → `#edit=<id>`); in a composer context (`body[data-place-in]`) that first save also places the piece into the constellation being composed. Indicator: **spinner → "Saved 3:45 PM."**
- **Once published, editing is deliberate.** A published post does **not** autosave — edits accumulate, the bar shows **"Unsaved changes,"** and you push them with an explicit **Save changes** (or bail with **Discard**). So fixing a typo on a live post is a conscious act, never a silent live edit — and you never have to unpublish first. Autosave resumes if you Unpublish back to draft.
- **Publishing is a deliberate act behind a dialog.** The primary bar button is **Publish…**, which opens a dialog that collects the last-mile metadata *and* confirms: **slug** (auto-from-title, editable), **excerpt** (optional; card blurb, else derived — [data-model.md](data-model.md) §6), **subjects** (the [TagInput](../src/components/TagInput.astro) chip field), and the **posted date** (§ below). Confirming publishes (stamps `published_at`, first time only). A published piece instead shows **Unpublish** (→ back to draft, keeping `published_at`) and **Details…** (reopen the same dialog to edit metadata without changing status). Drafts are visible only to the admin — enforced by RLS, not the UI.
- **Posted date — automatic, override for legacy.** In the normal flow you never touch it: on first publish `occurred_at` (the public posted date) is set to the publish moment automatically. The dialog has a **"Set a custom posted date"** toggle revealing a `datetime-local` — used only to backdate the retrofitted 2023 essays. See [data-model.md](data-model.md) §6 for how `occurred_at` relates to the system timestamps `created_at` / `published_at` / `updated_at`.
- **Read time:** computed from `body` word count at render; not stored (may cache into `details.reading_minutes` later).

## 6. Songs — what auto-fills, what doesn't

Paste a Spotify track URL. We call `https://open.spotify.com/oembed?url=…` (**no API key, no auth**) via a server action and parse the track id from the URL.

| Field | Source |
|---|---|
| `title` (song) | oEmbed `title` — **auto** |
| `details.spotify_id` | parsed from the URL — **auto** |
| artwork / embed | oEmbed `thumbnail_url` / `iframe_url` — **auto** (the embed itself lives on the song's public page, not the card) |
| `attribution` (artist) | **manual** — oEmbed does not return the artist |
| `details.album` | **manual** — oEmbed does not return the album |
| `occurred_at` (added) | manual; usually `year` precision (provenance — when it entered his life) |

**The constraint, stated plainly:** oEmbed's `title` is the track name only; it carries no artist or album. Getting those automatically requires the Spotify **Web API** (client-credentials flow → a registered Spotify app + `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET`). We judged that setup not worth it for a modest, hand-curated library — typing the artist is a two-second step. The Web API upgrade is listed in §9 if that ever changes.

## 7. Quotes

Mostly manual, all light. Fields: the quote text (`body`), `attribution` (who said it), and source details in `details` (`source_title`, `source_author`, `work_year`, `page`) plus `source_url`. Subjects and the "added" date as for songs. No external calls.

## 8. Subjects (tags), inline

Subjects are created **on the fly** from a typeahead in any editor — type a subject; if it doesn't exist, saving creates it (slugified) and links it. No separate management chore up front. A light subjects-management screen (rename/merge) is deferred until the tag set is big enough to need grooming.

Subjects are the orthogonal axis to constellations ([data-model.md](data-model.md) §1): a subject is what a fragment is *about*; a constellation is a *way of seeing*. Only subjects are in this phase.

**Provenance — authors & works (the query axis).** Distinct from subjects (*what* a piece is about), authors and works record *where* it comes from. They're optional **query facets** (`fragments.author_id` / `work_id` → `authors` / `works` tables), kept separate from the **display** (which stays in `attribution` / `details.source_title`). That separation is deliberate — it's what lets *all Bible verses* group under one work **"The Bible"** while each still displays its own book+verse (the collection name never shows). In the quote editor, Author/Work are datalist fields that auto-follow the shown fields (and stay editable for scripture); on the list toolbar they're filter dropdowns (pick "The Bible" → every verse). Songs derive them from artist/album automatically.

**Library (`/admin/library`)** grooms the three cross-cutting entities editors create on the fly: **subjects** (with definitions — the taxonomy the AI reads), **authors**, **works**. Each row: edit in place, **merge** a duplicate into another (reassigns links, deletes the loser), or **delete** (FK-safe — `on delete set null`/cascade means a fragment is never orphaned). Usage counts show what's safe to remove.

**Source of truth for definitions:** the **database** (`subjects.definition`) is now runtime-canonical — it's what `/admin/library` edits and what the AI suggester reads live ([ADR 0007](adr/0007-ai-subject-tagging.md)). `scripts/reflections-subjects.json` (mirrored to `src/lib/subjects.ts`) is only the original **seed** used by the import scripts; new or edited definitions live in the DB, not that file. Don't treat the JSON as authoritative after seeding.

**✦ Suggest with AI.** Each editor's subject field has a button that sends the fragment's text + the taxonomy (names **and** definitions, read live from the DB) to **Claude Haiku 4.5** and pre-fills the tag input with the existing subjects that apply (capped at 3). The human stays in control — suggestions are ordinary editable chips. If the model proposes a *new* subject it appears as a distinct "New subject: X — Add it" affordance that must be **explicitly accepted** (accepting just drops the name into the field; `syncSubjects` mints it on save). Runs server-side ([`suggestSubjects` action](../src/actions/index.ts) → [`src/lib/suggest-subjects.ts`](../src/lib/suggest-subjects.ts)) with `ANTHROPIC_API_KEY`; structured output (`zodOutputFormat`) pins picks to the real taxonomy. The taxonomy's one source of truth is [`src/lib/subjects.ts`](../src/lib/subjects.ts) (re-exporting `scripts/reflections-subjects.json`). Absent key → the button degrades to an inline "not configured" message; manual tagging is unaffected. Wired for quotes now; songs/essays are the same call when added. Cost ≈ $0.0015/call.

## 9. Deferred (not in admin v1)

- ~~**Constellation placement + composed ordering**~~ — **shipped 2026-07-23** with the composing room (§2: composer + fragment browser).
- **Spotify Web API metadata** (auto artist/album) — §6. Only if manual entry becomes a real annoyance.
- **Subjects management UI** (rename/merge/delete-with-reassign) — §8.
- **Revision history / timeline** — [data-model.md](data-model.md) §9. The composer autosaves one working copy (§5); a *history* of past versions is not stored.
- **Bulk import tooling** beyond paste (e.g. batch Spotify, quote capture) — [architecture.md](architecture.md) §6.5.
