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
| **Quote quick-editor** | slide-over on the list | **Quote** (a minimal TipTap editor → Markdown, `breaks:true` so poetry survives) and **attribution** are required (marked, and they gate Save). Optional source metadata (title/author/work-year/page/citation/link) is tucked in a collapsible group. Subjects, with **✦ Suggest with AI** (Claude Haiku 4.5 reads the quote and pre-fills subjects — see §8). Date is **automatic** (now) unless "Set a specific date" is toggled to backdate a legacy quote — same convention as the composer. **Quotes publish on save** — no draft picker (a quote has no draft lifecycle); unpublish via the list's bulk actions. |
| **Song quick-editor** | slide-over on the list | Light: paste a Spotify link → title/art/embed auto-fill; artist/album/year, subjects. **Publishes on save** (like quotes); unpublish via the list. |
| **Writing composer** | `/admin/writing/[id]` | Deep: title, auto-slug, WYSIWYG Markdown body, excerpt, backdatable posted date, subjects, draft↔publish. Its own full page. |

`[id]` is either `new` (create) or a fragment UUID (edit). Quotes and songs are small enough to live in a slide-over panel on the list; writing gets a page because long-form needs room.

## 3. The shape decisions

The first four were made together with Michael on 2026-07-18. The architecturally significant two (mutations, editor) are in [ADR 0005](adr/0005-admin-editing-architecture.md).

1. **List + quick-editors + full composer.** One unified list is the spine (cross-type view, bulk actions live in one place). Light types (quote/song) edit in a slide-over so they stay fast; writing gets a dedicated page. This mirrors the plumbing gradient rather than fighting it.
2. **WYSIWYG that stores Markdown.** The writing editor is a true WYSIWYG surface, but the file it writes is **Markdown** — because `fragments.body` is contractually Markdown ([data-model.md](data-model.md) §4, [ADR 0003](adr/0003-fragments-single-table.md)). The editor is **TipTap** (ProseMirror) with `tiptap-markdown` for Markdown in/out and a fixed, Google-Docs-style toolbar. See [ADR 0006](adr/0006-composer-editor-tiptap.md) (which superseded the original Milkdown pick in [ADR 0005](adr/0005-admin-editing-architecture.md)).
3. **Songs auto-fetch from the Spotify link.** Paste a URL; we call Spotify's keyless **oEmbed** to fill the title, artwork, and embed, and parse the track id from the URL. See §6 for exactly what auto-fills and what stays manual.
4. **Constellation placement is deferred to the Sky phase.** Admin v1 is fragments + subjects + full CRUD/bulk. Placing fragments into constellations with composed order ([data-model.md](data-model.md) §4, `fragment_constellations.position`) ships alongside the Sky, where that UI belongs. This keeps the phase focused on getting content *in*.
5. **Quotes & songs publish on save; only writing has a draft lifecycle** (added 2026-07-20). A quote or song is a short, finished thing — a draft-then-publish cycle is pointless friction — so their quick-editors have no status picker and save straight to `published`. The `status` column stays (it's the public-visibility gate, and the list's bulk publish/unpublish still uses it); edits preserve the current state, so a deliberately-unpublished fragment isn't force-republished. Writing keeps drafts/autosave (§5), because essays genuinely evolve over time.

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

## 5. The writing composer

The deep end. Route `/admin/writing/[id]` — a focused, near-full-screen writing surface: command bar, fixed formatting toolbar, then the document (title + body) centered on the page. No sidebar of metadata fields; the "last-mile" details live in the publish dialog (below).

- **Editor:** **TipTap** (ProseMirror) + `tiptap-markdown`, with a fixed Google-Docs-style toolbar we own (undo/redo · H2/H3 · bold/italic/strike · quote/lists · link/divider), active-state highlighted. **Markdown is the stored value** (`editor.storage.markdown.getMarkdown()` → the `body` field). The editor surface wears the `.reading` class, so drafting looks like the published article. See [ADR 0006](adr/0006-composer-editor-tiptap.md).
- **Paste-from-HTML migration path.** ProseMirror ingests pasted HTML natively, so pasting a Squarespace essay converts it to clean Markdown in place. This is how the existing back catalog of essays comes in — through the composer, from real use, **not** a scraper ([architecture.md](architecture.md) §8).
- **Drafts autosave; published posts don't.** While a piece is a **draft**, the working copy autosaves ~1.2s after you stop typing (debounced, in-flight-guarded), **even when untitled** (title/body are optional for a draft; both are required only to *publish*). The first autosave inserts the row and captures its id (URL → `/admin/writing/<id>`); later ones update in place. Indicator: **spinner → "Saved 3:45 PM."**
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

- **Constellation placement + composed ordering** — ships with the Sky (decision 4 above).
- **Spotify Web API metadata** (auto artist/album) — §6. Only if manual entry becomes a real annoyance.
- **Subjects management UI** (rename/merge/delete-with-reassign) — §8.
- **Revision history / timeline** — [data-model.md](data-model.md) §9. The composer autosaves one working copy (§5); a *history* of past versions is not stored.
- **Bulk import tooling** beyond paste (e.g. batch Spotify, quote capture) — [architecture.md](architecture.md) §6.5.
