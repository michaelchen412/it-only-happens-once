# The admin

*The private half of the site, where Michael creates and edits content. Companion to [`architecture.md`](architecture.md) (rendering/data flow), [`data-model.md`](data-model.md) (the fragment schema), and [`auth.md`](auth.md) (who gets in). The editing-architecture decision is recorded in [ADR 0005](adr/0005-admin-editing-architecture.md); what lives at the root, and why the building has a name, in [ADR 0015](adr/0015-admin-root-becomes-today.md).*

---

## 1. The third room

`design.md` names two registers: the **Sky** (evocative, curated, near-chromeless) and the **Index** (utilitarian retrieval — search, filters, pills). The admin is **neither**. It is a *third room*: private, seen by no one but Michael, gated to a single account ([`auth.md`](auth.md)).

**One building, plain rooms.** The whole of `/admin` is the **Observatory** — the room a sky is watched from, and a building whose defining activity is the repeated nightly log. Inside it the rooms keep plain nouns: **Today · People · Agenda · Fragments · Constellations · Library · About**. The Agenda holds three surfaces — Calendar, Tasks and Goals — which is what §9's name was always waiting for. The contrast is deliberate — you navigate by nouns, the corpus keeps the celestial vocabulary. It was called the *Workshop* until 2026-08-02, when `/admin` stopped being the fragment table and the name started describing both the whole and one of its parts ([ADR 0015](adr/0015-admin-root-becomes-today.md)).

So its rule is different. It uses the same design tokens — the `dusk` theme, Atkinson for chrome, Newsreader on the actual writing surface so drafting *feels* like the published essay — but otherwise **optimizes for speed and density over poetry**. Warmth here is expressed as *low friction*: paste a link and the fields fill; type a title and the slug follows; one keystroke publishes.

**The standard is legibility at a glance, not decoration** — and that replaces an earlier rule (*"we deliberately do not over-invest in visual polish for a room only one person enters"*), which was written when this was a publishing form used weekly. Today is opened first thing every morning, and a daily driver earns the investment a form did not. Legibility is the test, so the spend goes on knowing where you are before reading a word: bordered zones with hue-tinted headers, one colour axis for *domain* and a separate one for *urgency* that never mean each other, and a domain with nothing to say rendering quiet rather than as an empty skeleton.

⚠ **The domain axis belongs to the *zone* chrome, and the corpus rooms have no zones.** `.zone__cta` is literally `background: var(--cn)` — it carries no colour of its own and inherits one from a `cn-*` class — so HQ's sheets and zone actions wear `cn-amber` (agenda), `cn-azure` (people), `cn-gold` (links and the shelf), while the fragment manager, the composer, the Library and the About builder use a plain `btn-primary`. **That is not a gap in the axis; it is what a primary is outside the zone system**, and it is written down here because the absence read as an oversight for long enough to be filed as one ([ADR 0033](adr/0033-the-observatory-has-one-field-grammar.md) protects the hue and never said where it applies). ⚠ Nothing is repainted on the strength of this — a corpus room that grows zones grows hues with them, and one that doesn't, doesn't.

Everything under `/admin` is `prerender = false` and auth-gated by [`middleware.ts`](../src/middleware.ts) (must be the admin role). Nothing here is ever cached or public.

## 2. Surfaces

Everything the admin does maps to a small set of screens. The plumbing depth differs by type — that gradient is the whole reason for the shape in §3.

| Surface | Route | What it is |
|---|---|---|
| **Today** | `/admin` | The front door, and the daily one ([ADR 0015](adr/0015-admin-root-becomes-today.md)). The date bar *is* the control — `‹ ›` step a day, the date opens a month calendar, `↩ Today` returns, and the route is `/admin?date=YYYY-MM-DD`. Below it, one bordered zone per domain: **Morning** (§11), **Today** (the day's events and tasks), **People** (the brief, then drift), **Coming up** (lead-driven), **Practice** (signals) and **Past due**, full width at the foot. **Only the check-in follows the date bar** — every other zone is a statement about *now*. See §16. |
| **People** | `/admin/people` | The roster (§12), grouped by circle with a coming-up rail above it. Search appears only past six people and filters in place. Archived people sit in a section of their own, out of the roster and out of search. |
| **Profile** | `/admin/people/[slug]` | One person, as a **full page** — a deliberate departure from §3.6's overlay rule, explained in §12. Fixed facts in a `dt`/`dd` strip, the **timeline** in the main column with its log box open at the head, **About** and **Shared** in the rail, and a pencil on the block it edits. On a phone the order inverts: About first, because you open a profile there to remember who somebody is, not to scroll a year of entries. |
| **Link sheet** | slide-over, a profile | Attach a **work** or a single **fragment** to somebody (§12). Two modes over one drawer, a search over the whole corpus filtered in the browser, and an optional note. A drawer rather than a popover because the thing being picked is one row out of a few hundred. |
| **Person sheet** | slide-over, either people page | Add somebody, or edit the fixed facts. **Name + circle is enough to create**; everything else is optional and fillable later, because a form that demands nine fields to add a friend is a form you avoid. Carries the photo picker, which is also the phone camera-roll path. |
| **The ✚** | bottom-right, **every** admin page | Quick capture (§5b). A `<dialog>` holding one box — a TipTap editor with the writing sheet's toolbar under it — that saves itself on a 700ms debounce as a `note`; **＋ New** (or ⌘/Ctrl+Enter) parks it and hands over a blank. Mounted in `AdminLayout`, so it belongs to the building rather than to a room — and deliberately **not** a zone on Today, which answers *what is my day* and would be the wrong home for a dumping ground. |
| **Notes** | `/admin/notes` | The pile (§5b). Every brain dump rendered as **its own text**, newest-touched first, with an elapsed stamp — no title, no slug, no checkbox, no table. Three controls per card: a pencil opens the room's one editor **in that card**, a bin deletes softly with an undo strip, and **→** opens the chooser holding all four destinations (task · log entry · new piece · into an existing piece). Replaced `?view=notes` on 2026-08-03, which now redirects here. |
| **Kind bar** | top of the task & event sheets | *"Task — it repeats, and an event cannot"*, with the other shape one tap away (§5d). Visible only when a reading filled the sheet in. |
| **Log sheet** | dialog, the Notes room | Turn a dump into a log entry (§5b). The same action, kinds and date register as the profile's log box, plus the one control that box never needs: **who**. Rendered only when the roster is non-empty. |
| **Fragment list** | `/admin/fragments` | The Fragment Manager: a flat, **sortable table** over all fragments (Type · Title · Status · Posted · Edited; click Title/Posted/Edited to sort). The Title column absorbs all slack (`w-full`); date/status stay content-width. **Writing/song** show a one-line truncated title; **quotes** have no title, so the quote *text* fills that column (italic, clamped to 3 lines — short quotes in full, long ones clipped) with a citation line beneath — `— Author, Work`, or, for a quote whose line is silent, `your words` / `source unknown` in muted italic (§7). **Drafts are always pinned to the top.** A segmented **type filter with live counts** (All · writing · quote · song) + subject filter + [**search with match-highlighting**](search.md); whole-row click opens the editor; shift-click range-selects; [**a selection that behaves like a cart**](#2b-the-selection-is-a-cart); bulk actions; an **Add ▾** menu; a Trash button. Filtering/sorting swap the table in place (no reload). *(Posted = `occurred_at`, the public date; the separate `published_at` audit timestamp isn't shown — for a normal post it equals Posted.)* |
| **Trash** | `/admin/fragments?view=trash` | Soft-deleted fragments — restore, delete-forever, or empty. Delete is a *soft* delete (`deleted_at`); nothing is hard-deleted until explicitly purged. |
| **Quote quick-editor** | slide-over, any admin page | **Quote** (a minimal TipTap editor → Markdown, `breaks:true` so poetry survives) is the **only required field**, and it alone gates Save. Beneath it, the three provenance facts in the order the machinery flows — **Who said it** (a person, *Me*, or blank) → **From what** → **Where in it** — and a live preview of the line they produce (*Shows as* / *Behind it*), with `change` to override it (§7). Nothing needed is inside a collapsed box. Subjects, with **✦ Suggest with AI** (Claude Haiku 4.5 reads the quote and pre-fills subjects — see §8). Date is **automatic** (now) unless "Set a specific date" is toggled to backdate a legacy quote — same convention as the writing sheet. A collapsed **Shared by** field says which person put these words in front of you (§12) — applied immediately, like constellation membership. **Quotes publish on save** — no draft picker (a quote has no draft lifecycle); unpublish via the list's bulk actions. |
| **Song sheet** | slide-over, `/admin/fragments` | **The one editor for a song** (§6b). Its own paste bar, a player, and two tabs: **Facts** (title/artist/album/year, Shared by, and the pieces it is paired to, §6c) and **Notes** (one public, one private). It was a TRIAD until 2026-08-15 — Feelings led, and its job was to state ADR 0031's claim in the interface: a feeling is not a property of the song and a fact is. [ADR 0035](adr/0035-a-set-is-a-listen-you-can-take-away.md) retired the vocabulary, so the distinction has nothing left to draw. No subjects, no constellations. **Publishes on save** (like quotes); unpublish via the list. |
| **Writing sheet** | near-fullscreen slide-over | Deep: title, auto-slug, WYSIWYG Markdown body **with images** (toolbar, paste or drag-drop — §5c), excerpt, backdatable posted date, subjects (with **✦ Suggest with AI**, in the publish dialog — §8), draft↔publish (§5). An overlay like the quick-editors, just wide — the old standalone page `/admin/writing/[id]` is **retired** and 302s to `/admin/fragments#edit=<id>` / `#new-writing`, which auto-open the sheet. A hash never reaches the server, so those links are updated at every *producer* rather than redirected; `/admin` keeps a client-side bounce for old ones. |
| **Constellations index** | `/admin/constellations` | Every constellation, draft + published: create (a "pile" is just a draft), publish/unpublish, reorder the sky's authored order, delete (placements cascade; fragments untouched). |
| **The composer** | `/admin/constellations/[id]` | The composing room (design.md §13): the suite in two views over one sequence — **Compose** (dense rows; drag or Alt+↑/↓ to reorder, ✕ unplaces) and **Read** (the public stanzas verbatim, drafts included) — plus the constellation's name/slug/colour/visibility/description/score, the three tests as quiet gauges, Preview → the real public page (drafts render for the admin only). One **Add** button opens the fragment browser. **The settings card, reworked 2026-08-11:** visibility is a **switch** beside the URL (not a select), and it saves with the card rather than on flip — so the line under it says *"It joins/leaves the sky when you press Save"* until you do, and a chip beside the page title mirrors it. Under that sits the **publish preflight** — *"2 of the 6 placed are drafts — a reader would see 4"* — the one fact the room could not see before, recomputed in the browser after every unplace. The description is a **rich field** (the same bold/italic mini editor a quote body uses; stored as Markdown, carried into the form by a hidden input). The score is `type="url"` with an **Open ↗** that follows what you type. **⌘/Ctrl+S saves** — swallowed while any sheet is open, so it can never save the constellation behind the fragment you are editing. |
| **Fragment browser** | large slide-over on the composer | A mini Fragment Manager: the *same* toolbar + table as `/admin/fragments` (served by the `/admin/fragments-panel` partial in `mode=pick`). Rows already in this constellation render **dimmed and unselectable**; everything else places via a per-row ＋ or checkbox-select + "Place N". Its own Add ▾ creates fragments that auto-place (`body[data-place-in]`). Closing after any placement refreshes the suite **in place** — nothing on this path navigates (§2a). **It serves three rooms now** — see §2d. |
| **Sets** | `/admin/sets` | The curated listens (§17). Rows in authored order — title, status chip, drag-or-Alt reorder — with **one `New` in the header** and a **⋯** holding Publish/Unpublish, *Open on Spotify* and Delete. The title is the edit affordance; everything else happens in the **set sheet**. It was seven open `<form>`s until 2026-08-17 ([ADR 0038](adr/0038-a-private-admin-surface-may-require-javascript.md)). |
| **Set sheet** | slide-over, `/admin/sets` | Six fields — title, playlist, quote, description, visibility, address. The description is the **same mini editor** the quote body uses (the public page has always rendered it as Markdown). Visibility is a **form-bound switch**; the list's ⋯ is the click-is-commit half, which is the constellations shape. The quote is chosen in the **epigraph picker** (§2d), and the pick is **held on the form until Save** — an epigraph is a column on the set, not a relation. |

**The fragment → constellation view** (added 2026-07-24). The composer answers *what is in this constellation*; these answer *where does this fragment live* — the same join read from the other end:

- **A Constellations column** in the shared table (so it appears in the manager *and* the browser sheet): a filled ✦ chip per constellation, or a dashed **none** chip. The two treatments are deliberately different shapes, not just different text, so a column of orphans reads as absence while scanning. Hidden below `lg` — acceptable only because the paths it shortcuts (open the row → its tab; the bulk menu) both survive that breakpoint. An action may vanish at a breakpoint; a *only* way to do something may not.
- **The column is also the door.** The whole cell is one button: it opens that fragment's editor already on its Constellations tab — the same door for all three types, because you shouldn't have to know a row's type to predict what a click does. It is deliberately **not** a button per chip: `<button>` cannot contain interactive content, so a per-chip ✕ would break the cell into small targets with dead gaps, and it would hang an unassign on a fast, unaimed click. Removal stays in the picker, labelled and reversible. The ＋ is visible at rest (hover is not a signal touch or the keyboard can read) and occupies a reserved slot (nothing reflows under the cursor), and the cell's hover outline is deliberately unlike the row's tint, because it is a different door. Rows say *which fragment, which tab* and never name a surface ([open-editor.ts](../src/scripts/open-editor.ts)) — so if this ever becomes a popover instead of a sheet, no row changes.
- **A membership filter** (`?in=<slug>`, or `?in=none`). Note `in` is deliberately distinct from the `constellation` param, which only *marks* rows in pick mode. Empty is a meaningful value in this corner of the app: Astro turns a blank form field into `null`, so the membership action coerces it back (`idList`) — a bare `z.string()` rejected the exact case that means "belongs to none". The orphan view is the point: at the time of writing, 85 of 124 fragments belonged to no constellation, and nothing in the workshop could surface them.
- **A picker in each editor** ([ConstellationPicker](../src/components/admin/ConstellationPicker.astro)) — a checkbox list of the whole sky, living in its own **tab** (`Quote|Song` / `Document` beside `Constellations`, with a live count). It's a tab rather than a field or a popover because membership is a peer of the content, not chrome hanging off it — and because a draft essay never opens the publish dialog, so that was never a home for it. Each row shows the constellation's **full description** (four-line cap for a runaway one): you're deciding where a piece belongs, and a truncated opening clause just makes you hover to finish the thought. A filter field appears past eight constellations; there's no inner scrollbox, since the sheet already scrolls.
- **A toggle applies immediately** — membership is a relationship, not a field on the fragment, so it needs no save and is instantly reversible. Two consequences worth knowing: membership events are excluded from both sheets' dirty guards (otherwise closing warns about "unsaved edits" that were already written, and the writing sheet kicks off a spurious autosave), and a fragment that doesn't exist yet queues its ticks and flushes them the moment the first save mints an id — which *replaces* the old implicit `data-place-in` behavior with a pre-ticked box you can see and untick.
- The same full-description treatment appears in the bulk menu, and the browser sheet's header names the constellation you're composing into. **Everywhere a fragment can be assigned, you can read what you're assigning it to.**
- **Bulk elevate** from the selection bar. "Remove from" lists only constellations the selection actually belongs to, read off each row's `data-constellations`. With a cart (§2b) a selected row may not be on screen, and its memberships are then unknown — the list **under-offers**, which is the safe direction.

### 2d. The four verbs — one index, and the rules it implies

*Graduated from `plans/42` on 2026-08-17, after the batches it prescribes were
built. It is here rather than in a plan because it describes what the building
does; the argument for each change is in the code, at the control.*

⚠ **The rules are written as PREDICTORS, the way §4a is.** The value is that a
surface which does not exist yet has an answer before anyone argues about it, and
that a surface which *contradicts* one either changes or writes down why in the
file. Four consistency passes had each taken a horizontal slice — the exit
([ADR 0032](adr/0032-a-sheet-is-dismissible-and-says-what-that-costs.md)), field
geometry ([ADR 0033](adr/0033-the-observatory-has-one-field-grammar.md)), the
error channel, the sheet shell — and none had asked what a *verb* costs.

**CREATE — the door, and what it opens.** One primary in `PageHeader`'s actions
slot, repeated inside `EmptyState`'s slot, opening a drawer — **unless the create
needs exactly one field**, which folds away inline (the constellations index, and
the picker's `＋ New constellation` that copies it).

⚠ **What the door is CALLED: it names the noun only when the page around it does
not.** Tasks, Goals and People carry an `h1` and say *New* / *Add*; the calendar
has no heading naming an event, so it says *New event*; the fragment manager
makes two kinds and puts the nouns on the menu items. `/admin/constellations` is
redundant with its own `h1` and is a known exception. *Add* is for a thing
joining something that already exists — a person, a placement, a shelf link;
*New* is for a thing the room brings into being. The rule lives in
[`PageHeader.astro`](../src/components/admin/PageHeader.astro).

**EDIT — it opens from the thing itself.** A whole row (the fragment table), the
title (tasks, sets, the calendar's *event* rows), the name (constellations), or a
pencil on the block it edits (the profile's blocks, a timeline entry, a note
card). ⚠ **No pencil sits on every row announcing itself** — the calendar's day
panel carried one until 2026-08-17, and its four row *kinds* are why the fix was
per-kind: a mirrored row's title links to Google, a birthday stays inert.

**DELETE — apart from the benign controls, and it says what it takes.** The rule
is a zone at the END of the thing it destroys, below a rule, with a line naming
what survives ([`WritingSheet`](../src/components/admin/WritingSheet.astro), the
quote and song sheets, the composer, the profile's Archive).

⚠ **The footer variant is legal when the form does not scroll** — a short record
has no "end of the object" distinct from its footer, so the zone buys ceremony
and no separation. Task, goal and event take it. **The price is that a footer
Delete must say IRREVERSIBILITY in its confirm**, because nothing on screen says
it first: all three are hard `.delete()` calls with no trash tier, which makes
them the least ceremonious deletes in the building and the only unrecoverable
ones. The boundary is stated in [`scripts/sheet.ts`](../src/scripts/sheet.ts).

**Everything destructive goes through `confirmDialog`**, and **every confirm
label names its verb** — Delete · Discard · Archive · Put back · Promote · Merge ·
Unlink · Unpublish · Replace · Empty trash · Keep both · Delete forever. Thirty
labels, not one bare "Confirm".

**Two exits, and the split is deliberate.** Every HQ sheet carries a Cancel
beside its Save; the three corpus sheets carry only the ✕. A corpus sheet is wide
and its primary is full-width, so a Cancel beside `Save quote` would read as a
second primary; an HQ sheet is a short form where *abandon* is a real intention.
⚠ This is **not** the column ADR 0032 settled — that record's table has exactly
these columns minus this one. Do not add Cancels to make the halves match.

**A primary names what it commits** — *Save quote*, *Save song*, *Save set*,
*Add task*, *Save changes*. ⚠ **A bare `Save` is legal when the surface commits
exactly one object and something above it names that object**: the composer's
sits beside the constellation's own name, `/admin/about` is one object on a
titled page, and the Library's per-row Save sits beside the name input it writes.

**And a save says it is working** — `submitAction`'s `busy` label, or a stated
reason not to (a trash glyph and one word, where the disabled state is the whole
signal). The confirmation is usually **the sheet closing**.

### 2e. The picker that serves three rooms

`FragmentBrowser` is one drawer in three modes, and **the instinct while reading
it will be to make them symmetrical; don't.**

| | `pick` | `pair` | `epigraph` |
|---|---|---|---|
| Room | the composer | the song sheet | the set sheet |
| Writes | `constellations.place` | `songs.pair` | ⚠ **nothing** |
| Offers | everything but notes/trash | writing only | published quotes only |
| Cart | ✅ (a cart, §2b) | — | — |
| Add ▾ | ✅ | — | — |
| Create bar | — | ✅ *write about «term»* | — |
| Author/work filters | ✅ | ⚠ **withheld** | ✅ **kept** |
| Type segments | ✅ | — | — |

- **`epigraph` writes nothing, and that is the deep difference.** A placement and
  a pairing are **relations** — join rows, instantly reversible, so they apply on
  touch (§4a). A set's epigraph is a **scalar column**, so the pick is held on the
  sheet's form and rides its Save. That is also what lets an unsaved *new* set
  carry a quote.
- ⚠ **Author and work are withheld from `pair` and kept in `epigraph`, and the
  reason is the corpus rather than the picker.** Both facets are empty on a piece
  of Michael's own writing, so in a writing-only list every option would answer
  nothing — which is worse than a dead control, it is one that answers "no
  results" and reads as an empty corpus. A quotes-only list is *exactly* what
  those two facets describe. Pinned by `tests/e2e/set-epigraph.spec.ts` so a
  later tidy-up cannot fold them into one rule.
- **`pair` and `epigraph` have no cart** — one foreign key and one column are
  neither of them a multi-select. ⚠ `FragmentRow`'s `<td>` and the panel's `<th>`
  must agree or every row shifts one cell left.
- **The create bar is `pair`'s alone.** It starts a draft essay and pairs the song
  to it — a sentence the other two cannot finish.

### 2b. The selection is a cart

*Changed 2026-08-04, in both rooms that use the panel.* The selection used to have no existence outside the DOM: `getSelected()` read `.row-check:checked`, and every filter change replaced `listWrap.innerHTML` and rebuilt the boxes unticked. So selecting three fragments and then narrowing the search silently threw all three away — *"if I select something and I change the filters, it will just deselect whatever I had."*

It is a `Set<string>` owned by `wireFragmentPanel` now, and the DOM follows it: after every swap the visible boxes are re-ticked from the cart, so something you carted three searches ago comes back ticked when a later filter brings it back on screen. **Insertion order is load-bearing** — the browser's bulk place goes through the ids sequentially and each placement takes `position = max+1`, so the order you added things to the cart becomes their order in the suite. Before, it was whatever order the filter happened to render.

One behaviour for one component, on both surfaces: a flag to make the manager and the browser differ would be two behaviours to keep straight for no reason anybody could state. Three things exist only to keep that honest:

- **`3 selected · 1 shown here`** whenever the cart is wider than the filter. A number you cannot finish counting on screen has to be explained or it reads as a bug.
- **Clear**, because "change the filter" has stopped being the way to empty it. `select-all` still means *everything currently visible* — it adds or removes the rows on screen and never wipes the rest of the cart.
- **The confirm names the count.** ⚠ A persisting cart beside the manager's bulk **delete** is a sharper tool than one beside bulk place: it becomes possible to trash a row that scrolled out of view under a filter you have since changed. Every bulk op on that bar also clears the cart afterwards, since all of them can move rows out of the current view.

`markPlaced` calls `panel.deselect(id)` — a disabled checkbox is invisible to the cart, so a placed fragment's id would otherwise ride along into the next bulk place. And `.row-check` got a 24px hit target (a transparent `::after`; the box still draws at 16px), because WCAG 2.5.8's floor started mattering the moment ticking one stopped being a throwaway gesture.

- **You can make one from inside a fragment** (2026-08-04). A `＋ New constellation` row under the picker unfolds a one-field form — the same fold-away shape as the constellations index, which is where the muscle memory already is. It needs no server code: `constellations.save` creates from a name alone (status defaults to `draft`, the colour slot is the least-used one, the slug derives and de-dupes). It de-dupes on **name** client-side, which the server does not: `save` de-dupes *slugs*, so a second "Grief" would silently become `grief-2` and leave you two constellations that look identical. A match ticks the existing row and says so. Each row also carries a hover-revealed **↗** to that constellation's own page in a new tab, so going to look at one never disturbs the fragment you're editing — it sits outside the `<label>` by construction, so it cannot tick anything on the way.
- **The filter field renders always and hides below the threshold**, so a sky that grows past eight *mid-session* gets its filter without a reload.

Adding from this side **appends** to the end of that suite — composed order stays the constellation's business (recompose in the composer).

### 2c. The building says what it is waiting for

*Plan 20 (local working notes), shipped 2026-08-06. Raised by Michael from real use: "if we have unfinished tasks or check-ins for the day, it's not actually apparent from the left side sidebar." Today knew; every other room was deaf, so navigating away stopped the system telling you anything at all.*

**One number, four places, one source.** [`src/lib/hq/attention.ts`](../src/lib/hq/attention.ts) computes it once per request in middleware — the sidebar's Today pill, the burger pill on mobile, the tab title's `(2) ` prefix, and the **installed app's icon badge** all read that one answer. Five surfaces inventing their own would disagree, and the one that disagreed would be the one on screen at 7am.

**It counts exactly two things: the unanswered check-in, and tasks due *today* that are undone.** Nothing else, and the exclusions are the section:

> ⚠ **[ADR 0013](adr/0013-absence-never-accumulates.md) ends with a standing instruction — *"any feature that wants to show a count of things not done must be checked against this ADR first"* — and this is that check, run in conversation on 2026-08-04.** The outcome is not "we changed our minds". The ADR was defending against one specific mechanism and it named it: **a number that grows while you are away**, landing hardest on the morning you can least absorb it. That mechanism is already impossible here, because recurrences are rules and never materialise rows, so the count can never exceed the number of task *rules* you have — two weeks away produces the same number as two days.
>
> So the line moves from *never count* to: **a room may signal what is addressed to you, bounded, resolvable today, and self-resetting. It may never signal accumulation.** Past due fails the fourth test and is therefore the one input excluded on purpose; drift and the writing signal fail the first two. **The single most likely regression in this feature is a future session folding past due in "for consistency"** — one line of code, and it silently restores the guilt engine the ADR exists to prevent.

- **`0` never renders.** No pill, no prefix, no badge — the reward is the absence.
- **Two facts the plan got wrong and both would have shipped as plausible.** It specified counting `due_on`, but ticking a task advances that column immediately, so the raw value says *tomorrow* about a row still on screen — the honest occurrence is rebuilt from `task_events.for_due_on`, which is what the rooms already render. And it settled the check-in with `hasAnswers()` alone: a **skipped** row has every field null, so the badge would have gone on burning after a deliberate skip. `checkinSettled` composes the two.
- **The icon badge is honest only while the app runs.** `navigator.setAppBadge` executes in the page, so an installed app keeps the numeral live while it is open and corrects it every time it is opened. ⚠ **It is cleared on `pagehide`, deliberately.** Leaving it standing is wrong every single night — at 00:01 the true count is 1 and the icon still shows yesterday's — and **being reliably absent beats being confidently wrong**. The cost is a blink on every admin navigation (there is no ClientRouter; each room is a real page load), taken knowingly.
- **The badge does not follow the date bar.** It is a statement about *now*, like every zone on Today except the check-in (§16), so `?date=` does not move it.

### 2a. Nothing in the workshop navigates to stay fresh

*Rebuilt 2026-08-04, after composing for real. Every symptom was one fault in a different coat: state that lived only in the DOM and was thrown away, or was baked into the HTML and never revisited.*

- **The ✕ unplaces in the DOM.** It used to `location.reload()`, which re-ran seven queries — the first of them pulling every placed fragment's full body — re-rendered both views and every Reader template, and reset your scroll, all to learn that five had become four. An unplace needs no new markup from the server: a row leaves and the rest are unchanged. The badges, the subject spread and the hint line are recomputed from the rows (each carries `data-type` and `data-subjects` for exactly this), and focus moves to the next row's ✕ so removing a run doesn't strand the keyboard. The action is **awaited** before the row goes, so a refusal leaves the row where it is and `#cc-error` says why.
  The suite's chrome — the empty state, the row list, the Compose/Read control, the Read panel, the hint line — is therefore rendered **unconditionally and hidden with `hidden`**, rather than branched away when the suite is empty. Removing the LAST row would otherwise need markup the page was never sent, and `refreshSuite()` needs somewhere to swap into.
- **Everything else announces `fragments:changed`** ([`fragments-changed.ts`](../src/scripts/fragments-changed.ts)) instead of reloading: both editor sheets on save, trash and membership change, and the browser on close-after-placement. The event is **cancelable**, and a host that can refresh in place claims it with `preventDefault()`; if nothing claims it the caller falls back to `location.reload()`, so mounting a sheet on a page that has never heard of the event behaves exactly as it did before. `/admin/fragments` claims it with `panel.refresh()`; the composer with `refreshSuite()` (fetch the page, `DOMParser`, copy `innerHTML` across); the browser drawer claims it only while open.
  ⚠ **`refreshSuite()` swaps `innerHTML`, never the elements.** Every click, keydown and drag listener is delegated onto the captured `#suite-rows` / `#suite-read-list`. Replacing a node with the fetched one looks completely correct and silently kills reordering.
- **The sky's list stops going stale**, by two complementary mechanisms that each cover what the other cannot. **Push**: `sky:changed` ([`sky-changed.ts`](../src/scripts/sky-changed.ts)) — a picker that creates one tells the sibling picker, the `?in=` filter select and the browser's header. **Pull**: `syncToolbar()` in `fragment-panel.ts` copies the fresh `<option>` list out of every partial the panel already fetches, at no extra request, preserving your current selection. Push is instant but cannot see another tab; pull sees everything but only when something already causes a fetch.
- **`Cache-Control: no-store` on `/admin`.** Admin HTML is database-backed, per-user, and was never revalidated on the server's instruction, so a soft reload could hand back a snapshot and bfcache would restore one wholesale on Back — which is why the workshop needed a *hard* refresh to see a constellation you had just made. ⚠ The cost is bfcache for the whole admin area, deliberately: a restored workshop is a lying workshop, and this is one signed-in user on their own data. **Not for the public side.**
- **The dialogs finish closing.** The exit animations were always right and were being interrupted. On one path `close()` was never called at all — `if (membershipTouched()) return void location.reload()` jumped over `sheet.close()`, so on *assign it to a constellation, then close the sheet* the sheet sat open until a page load painted over it. Every path now closes explicitly, and heavy work waits: [`afterDialogClose`](../src/scripts/dialog-close.ts) races the first `transitionend` on the dialog against a ~350ms timeout, and the composer starts its fetch immediately while deferring only the swap. The timeout is **not optional** — without it one missed event means a suite that silently never refreshes. (`prefers-reduced-motion` needs no special case: `app.css` *zeroes* the durations rather than removing the transitions, so the event still fires, immediately.)

**Constellation colour** (2026-07-24; the control moved 2026-08-04). Each constellation owns a hue from the sky's ramp (design.md §13), and a new one auto-takes the least-used slot. It tints the membership chips and the index's stars, which is the point: you can tell where a fragment lives without reading. The DB stores a slot NAME only — `app.css` owns the value, per theme. Consequently **TypeMark is no longer colour-coded**: the glyph shape already carried type, and two colour languages on one row read as noise.

**It is chosen on `/admin/constellations`, not in the individual composer** — the row's own ✦ is the control, and clicking it opens a popover of the eight slots with a count under each showing how many constellations already wear it. The reason is that a colour slot is not a property of one constellation: it is a property of one constellation *relative to the other seven slots and to what its neighbours are wearing*. Asking for it inside a single composer asked for a comparative judgement with nothing to compare against. The codebase already believed this — `leastUsedSlot` chooses automatically by looking at every other constellation, so the automatic choice was better informed than the manual one, which is backwards. The composer still *shows* the colour (the star in its title) and carries a one-line hint saying where it is chosen, so the absence reads as deliberate.

Moving it also deleted a class of bug rather than fixing it: the composer carried the saved colour as a `cn-*` class on three separate ancestors, none of which were repainted on save, so the page never showed the colour you had just chosen. A page that only ever renders the server's value is correct by construction. On the index there is no form and no Save button — **the click is the commit**, matching the status toggle beside it — so the row repaints immediately and reconciles if the save fails.

**Back to top, in the thing that scrolls.** Long surfaces get a floating return control ([BackToTop](../src/components/BackToTop.astro)): the manager and Library via `AdminLayout`, and — because these scroll *inside* a container where window scroll never fires — the browser sheet, both editor sheets, and the public Reader, each naming its own scroller. Mounted inside a dialog it positions absolutely, so it rides the sheet's corner (above the browser's bulk bar) instead of the viewport's.

**Shared chrome.** The pieces every surface repeats have exactly one implementation: [`PageHeader`](../src/components/admin/PageHeader.astro) (back link + title + right-aligned actions + one-line explanation), [`TypeMark`](../src/components/admin/TypeMark.astro) (the type mark, from `TYPE_META` — `”` for a quote and *nothing* for writing, which since 2026-08-17 is the only distinction the corpus's two kinds need; the mark renders an empty box rather than no box, because it is also the gutter every row's text column is held off), [`TypeCount`](../src/components/admin/TypeCount.astro) ("5 writing" badges), [`StatusChip`](../src/components/admin/StatusChip.astro), [`FilterField`](../src/components/admin/FilterField.astro) (the box that shortens a list, the rows it filters, and the line that says nothing matched — one owner for all three, because four call sites had four answers and only one carried the no-match line), and the `.admin-*` utilities in `admin.css` (`admin-alert`, `admin-hint`, `admin-back`, `admin-stat`, `admin-chip`, `admin-title-input`) — ⚠ **`admin-label` is not among them any more**: its seven field uses retired into `.f__k` when [ADR 0033](adr/0033-the-observatory-has-one-field-grammar.md) converged the field grammar, and the five that were never labels became **`.sec__k`**, the building's suffix for a small uppercase key (`f__k`, `fs__k`, `rail__k`). Added 2026-07-23 after four pages had each hand-rolled their own chips, labels, and error banners — and drifted apart. **Type color is not decoration**: it's the same coding the public site uses (design.md §7), so a quote reads as a quote in the manager, the composer, and the browser alike. Navigation is never deeper than one level, so surfaces get a **back link, not a breadcrumb trail**.

**Every fragment edits in an overlay** — clicking a row anywhere (manager, browser, suite) opens the matching sheet; the page underneath never navigates away. One table implementation serves both the page and the browser: `FragmentListPanel` (class-scoped, wired per-instance by `fragment-panel.ts`) rendered by `/admin/fragments` directly and by the **`/admin/fragments-panel` partial** for in-place refreshes and the browser (auth-gated by the same middleware).

## 3. The shape decisions

The first four were made together with Michael on 2026-07-18. The architecturally significant two (mutations, editor) are in [ADR 0005](adr/0005-admin-editing-architecture.md).

1. **List + quick-editors + full composer.** One unified list is the spine (cross-type view, bulk actions live in one place). Light types (quote/song) edit in a slide-over so they stay fast; writing gets a dedicated page. This mirrors the plumbing gradient rather than fighting it.
2. **WYSIWYG that stores Markdown.** The writing editor is a true WYSIWYG surface, but the file it writes is **Markdown** — because `fragments.body` is contractually Markdown ([data-model.md](data-model.md) §4, [ADR 0003](adr/0003-fragments-single-table.md)). The editor is **TipTap** (ProseMirror) with `tiptap-markdown` for Markdown in/out and a fixed, Google-Docs-style toolbar. See [ADR 0006](adr/0006-composer-editor-tiptap.md) (which superseded the original Milkdown pick in [ADR 0005](adr/0005-admin-editing-architecture.md)).
3. **Songs auto-fetch from the link.** Paste a Spotify track/album or YouTube URL; the **Spotify Web API** fills title, artist, album and release year (keyless **oEmbed** is the fallback when no credential is configured), and the id + kind come from the URL. See §6 for exactly what auto-fills and what stays manual.
4. **Constellation placement is deferred to the Sky phase.** Admin v1 is fragments + subjects + full CRUD/bulk. Placing fragments into constellations with composed order ([data-model.md](data-model.md) §4, `fragment_constellations.position`) ships alongside the Sky, where that UI belongs. This keeps the phase focused on getting content *in*.
5. **Quotes & songs publish on save; only writing has a draft lifecycle** (added 2026-07-20). A quote or song is a short, finished thing — a draft-then-publish cycle is pointless friction — so their quick-editors have no status picker and save straight to `published`. The `status` column stays (it's the public-visibility gate, and the list's bulk publish/unpublish still uses it); edits preserve the current state, so a deliberately-unpublished fragment isn't force-republished. Writing keeps drafts/autosave (§5), because essays genuinely evolve over time.
6. **Everything edits in an overlay; the writing page is retired** (2026-07-23, Michael's call). The original split — quotes/songs in a sheet, writing on its own page — broke context: clicking an essay while composing a constellation threw you out of the room. Now writing opens in a near-fullscreen sheet everywhere (with `#edit=<id>` in the hash so a refresh reopens it), and the composer adds fragments through a browser sheet that IS the Fragment Manager in miniature — one shared table implementation, not a parallel "shelf". The cost accepted knowingly: no more middle-click-to-new-tab on writing rows.
7. **The composer reads in the public's own register** (2026-07-25, Michael's call). A suite composed against 110-character snips can't be judged — you're sequencing database rows, not writing. So the suite gained a **Read** view beside Compose: the stanzas from [`SuiteStanza.astro`](../src/components/SuiteStanza.astro), shared *verbatim* with the public sky (§2.3 of design.md — the pattern became a primitive rather than a second copy), quotes whole, essays opening the blog's own Reader. It includes **drafts**, which the public page structurally can't — `getConstellation` stays published-only, so the composer builds its own items from the admin query. It deliberately stops at the content: no drawn figure, lamplight or score. **Read asks "is this composition any good?"; Preview asks "does the page look right?"** — two questions, two surfaces. In the same pass the row-nudge arrows became touch-only (`@media (hover: hover)` removes them): with a pointer you drag and with a keyboard you Alt+↑/↓, so on desktop they only reserved row width for a duplicate of drag.

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

### 4a. When a change commits — the rule for the whole Observatory

Ten surfaces commit ten slightly different ways, and until 2026-08-12 nothing on screen or on paper predicted which one you were standing in. The differences are mostly *argued* — what was missing was the sentence they are arguing against:

> **A relation applies on touch. A document autosaves. A record takes a Save.**

- A **relation** is a row in a join table — a constellation membership, a pairing, a "Shared by" tick. It is instantly reversible, so it never waits, and it never rides along with a compare-and-set save that could lose a rewrite. (That is why the picker and `pair` write immediately from *inside* the writing sheet, which has exactly such a save.)
- A **document** is prose you sit inside — an essay, a note. Leaving must not lose it, so it autosaves and says when it last did.
- A **record** is a set of fields that mean something only together — a task, a goal, a person, a quote, a song, the About page. It commits once, deliberately, on a named Save.

**Read it as a predictor, not a description.** The value of the rule is that a surface which does not yet exist has an answer before anyone argues about it; a surface that *contradicts* it should either change or write down why in the file.

⚠ **One of the ten does not fit, and it is open**, recorded here rather than reworded into compliance:

- **The Library** commits **per row** where every other record surface commits per object. It is a hundred records on one page, and a per-row Save is why saving one row could discard edits in the others (guarded since 2026-08-12; see `library.astro`).

⚠ **The quote sheet was listed here as a second exception until 2026-08-17, and the entry was wrong.** It read: *"commits like a record and then says nothing at all — no timestamp, no chip, no sentence. Every other record surface confirms."* Measured against its neighbours, **the confirmation is the sheet closing** — which is exactly what the task, goal, event, person and song sheets do, none of which carries a timestamp or a chip either. What the quote sheet actually lacked was the **busy label while the save ran**: it was the one `submitAction` call in the admin passing no `busy`, on a full-width primary reading *Save quote*. Fixed (plan 42 · §4.A.6). ⚠ **The lesson is the reason this correction is written out rather than quietly deleted:** the entry named the wrong half of a real problem, and a surface listed as non-compliant for the wrong reason is one nobody re-measures.

⚠ **This is a `docs/` paragraph and not an ADR on purpose.** It describes what the app does; it does not yet refuse anything. **The day it turns down a proposed surface, it has become a decision and belongs in `adr/`** — that is the test in [`plans/GROUND-RULES.md`](../docs/plans/GROUND-RULES.md), and this line is the marker for when it flips.

## 5. The writing sheet

The deep end. A near-fullscreen `<dialog>` drawer ([`WritingSheet`](../src/components/admin/WritingSheet.astro)): command row, fixed formatting toolbar, then the document (title + body) centered. No sidebar of metadata fields; the "last-mile" details live in the publish dialog (below).

**The command row holds two actions and a door, and it does not move while you type** (2026-08-04). It used to carry up to thirteen children in a single non-wrapping row, five of which moved *mid-sentence* — a Discard button appearing on the first keystroke, a spinner taking width and giving it back on every 1.2s autosave, the status text and the word count both growing with what they said. The row was doing three jobs at once: *what am I looking at* (mark, tabs), *what is happening* (count, spinner, status), and *what can I do*. Only the first two earn permanent residence.

- **In the row:** the primary for the current state (**Publish…** or **Save changes**) and **View ↗**. Everything else — Details…, Unpublish, Discard changes, Make it a draft — is behind a **⋯** menu, which reuses `wireAddMenu` rather than inventing a second dropdown. A menu's contents can appear and disappear for free, which is exactly the property being bought: Discard exists only while you're dirty and costs the row nothing.
- **Delete left the top bar entirely**, for the foot of the document, below a rule, with a line saying what it does and doesn't touch — the treatment the constellation composer already used. A destructive action does not belong in a row of benign ones, one keystroke from Unpublish. It is deliberately *not* in the ⋯ menu either, which would have reproduced the fault in a smaller box.
- **Stillness is bought with reserved space, and the reservations are measured, not estimated.** The spinner is hidden with `visibility` so it keeps its box; the status text and the count each hold a `min-width` sized for the longest **repeating** message, not the longest possible one — reserved space is space that is always spent, and the one 200px sentence ("Kept as a draft version · not public yet") arrives once and then never changes again. A first pass sized these in `ch` by counting characters and the row still moved 6px: `1ch` is the width of a digit, and these strings are lowercase.
- **The tab strip is the named shock absorber.** Left to itself, flex spreads a deficit across every flexible item and some of it reaches the buttons. The strip takes all of it and scrolls inside its own box, so the *row* never scrolls — a top bar you have to swipe, in a near-fullscreen drawer, hides its own Save button. Selecting a tab scrolls it into view. The drawer is `max-w-5xl` for the same reason: at 4xl the row's content measured ~1020px in an 896px box and was silently clipping the Versions tab even at rest. It opens from any writing row (`writing:edit` event), any `[data-new-writing]` button, or the `#edit=<id>` / `#new-writing` hash — the retired `/admin/writing/[id]` route 302s to the latter, so old links still land in the editor. While open the hash mirrors the document (refresh-safe); on close the previous hash is restored and, if anything was saved (or a membership or pairing changed), it announces `fragments:changed` so the list or suite behind it refreshes **in place** — see §2a. Closing a draft flushes the pending autosave first; closing a published piece with unsaved edits asks before discarding.

- **Editor:** **TipTap** (ProseMirror) + `tiptap-markdown`, with a fixed Google-Docs-style toolbar we own (undo/redo · H2/H3 · bold/italic/strike · quote/lists · link/divider), active-state highlighted. **Markdown is the stored value** (`editor.storage.markdown.getMarkdown()` → the `body` field). The editor surface wears the `.reading` class, so drafting looks like the published article. See [ADR 0006](adr/0006-composer-editor-tiptap.md).
- **Paste-from-HTML migration path.** ProseMirror ingests pasted HTML natively, so pasting a Squarespace essay converts it to clean Markdown in place. This is how the existing back catalog of essays comes in — through the composer, from real use, **not** a scraper ([architecture.md](architecture.md) §8).
- **Drafts autosave; published posts don't.** While a piece is a **draft**, the working copy autosaves ~1.2s after you stop typing (debounced, in-flight-guarded), **even when untitled** (title/body are optional for a draft; both are required only to *publish*). The first autosave inserts the row and captures its id (hash → `#edit=<id>`); in a composer context (`body[data-place-in]`) that first save also places the piece into the constellation being composed. Indicator: **spinner → "Saved 3:45 PM."**
- **Once published, editing is deliberate — but no longer risky.** A published post's **live row** never autosaves: edits accumulate and you push them with an explicit **Save changes** (or bail with **Discard**), so fixing a typo on a live post is a conscious act and you never have to unpublish first. The *words*, meanwhile, autosave into a **draft version** on the same ~1.2s debounce a draft uses (§5a), so the bar reads **"Kept as a draft version · not public yet."** Closing is safe: reopen the piece and the edits are waiting under **Versions**. Autosave to the row itself resumes if you Unpublish back to draft.
- **Online-first, stated plainly ([ADR 0010](adr/0010-online-first-writing.md)).** The sheet needs a connection to open a piece and to save one. A save that can't reach the server is reported as unsaved — there is no local queue, and the close prompts say outright that unsaved words will be lost. An IndexedDB outbox was built for this on 2026-07-29 and removed on 2026-07-30: iOS has no Background Sync, so a queue could only ever drain while the app was open, and the capability was worth roughly one day in three hundred. Offline capture goes to iCloud Notes and is reconciled by hand. **Crash safety for published pieces came back server-side instead** — see §5a. The one case that still loses words is an edit that never reached the server at all (offline, or a crash inside the debounce window); the sheet only promises safety once a version save has actually landed, and says "these edits haven't reached the server" otherwise.
- **Two tabs can't silently overwrite each other.** Every save carries `base_updated_at`, the `updated_at` the open copy was loaded from; the action updates only if the row still matches (`UPDATE … WHERE updated_at = base`), so a save against a version that moved is rejected as a **CONFLICT** rather than clobbering it. The sheet then offers **keep both** — your version becomes a separate draft copy and the editor reloads the server's. A second tab on the same fragment also gets a heads-up via the Web Locks API. This is the one piece of the offline work that survived it, because the hazard it guards is fully online.
- **Publishing is a deliberate act behind a dialog.** The primary bar button is **Publish…**, which opens a dialog that collects the last-mile metadata *and* confirms: **slug** (auto-from-title, editable), **excerpt** (optional; card blurb, else derived — [data-model.md](data-model.md) §6), **subjects** (the [TagInput](../src/components/TagInput.astro) chip field), and the **posted date** (§ below). Confirming publishes (stamps `published_at`, first time only). A published piece instead shows **Unpublish** (→ back to draft, keeping `published_at`) and **Details…** (reopen the same dialog to edit metadata without changing status). Drafts are visible only to the admin — enforced by RLS, not the UI.
- **Posted date — automatic, override for legacy.** In the normal flow you never touch it: on first publish `occurred_at` (the public posted date) is set to the publish moment automatically. The dialog has a **"Set a custom posted date"** toggle revealing a `datetime-local` — used only to backdate the retrofitted 2023 essays. See [data-model.md](data-model.md) §6 for how `occurred_at` relates to the system timestamps `created_at` / `published_at` / `updated_at`.
- **Read time:** computed from `body` word count at render; not stored (may cache into `details.reading_minutes` later).

## 5a. Draft versions, and promoting one

**The rule: editing a published piece never mutates the canonical row.** It
writes to [`fragment_versions`](../supabase/migrations/20260730224623_fragment_versions.sql),
and the live essay changes only when a human promotes one. Michael's framing:
*"any number of drafts, and we choose to promote one into the published
version — like a recipe version manager."* See [plan 07](plans/archive/07-revision-history.md).

A version holds **words only** — title, excerpt, body. Slug, dates, status,
subjects and constellation membership belong to the fragment, so promoting
rewrites the piece **without moving its URL** or its place in the sky.

- **`working`** — one per fragment, enforced by a partial unique index. This is
  the autosave target, so it overwrites rather than accumulating a row per
  keystroke. It's also the crash net: the words are on the server within a
  debounce of being typed.
- **`snapshot`** — a preserved past state. Promoting writes one *first*, holding
  the outgoing canonical, so rewriting a piece can never destroy the opening you
  later decide you preferred. **Keep as a variant** turns the current working
  version into one by hand.

**Promote** is the deliberate moment: confirm, the outgoing text is snapshotted,
the version's words become the piece. A promoted `working` version is then
deleted (it *is* the piece now); a promoted `snapshot` stays, because history
keeps. A version identical to what's live can't be promoted — there'd be nothing
to change.

**Resume editing** (**Edit from this**, on a kept variant) is the other way out,
and the panel was a cul-de-sac without it: after a crash you could *read* your
rewrite, but the only move that put it back in the editor was Promote, which
publishes immediately. It loads a version's words into the sheet and nothing
else happens — the fragment is untouched, nothing goes public, and from there
it's an ordinary edit of a published piece, autosaving into the working version
again. **It prompts when that would cost you something.** Editing always resumes
into the single working version, so starting from a kept variant overwrites
whatever the pending rewrite held; resuming the pending rewrite itself is the
same words and passes without a word. The prompt also fires on unsaved edits
sitting in the editor, which the panel's own list can't see.

The **Versions** tab appears only on published pieces (a draft simply edits
itself) and shows the markdown source in previews rather than rendered HTML —
shipping a second sanitizer to the client to preview your own prose isn't worth
it, and the question the panel answers is "is this the version I meant."

**Privacy:** the table has **no `anon` policy of any kind**, only
`fv_all_admin … to authenticated using (is_admin())`. That's deliberately
stronger than "hidden because its status isn't published": an unfinished rewrite
stays unreadable even if a future join forgets to filter, and even during a
promote, when statuses are in motion. Verified 2026-07-30 by reading the table
with the live anon key — empty array, including through an embedded join.

**Retention:** keep everything. At ~125 fragments this is fine for years;
revisit only if it stops being.

## 5b. Notes — the brain dump, and its room

A **note** is a private fragment: a thought that isn't a piece yet. It's a
`status`, not a type, so `note → draft → published` is one linear promotion
rather than a migration between kinds — private thought graduating into public
piece, which is the whole shape of this site. See
[plan 09](plans/archive/09-offline-and-notes.md) Piece 2 for the tier and
[plan 14](plans/archive/14-capture.md) for the room that reads it.

**⚠ The interface around this tier was rebuilt on 2026-08-03, and the reason is
worth keeping.** Notes shipped in July as a *view of the fragment manager*: a
table row per note, with a title column, a checkbox and an open action. But a
jotting has no title, so the room read `untitled, untitled, untitled` and every
thought cost a click to find out what it said. That is a document interface
wrapped around something that is not a document, and it made the tier feel like
an uncomfortable third thing between a piece of writing and a scratch line.

**There are exactly two things now: writing fragments, and brain dumps.**

- **Private by construction.** `fragments_select_published` is an *allowlist*
  (`status = 'published' and deleted_at is null`), so a new tier is unreadable
  by anon with no policy edit and no way to leak by omission. Verified against
  live PostgREST with the real anon key on 2026-07-30 — 0 rows by id, by slug,
  by status, and through the constellation join.
- **One door, from every room.** The **✚** at the bottom-right of every
  Observatory page opens a box that saves itself on a 700ms debounce — shorter
  than the writing sheet's 1200ms, because a dump box is not a document you sit
  in and the pause before *Saved* is the whole reassurance. **＋ New** (or
  ⌘/Ctrl+Enter) parks the thought under its own id and hands over a blank. An
  empty box is never a row. It is a `<dialog>`, so you keep the room you were
  standing in, and there is no title field anywhere.
- **⚠ Both note editors are TipTap, since 2026-08-06 — and until then the ✚
  box was required to be a plain `<textarea>`, forever.** The decision, its
  alternatives and the trade it accepts are
  [ADR-0018](adr/0018-notes-use-the-composer-editor.md);
  what follows is what it means in this room.
  [Plan 14](plans/archive/14-capture.md)
  §4 wrote that rule down for a reason: dictation software types into any text
  field, so voice capture worked for free as long as nothing got clever with
  the input handling. Michael reversed it, having been shown the constraint —
  he wanted the writing sheet's formatting in the box and in the pile, *"even
  though they take up a little bit of UI space"*. So the trade is on the record
  rather than in the past: a `contenteditable` is still a text field and
  dictation still types into it, but it is no longer the *plainest possible*
  one, and it is the first thing to suspect if voice capture ever misbehaves.
  What the rule was protecting is untouched — the debounce, the flush on close,
  and ⌘/Ctrl+Enter are the same code they were.
- **What that buys, and what it costs.** The shared `EditorToolbar` (undo/redo,
  H2/H3, bold/italic/strike, quote, lists, link, divider, image) with the same
  link and alt-text dialogs the composer uses. A dump's body is now genuinely
  Markdown, so the pile **renders** it rather than printing it, and images key
  on `essays/<fragment id>/` — the path a piece uses — because *make it a piece*
  is a status flip on that same row, so a screenshot jotted here follows the
  thought all the way into a published essay with nothing to move. The toolbar
  sits **below** the words on both surfaces, never above: the ✚ dialog has no
  title and a card's text must not shift when you open it.
- **⚠ Both ends read `breaks: true`.** Every dump written before this was plain
  text whose newlines are its shape — an errand list, a stanza. Parsed as soft
  wraps they would collapse into one paragraph and the autosave would write
  that back, so the editors set `breaks` and the pile renders with it. A
  `\`-terminated hard break (what TipTap serializes) and a bare newline (what
  the old dumps hold) both come out as one `<br>`; `src/tests/markdown.test.ts`
  pins exactly that, because the day they disagree the whole pile reflows.
- **⚠ The marks come off on the way out.** A task's title is an `<input>` and a
  log entry's body is a `<textarea>`, so triage strips the syntax
  (`lib/markdown-plain.ts` — dependency-free, because the real renderer must
  never reach the browser). **Add to a piece…** is the exception and appends
  Markdown to Markdown on the server, which is the one destination that wants
  it whole.
- **Its own room, showing the words.** `/admin/notes` renders each dump as its
  own text, newest-touched first, with an elapsed stamp. A pencil puts an
  editor in the card in place — reading is the dominant motion there, so a tap
  while scrolling must not put a cursor (and on a phone, a keyboard) into a
  thought you were only passing.
- **⚠ One editor for the whole pile, moved into the card you open.** The same
  rule the chooser and the piece picker follow, and here it is not just
  tidiness: a room that lists a hundred jottings cannot mount a hundred TipTap
  instances. Its home is outside `#notes-pile`, so a card leaving cannot take
  the room's only editor with it, and each card keeps its Markdown in a hidden
  `<textarea>` — what the four destinations read from a card that has no editor
  of its own. Two consequences worth knowing: leaving a card does its DOM work
  **before** awaiting the save (otherwise the next card's open would race the
  hand-back), and the "did this change?" baseline is what the editor would
  *serialize*, not what the server sent — a plain-text dump re-spells on the
  round trip, and comparing against the server's copy would rewrite every card
  you merely glanced at, bumping it to the top of a pile ordered by touch.
- **⚠ Clicking away closes the card, not blurring it.** A rich editor loses
  focus constantly and legitimately — to its own toolbar, to the link dialog,
  to the alt-text prompt, to the file picker — and every one of those read as
  "you're done here" under the `blur` rule a textarea could use. What means
  done is a pointer landing somewhere that is neither the card nor a window the
  card opened.
- **Four ways out, behind one → chooser.** Reading (a pencil) and discarding (a
  bin) are direct; the four destinations sit behind one control, because they
  are not four questions — they are one question, *what kind of thing is this?*,
  asked once. The menu is a top-layer popover (trap 7) positioned against the
  card that opened it.
  - **Add to the Agenda…** reads the sentence first (§5d) and opens whichever
    sheet the reading calls for — a task or an event — already filled in.
    Saving creates the row and consumes the dump.
  - **Log an entry…** opens a sheet that asks **who** first — the one field a
    profile's log box never needs, because there the person *is* the page. Kind
    and date have honest defaults; there is no defensible default for whose life
    this was, so Save stays disabled until somebody is named. **The row is
    absent entirely when the roster is empty.**
  - **Make it a piece** flips the row to `draft`: same id, same text, same
    history, no copy.
  - **Add to a piece…** picks an existing writing fragment and appends the dump
    to the end of its body as Markdown, then consumes the dump — a pile that
    keeps showing you a thought you have already filed is a pile you stop
    trusting.
- **What can be undone, and the rule behind it.** A task or an entry is a whole
  row, so undo deletes it and restores the dump. **An append cannot be undone**,
  and that is the one exception: reversing it means editing the target's body
  back out, and the writing sheet may have saved over it by then — an undo that
  sometimes silently does nothing is worse than none. It offers the way to where
  the words went instead.
- **Deleted dumps do not go to the corpus trash.** `?view=trash` excludes them,
  as the working list always has, so scratch cannot reappear beside finished
  work at either end. The pile's own undo strip is the way back; after that the
  row survives in the database and in the nightly backup, which is the right
  amount of ceremony for a jotting.
- **No new table, deliberately.** A `captures` table of its own would buy an
  honest model — no slug, no title, ever — and pay for it with a migration and,
  worse, with *make it a piece* becoming an insert-plus-delete across two
  tables. The motion that matters most is free precisely because a dump and a
  piece are the same row at different stages. The slug is minted once on insert
  (the column is `NOT NULL`) and never shown.
- **Where it sorts is load-bearing.** `'note'` was added to the enum **before**
  `'draft'`, because the manager sorts `.order('status')` — so the list reads in
  the same order the pipeline runs. Enum ordering can't be changed later without
  recreating the type.
- **A piece can still be sent back down.** **Make notes** in the bulk bar is a
  demotion, and it stays. What went is *Add ▾ → Note* — a second front door that
  opened a titled sheet for something with no title.
- **Every fragment type can be a note** — a jotted quote is a real thing. But
  constellations can't: `constellations.status` is a plain `text` column, not the
  enum, so the Zod schema is deliberately split into `fragmentStatus` and
  `constellationStatus` in [`_shared.ts`](../src/actions/_shared.ts). One shared
  list would have allowed "a constellation that is a note" and failed only at the
  database.

## 5c. Images in essays

**Until 2026-07-31 a blog post physically could not contain a picture** — the
render path had allowlisted `img` all along, but there was no way to get one in.
See [plan 03](plans/archive/03-images-in-essays.md).

Three ways in, all landing in the same place: the toolbar's **▣** button, a
**paste** (which is what a screenshot actually is), and **drag-and-drop**. The
file picker uses `accept="image/*"`, which is what makes iOS offer the camera.

**What happens to a file**, in [`src/scripts/upload.ts`](../src/scripts/upload.ts):
validated → downscaled to a 1600px long edge → hashed → uploaded with the
**signed-in browser session** (anon key + storage RLS `is_admin()` — not a
service-role path, and it must not become one) → the public URL is inserted as
ordinary `![alt](url)` markdown. The About portrait uses the same helper, so
both uploaders share one set of rules.

- **Path:** `essays/{fragmentId}/{contentHash}.{ext}`. Keyed on the **id**, not
  the slug: ids are minted client-side so this works before a piece has ever
  been saved, renaming never moves files, and a future orphan sweep is just
  "list the prefixes, compare to live fragment ids".
- **Upload-then-insert, not an optimistic placeholder.** A placeholder means a
  `blob:` URL sits in the document, and this editor autosaves 1.2s after you
  stop typing — that save would write `![](blob:…)` to the database, where it
  means nothing. Waiting keeps every state of the document a valid one.
- **Alt text** is prompted on insert and editable by clicking the image. It is
  *not* a gate: empty is a legitimate answer for a decorative image, and
  refusing to insert without it only teaches people to type "image".
- **Captions** have no custom node. An italic line straight after an image is
  styled as one (`.reading img + p em:only-child`) — plain markdown, and the
  round-trip stays intact.
- **No SVG**, enforced twice: `upload.ts` refuses it by name, and the bucket's
  mime allowlist refuses it server-side. An SVG can carry script, and these
  objects get public URLs on our own origin.

**Two properties of the bucket worth knowing**, both verified live on
2026-07-31:

1. **`site` is public, so an image is readable by URL even when the essay
   embedding it is still a draft or a note.** The paths are unguessable
   (fragment uuid + content hash) and that is the entire protection. The
   alternative — a private bucket with signed URLs — would put an expiry on
   every image in every published essay, so this is the right trade, but it is a
   trade.
2. **Deleting an image does not immediately stop it being served.** Public
   objects come back `cache-control: public, max-age=3600` through Cloudflare;
   a probe object still returned 200 (`cf-cache-status: HIT`) after its row was
   gone. Up to an hour, a removed picture is still out there.

**Not backed up.** The nightly dump captures `storage.objects` metadata, not the
bytes — see [backups.md](backups.md).

## 5d. Reading a task out of a sentence

*The parser, [plan 14](plans/archive/14-capture.md) §6. Claude Haiku 4.5, structured
output, Zod-validated — the same pattern as ✦ Suggest with AI
([ADR 0007](adr/0007-ai-subject-tagging.md)), and the same rule: the model
proposes, the person disposes.*

**Add to the Agenda…** on a brain dump sends the sentence to the model and opens
the sheet it belongs in, filled. *"I have an appointment with the dentist every
Thursday at 4:00 p.m. Please warn me one day ahead. This is a very important
task! And leave a note that I should bring a gift every single time."* becomes a
task titled *Appointment with the dentist*, due the coming Thursday at 4:00 PM,
repeating weekly, warning one day ahead, at high priority, with the gift as its
notes.

**Why a model rather than a date library.** `chrono` handles *"tomorrow at
4:30pm"* and falls over on *"warn me three days in advance"* and *"every third
Monday"* — those are not date parsing, they are this system's own concepts. And
separating a task's **title** from its **scheduling words** is exactly what a
language model is good at and a regex is not.

### What makes it safe

- **The output schema is the system's own enums.** `recurrence` is
  `z.enum(PRESETS)`, so the model **cannot** propose a schedule the database has
  no way to store. Asked for *"water the plants every three weeks"* it returns no
  recurrence and says *"can't schedule that: every three weeks"* — the failure
  where a parser invents a rule and something downstream rounds it to the
  nearest one is closed by construction, not by review.
- **Every filled field carries the words it was read from.** *"2026-08-06 — read
  from 'every Thursday'"* can be judged at a glance; a date on its own cannot be
  judged at all, and a silently misparsed date is worse than no parse.
- **Today and the timezone are passed in**, from `localToday()` over the
  `settings` table — never the browser, never the server's clock. *"4:30pm
  tomorrow"* is meaningless without both.
- **It never makes triage worse by existing.** No key, a dead model, a slow
  network: the sheet opens anyway with the first line as the title and the rest
  as the notes, which is exactly what shipped before the parser. No error is
  shown, because nothing is wrong.
- **Three contradictions are settled in code, not asked of the model**, because
  each one is arithmetic and each was seen to fail live: a weekly rule whose
  weekday disagrees with its date; an *event* carrying a repeat or a lead, which
  `events` has no column for; and a repeat with no first date to anchor it.

### Which row it picks, and why that is not the router §4.21 banned

**[10-hq §4.21](plans/archive/10-hq.md) forbids a model deciding what a captured thought
IS**, and the recorded reason is that a router's failure is *silent* — a thought
filed as the wrong kind disappears into the wrong room. **That ban stands** for
task vs log entry vs piece.

Event vs task is the one pair it does not reach, for a structural reason:
**events and tasks share every surface.** Both render on the calendar grid, both
appear on Today. A wrong guess is the wrong *shape* somewhere you are already
looking, never a disappearance. And most of the call is capability rather than
taste — a repeat or a lead **cannot** be an event.

So the model picks, and the **kind bar** at the top of the sheet says which and
why, with the other shape one tap away. The switch carries the whole reading
across rather than asking again. **The reason on that bar is derived from the
fields, never written by the model**: asked to explain itself, it justified a
correct answer with a repeat the sentence never mentioned and its own fields did
not contain.

**The line it does not remove:** the same appointment phrased two ways can land
in two different rows — *"dentist appointment Thursday at 4pm"* is an event,
*"dentist every Thursday, remind me"* is a task. Both are right, and the second
is the only one the database could hold. The decision does not disappear; it
moves out of your head and into the sentence, where the bar can show you what it
did with it.

## 5e. Proofread — the mark on the word

*Plan 22 (local working notes), shipped 2026-08-07. Claude Haiku 4.5, structured output, Zod-validated — the third tenant of `ANTHROPIC_API_KEY` and the same rule as its two siblings ([ADR 0007](adr/0007-ai-subject-tagging.md)): the model proposes, the person disposes.*

**Press *Proofread* in the writing sheet's ⋯ menu; three spans pick up a mark; click one for `thier → their` with Fix it / Ignore.** It is deliberately **an explicit press and never automatic** — it is a paid call, and the composer's whole contract is instruments that do not act on their own.

**What it is allowed to say.** Typos, a missing or duplicated word, subject–verb or number disagreement, and punctuation that is plainly wrong. **Nothing stylistic** — not word choice, not sentence length, not comma preference, not fragments, not starting a sentence with *And*. That constraint is **structural rather than a plea in the prompt**: every fix must carry a `kind` from a five-value enum, so an observation about tone has nowhere to go. Returning nothing is a normal and correct answer.

- **The marks are DECORATIONS, never document steps**, and the first reason alone settles it: a draft autosaves 1.2s after you stop typing, so a mark that was a document change would dirty the piece and arm that timer — three marks, three saves, for a highlight. It also keeps `getMarkdown()` clean and leaves the undo history alone, which is what makes **⌘Z the undo for Fix it**. They map through transactions, so a mark stays glued to its word while you type above it — and **edit the text under one and it drops itself**, because it is pointing at words that no longer exist.
- **Tinted with the accent, not a red underline.** Chrome's own squiggle is already on and already under half these words.
- **The title is proofread too and reports in the chip**, not in the document: an `<input>` holds no decoration. That is also why the action takes **two fields rather than one string** — concatenating them would throw away which field a fix belongs to at the one moment it is free to keep. Its fix opens the same popover, anchored to the field, and **stays open afterwards**: assigning `.value` does not enter the browser's undo stack, so leaving `thier → their` on screen is the only record of what changed.
- **It is a ⋯ menu item, not a fifth button in the command row** — that row is measured territory (§5), and adding one there was the change that would have pushed it back to scrolling. ⚠ **Its presence makes ⋯ permanent**: `syncMoreMenu` hides the whole menu when nothing behind it is visible, and on a plain draft that was all four items — so the trigger would have been unreachable in exactly the state you press it in.
- **Opt-in per editor** (a `proofread` option, the same shape as `images`). `mountRichEditor` has five callers, and the capture ✚, the interest notes and the three About-builder editors get none of this.
- **Over 20,000 characters it says so rather than slicing.** A proofread that quietly skipped the last third is precisely the failure this feature exists to prevent.

⚠ **The truncation guard is the load-bearing bit, and it is the reason this is not a copy of `suggest-subjects.ts`.** A response cut off by `max_tokens` **does not throw** — `parsed_output` comes back null, which that file absorbs with a `?? {…}`. Copy that shape here and a long piece reports *"nothing caught"*: a clean bill of health on the essay most likely to hold a typo. So `proofread.ts` checks `stop_reason` *and* a null `parsed_output` and throws `IncompleteProofread`, which the action reports in its own words — **"it came back half-finished" and "it never answered" are both zero fixes and mean opposite things.**

⚠ **The two AI calls were deliberately not merged**, though they read the same essay. The saving was about ten cents across the whole corpus, and sharing would have cost the feature: `suggestSubjects` sends `getMarkdown()`, so every `before` would come back carrying `**` that does not exist as characters in the ProseMirror document, and **every position would be wrong**. This call sends plain text, so the model and the document read one alphabet — and the text sent is built by the same walk that later locates the fix, which is what keeps them agreeing. The locator renders every inline leaf as exactly one character, because `textContent` skips leaves while positions advance past them: one hard break above the typo would otherwise shift every mark after it.

## 6. Songs — what auto-fills, what doesn't

Paste a Spotify **track or album** URL, or a **YouTube video** URL. The id and the kind both come from the URL, which stays the single source of truth (no hidden id field to fall out of step). What we store in `source_url` is the *canonical* form, so Spotify's `?si=` share token never reaches a public page. Playlists are deliberately *not* songs — a playlist is a constellation's `score_url` (§`constellations`, [ADR 0009](adr/0009-music-three-roles.md)).

**Two tiers of lookup, and the first one is new (2026-07-31, plan 04 Piece 4).**
`src/lib/media.ts` tries the **Spotify Web API** and falls back to keyless **oEmbed**:

| Field | Source |
|---|---|
| `title` (song) | **auto** — Web API `name`, or oEmbed `title` |
| `attribution` (artist) | **auto** from the Web API (`artists[]` joined) — *was manual until Piece 4*. Still editable, and worth editing: a five-artist track joins to a credit list, not an attribution. |
| `details.album` | **auto** from the Web API — *was manual* |
| `details.release_year` | **auto** from the Web API — the *album's* year, kept distinct from `occurred_at` |
| `details.spotify_artist_ids` / `spotify_album_id` | **auto** — exact ids, so provenance isn't name-string matching |
| `details.spotify_id` / `details.youtube_id` | parsed from the URL — **auto** |
| artwork / embed | **auto** (the stanza embeds at 152px for a track, 352px for an album — Spotify's own numbers; a YouTube video is a 16:9 box) |
| `body` (the public note) | **manual, and usually empty** — see below |
| `occurred_at` (added) | manual; usually `year` precision (provenance — when it entered his life) |

Autofill only ever writes into an **empty** field — merge, never replace — so a correction you typed survives re-pasting the link.

**Two notes, split by audience** ([ADR 0031](adr/0031-a-song-carries-a-feeling-not-an-idea.md), 2026-08-11). Both are short-form editors (bold/italic, the same one the quote body uses — `mountMiniEditor`), both live on the song sheet's **Notes** tab, and both are optional:

- **A note anyone can open** → `fragments.body`. ⚠ **It renders nowhere since [ADR 0035](adr/0035-a-set-is-a-listen-you-can-take-away.md)** — the music room behind whose **†** it appeared is gone, and one song in 48 ever carried one. Kept on the sheet; retired from the page.
- **A note for Michael** → `fragment_private_notes`, admin-only in RLS *and* revoked from `anon` at the privilege layer. Where a song came from, the week it belongs to, what to listen for at 2:41. It is never rendered on any public surface.

⚠ **This replaced "Why this one", and the rename is the whole point.** [ADR 0009](adr/0009-music-three-roles.md) gave a song `body` as an annotation — the sentence on *why this song* — and in seventeen days one song in forty-eight used it. What it was used for was *"I love Janek's playing in the beginning; it really sets the tone for the whole piece"*: an observation, not a justification. The field was mislabelled from the hour it was created, and the label is what kept it empty. Michael, 2026-08-11: *"I don't need to tell you why the music is good. That's violating a really big aesthetic principle of mine — I want to show and not tell."*

⚠ **`saveSong` does not write `body`, and its absence from the row object is load-bearing.** `persist` updates whatever keys it is handed, so a save of the metadata tab would otherwise blank a note written on the tab beside it. `songs.setNotes` is the column's only writer.

**What the Web API costs, stated plainly.** `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`, client-credentials (no user OAuth, no redirect — the redirect URI on the dashboard is required but never used). One token per 3600s, cached in module scope. **The app owner must hold an active Spotify Premium subscription**: Development Mode requires it since Feb 2026, and the app stops working if it lapses. That is a real, ongoing dependency — but it degrades rather than breaks: with no credential, or with Premium lapsed, `lookupSong` falls back to oEmbed and you get exactly the pre-Piece-4 behaviour (a title, and you type the artist). The lookup reports which tier answered, and the sheet says so rather than showing an empty Artist field that looks like a bug.

Also priced in, and all survivable: batch endpoints are gone (single `GET /v1/tracks/{id}` only), search is capped at 10 results, and `preview_url` / audio-features are gone for post-2024 apps — **build nothing on them**.

## 6a. Paired media — the song that goes with one essay

An essay may point at one song fragment through `fragments.paired_song_id` ([ADR 0009](adr/0009-music-three-roles.md)'s third role, built 2026-07-31). It renders at the **head** of the essay, below the title block and above the prose: *press play, then read* — the same invitation a constellation's score makes above its suite, but this one belongs to the piece.

**The player carries no caption** (2026-08-10). It printed `♪ Title — Artist` above the embed until the embed was looked at properly: it already shows the track, the artist, and the artwork, in larger type than the caption used. The one fact the player doesn't know — *this song goes with this piece* — survives as the iframe's `title`, so a screen reader still hears the pairing; a sighted reader gets it from position alone.

Set it in the writing sheet's **Music** tab, or from the song's own Facts tab (§6c) — **two doors, one write path** ([ADR 0034](adr/0034-a-relation-may-be-edited-from-either-end.md)). Like constellation membership it applies **immediately, with no save** — it's a relation, not a field of the document, so pairing can never be the thing that loses a rewrite, and a draft can be paired without touching the publish dialog.

**One field, a query or a link** (2026-08-11, plan 33 §6a). It used to take only a query, so pairing a song that wasn't in the corpus meant stopping, leaving for the Fragment Manager, making it, and coming back to a sheet you'd lost your place in. Paste a link now and it is added and paired without leaving.

⚠ **A second *door* is not a second *write path*, and that distinction is the whole of it.** The panel's old comment said adding a song was the Fragment Manager's job because *"duplicating that flow here would be a second way to write a song fragment"* — right instinct, wrong conclusion. A duplicated **form** would be a second write path; a control calling the existing `saveSong` through the shared `createSong` helper is not. `EntityCombo` set the precedent on the quote sheet, where an author who doesn't exist can be made without leaving; this panel was the outlier that never got it.

Four behaviours worth knowing, because three of them are failure modes designed for rather than discovered:

- **A song already in the corpus is recognised, not duplicated.** Dedupe is server-side on the **parsed** `{provider, kind, id}` — `?si=` share tokens, `intl-de/` paths and `spotify:track:` URIs are all one song, and comparing raw strings would grow a twin for each.
- **A new song shows a create row that previews what the lookup found**, so you confirm rather than trust — including *"artist unknown — you can fix it after"* when the keyless oEmbed tier answered, because a blank artist reads as a bug in the panel rather than as a fact about the lookup.
- **Two failures, two sentences.** *"Spotify track/album or YouTube video, please"* is fixed by pasting something else; *"couldn't reach Spotify or YouTube just now"* is fixed by waiting. Both appear in the list rather than the alert bar, because both are about the text in the field above them.
- **Which round trip to make is decided by `looksLikeLink`**, which knows nothing about Spotify or YouTube on purpose. *"May a song cite this?"* is `parseSongRef`'s question and is answered exactly once, on the server. Discovery lives in the empty state — *"No songs match — paste a Spotify or YouTube link to add it"* — which is the moment the affordance is the answer, and not before.

The new song is created with no subjects, which is correct rather than an omission: a song is not *about* anything (ADR 0031), and since [ADR 0035](adr/0035-a-set-is-a-listen-you-can-take-away.md) there is nothing else to file it under either. What a song carries is the link, who played it, and which essay wanted it.

**Two sources, one shape.** `pairedMediaOf` in `src/lib/blog.ts` normalises them and the renderer can't tell which answered:

1. `paired_song_id` → a real song fragment. 48 of the 50 imported pairings were promoted to these on 2026-07-31 (`scripts/backfill-paired-songs.mjs`).
2. `details.media` → the raw `{ provider, url }` Squarespace brought over. **Only two rows still take this path** — the imported *playlists*, which a song fragment may not cite. It is a fallback, not a second write path: nothing in the app writes `details.media`.

**The branch order is a security property.** If `paired_song_id` is set, the song row is the only truth — if RLS hid it (the song is a draft) or it's in the trash, the answer is *no pairing*, never a fall-through to `details.media`. All 48 promoted essays still carry that legacy column pointing at the same track, so falling through would keep playing a song you had just unpublished.

**Nothing loads in the feed.** Every surface but the permalink renders `PostArticle` inside a `<template>`, and template contents are inert — so a seven-essay page of `/blog` spawns zero third-party frames, and the iframe only starts when the Reader clones it. Measured, not assumed.

## 6b. Where a song enters the corpus

**From the essay that wanted it.** The writing sheet's Music tab takes a pasted
Spotify or YouTube link, resolves it through `songs.lookup`, and offers
confirm-before-create — so a song that does not exist yet never costs you a trip
to another room ([plan 33](plans/33-many-words-for-one-song.md) §6a). Editing one
afterwards is `SongSheet`, opened from a song row in the Fragment Manager
through the `song:edit` seam.

⚠ **THERE USED TO BE A ROOM, AND IT WAS RETIRED WITH THE THING IT EXISTED FOR**
([ADR 0035](adr/0035-a-set-is-a-listen-you-can-take-away.md), 2026-08-15).
`/admin/listening` was built so that adding a song and *sitting with it* were one
act: paste, listen, press the words the track left you with, save, next. The
words were the `feelings` vocabulary, and in seventeen days one song out of 48
was ever tagged. With the vocabulary gone the room had no second half, and
pasting a link is something you were already doing from the essay.

What survives from that design is the rule it was built on and the reason it
died: **no import and no AI.** Michael, 2026-08-10: *"AI can't tell me what I
feel."* The corpus tags **subjects** with a model
([ADR 0007](adr/0007-ai-subject-tagging.md)) because a subject is what a piece is
*about* and that is legible from the text. Nothing about a song ever was — and
since ADR 0031 took subjects off songs too, **no part of a song is
machine-taggable at all.** What is left on one is the link, who played it, and
which essay wanted it.

⚠ **A song is published the moment it is created, and has no draft register.**
The paired player under an essay resolves the song through a policy that
requires it, so a song filed as a draft would go silent under its own essay for
every reader but Michael.

## 6c. Pairing, from the song's side

**A pairing has two doors, and one write path** ([ADR 0034](adr/0034-a-relation-may-be-edited-from-either-end.md)). The writing sheet's Music tab answers *what song goes with this piece?*; the song sheet's Facts tab answers *what am I going to write about this?* Both call the same `songs.pair` against the same column. The second existed nowhere until 2026-08-12, and reaching the first meant closing the song sheet — **which destroys the iframe**, so the only route to the control ended the listening that produced the thought.

**＋ Pair with a piece** opens the `FragmentBrowser` in `mode="pair"`: the same table and filters as the composer's picker, narrowed to **writing** (`songs.pair` refuses anything else) and single-select. It has no cart, no `Add ▾`, and **opens no editors** — the writing sheet is not mounted on `/admin/listening`, and a row click here pairs rather than opening, because pairing is not curation.

⚠ **The cardinality is not symmetric, and it is why the two doors behave differently.** A writing has at most **one** song (`paired_song_id` is a single column); a song may be paired to **many** writings. So from the essay pairing *replaces*, and from here it *appends into a slot that may already belong to another song*. Picking such a piece **confirms first** and names what it is taking. The steal is possible on purpose — refusing would mean "go to another room to do this" — but never silent.

**The piece that does not exist yet.** Type a title nothing matches and the footer offers **＋ Write about "…"**: one `saveWriting` (no editor — `saveWriting` only demands a title and body when publishing) and then the pair. ⚠ **It creates a `draft`, not a `note`.** A note is a dump of *words* and here there are none — a title, a song and an intention is an empty draft — and the working list excludes notes unconditionally, so a note would vanish from the picker the instant it was made.

**A pairing made before the song is saved is queued** and lands on the first Save, the way **Shared by** queues its ticks. Disabling the control until then was the alternative and it loses for the reason above: Save destroys the iframe, so *"save first, then pair"* is *"stop the music, then pair"*. The piece created by the footer is **not** queued — it is written immediately, because a thought you have named should not be lost by dismissing the sheet.

## 7. Quotes

Mostly manual, all light. No external calls. Subjects and the "added" date as for songs.

**Three facts, and a line derived from them** (2026-08-05; specified in `docs/plans/17a`). The only thing you type that a reader sees is the quote itself.

| The form asks | Stored as | Who sees it |
|---|---|---|
| **Quote** — required, and the only required field | `body` | everyone |
| **Who said it** — a person, **Me**, or blank | `author_id`, or `is_self`, or neither | leads the line |
| **From what** | `work_id` | the reveal, and filing |
| **Where in it** — free text, *"the reference exactly as you'd say it out loud"* | `details.citation` | the reveal — unless there's no Who, in which case it **is** the line |

`attribution` is **derived, not asked for**: the sheet previews it live (*Shows as* / *Behind it*) and `saveQuote` computes it server-side from the three facts above. A `change` control reveals it as a per-quote **override**, which is the exception rather than the thing you fill in every time — applied to all 76 live quotes, the rule reproduces what Michael had typed by hand on every one, so the override currently has no users.

⚠ **Seven fields became three.** `source_title`, `source_author`, `work_year` and `page` are gone from the form and from `details` — three of them were duplicates of data that already existed in `works`, and the one labelled *"shown after the attribution"* was shown in exactly zero places a reader could reach. That mismatch was the whole complaint: *"do I put attribution first, or do I put the work? Do I have to put the source title again?"*

⚠ **Attribution is no longer required**, and silence now means two different things. **Me** silences the line because on your own site your own words are the default voice — the essays don't sign themselves either. *Nothing known* silences it because there is nothing to say. The list tells them apart where the citation would go: **`your words`** / **`source unknown`**, muted italic, so neither reads as a row you forgot to finish.

## 8. Subjects (tags), inline

Subjects are created **on the fly** from a typeahead in any editor — type a subject; if it doesn't exist, saving creates it (slugified) and links it. No separate management chore up front. A light subjects-management screen (rename/merge) is deferred until the tag set is big enough to need grooming.

Subjects are the orthogonal axis to constellations ([data-model.md](data-model.md) §1): a subject is what a fragment is *about*; a constellation is a *way of seeing*. Only subjects are in this phase.

**Provenance — authors & works (the query axis).** Distinct from subjects (*what* a piece is about), authors and works record *where* it comes from: `fragments.author_id` / `work_id` → the `authors` / `works` tables. On a quote they are the **Who** and the **From**, and the shown line is derived from them rather than typed beside them (§7). That is what lets *all Bible verses* group under one work **"The Bible"** while each still displays its own book+verse — and it is no longer a special case, just the rule applied to a work with no author. In the quote editor they are [`EntityCombo`](../src/components/admin/EntityCombo.astro) fields; on the list toolbar they're filter dropdowns (pick "The Bible" → every verse). Songs derive them from artist/album automatically.

⚠ **A work that belongs to nobody is offered from every state.** The Work list is otherwise scoped to the chosen author — you can't pair an author with someone else's book — but that rule simply does not apply to The Bible, which is nobody's. It used to be excluded twice over, so from several states there was **no way** to file a verse under the work it belongs to, and the only path forward was to type "The Bible" again and create a duplicate. One row in the corpus still bore that scar until the 17a migration.

**The combo's cap is honest** (2026-08-04). It renders up to 200 rows and, past that, says how many it left out (*"50 more — keep typing to narrow this down"*) as a final non-selectable row. It used to stop at 50 in silence against 70 authors, so a third of them could not be reached by scrolling and the list simply ended — and a list that ends looks exactly like a list that is complete. Matching also folds accents (typing `marquez` finds *Márquez*) and ranks prefix matches above mere substring hits, so the top row — which is what Enter takes — is the one you meant. **Folding is for finding, not for identity:** the exact-match test still compares unfolded, because this control's contract is that you either pick something that exists or explicitly choose *＋ Add*, and folding identity would quietly make "Marquez" un-creatable beside "Márquez". *＋ Add* is pinned to the foot of the menu so a long list can't push it below the fold.

⚠ **The expensive half is still unbounded and that inversion is known.** Every author and every work is serialized into a `data-options` attribute on every page that mounts a sheet, whether or not you open it. Rendering rows is the cheap half and it was the one with the hard cap. The fix is an endpoint the combo queries on a debounce through its existing `setOptions()` — deferred deliberately, because at 70 authors and 49 works the payload is a few kilobytes and local filtering is instant. The reads that build it now state their PostgREST ceiling explicitly rather than inheriting the silent 1000-row default.

**Library (`/admin/library`)** also carries **Export corpus** — the whole database as one JSON file, for the day you leave Postgres rather than for disaster recovery (which the nightly dump already covers). See [backups.md](backups.md). It grooms the three cross-cutting vocabularies: **subjects** (with definitions — the taxonomy the AI reads), **authors**, **works**. Each row: edit in place, **merge** a duplicate into another (reassigns links, deletes the loser), or **delete** (FK-safe — `on delete set null`/cascade means a fragment is never orphaned). Usage counts show what's safe to remove.

⚠ **ONE SEARCH OVER ALL THREE TABLES, added 2026-08-18** (plan 42 · §4.B.2). Roughly 106 rows across three vocabularies, and until then this was **the longest list in the building with no way to find a row** — on the page whose entire purpose is *find the duplicate, then groom it*, while a filter appears at eight rows in a picker inside a sheet. **Not one box per table**: a half-remembered name could be an author or a work, and three boxes make you guess the table first, which is the thing you came here without. A vocabulary with no hit **hides itself, heading and all** — the roster's rule, and its count stays truthful because it counts what exists rather than what is showing. ⚠ **No threshold here**: `FILTER_THRESHOLD` guards a picker scanned mid-decision; this is a page you opened in order to search.

⚠ **THE FEELINGS PANEL WAS HERE AND IS GONE**
([ADR 0035](adr/0035-a-set-is-a-listen-you-can-take-away.md), 2026-08-15). It
groomed a fourth vocabulary — what a song *does to you* — retired after one song
of 48 was ever tagged. Its 54 words are recorded in the drop migration.

**One rule from it outlives it, and applies to any vocabulary added here.** A
feeling's slug was **frozen** while its name stayed renameable, because the slug
went into a public URL people send each other and moving one hard-404s every
link already handed out. That produced a collision name-uniqueness cannot catch
— rename `regretful` → `remorseful`, and a new `regretful` passes the name check
while wanting a slug the renamed row still owns — which was **refused rather
than suffixed to `regretful-2`**, because a numbered twin is a second invisible
shelf with the same name on the front. If a future vocabulary's slug ever
reaches a shareable URL, it needs the same three rules.


⚠ **The delete confirm names what it is about to take, and the shelf is the reason.** "Fragments themselves stay — only this label and its links are removed" was true and still misled: one of a *work's* links is somebody's `person_works` row, and the note written on that shelf goes with it by cascade. The dialog now counts against `fragments` **and** `person_works` first — *"12 fragments cite this work; 2 people have it on a shelf, one with a note"* — and its reassuring tail changes when it stops being the whole truth. Refusing the delete was considered and rejected: a curation tool that will not let you remove a duplicate because somebody once shelved it is a puzzle rather than a tool.

**Source of truth for definitions:** the **database** (`subjects.definition`) is now runtime-canonical — it's what `/admin/library` edits and what the AI suggester reads live ([ADR 0007](adr/0007-ai-subject-tagging.md)). `scripts/reflections-subjects.json` (mirrored to `src/lib/subjects.ts`) is only the original **seed** used by the import scripts; new or edited definitions live in the DB, not that file. Don't treat the JSON as authoritative after seeding.

**✦ Suggest with AI.** Each editor's subject field has a button that sends the fragment's text + the taxonomy (names **and** definitions, read live from the DB) to **Claude Haiku 4.5** and pre-fills the tag input with the existing subjects that apply (capped at 3). The human stays in control — suggestions are ordinary editable chips, and they **merge** with what you already typed rather than replacing it. If the model proposes a *new* subject it appears as a distinct "New subject: X — Add it" affordance that must be **explicitly accepted** (accepting just drops the name into the field; `syncSubjects` mints it on save). Runs server-side ([`suggestSubjects` action](../src/actions/fragments.ts) → [`src/lib/suggest-subjects.ts`](../src/lib/suggest-subjects.ts)) with `ANTHROPIC_API_KEY`; structured output (`zodOutputFormat`) pins picks to the real taxonomy. Absent key → the button degrades to an inline "not configured" message; manual tagging is unaffected. Cost ≈ $0.0015/call.

**Two types** — `kind: 'quote' | 'writing'`, branched on nowhere but the system prompt. One implementation: [`SubjectsField.astro`](../src/components/admin/SubjectsField.astro) renders the control and [`subject-suggest.ts`](../src/scripts/subject-suggest.ts) wires it, so the call sites can't drift. What differs between them is only **what text there is to read**:

- **Quote** — the quote itself. Refuses when empty.
- **Writing** — title + the **whole body**, in the publish dialog, which is where writing subjects are actually edited and where the preflight is already saying "no subjects". Not an opening slice: measured against the corpus on 2026-07-31, 51 pieces run to a median of 6,107 characters and a maximum of 14,131, against the action's 20,000 cap — so a "first N words" budget would truncate the top decile to save nothing.
⚠ **THERE WAS A THIRD, AND ITS ABSENCE IS THE AI BOUNDARY THIS CORPUS DRAWS** ([ADR 0031](adr/0031-a-song-carries-a-feeling-not-an-idea.md), 2026-08-11). A song had one, and it required the annotation before it would run, because metadata alone yields *"jazz, 1950s, modal"* — true, useless, and not what this taxonomy is for. **A song has no subjects at all now**: a subject is what a piece is *about*, and a song is not about anything you can paraphrase; the one time this corpus filed one that way it produced `jazz`, a genre alone in a taxonomy of words about living.

What a song did to you was a **feeling**, and a feeling is not a property of the song — *it is what happened in Michael*, which no model has access to. So there was never a `suggestFeelings` beside this, and the vocabulary itself is gone ([ADR 0035](adr/0035-a-set-is-a-listen-you-can-take-away.md)). **No part of a song is machine-taggable**, which is a cleaner line than the one it replaced.

**Always an explicit press, never automatic** — it's a paid call, and the publish dialog's contract is instruments that never act on their own. **When it fails, the reason is the reason:** the action used to report every failure as "couldn't reach the model", including a 400 whose body said the account was out of credit. It now surfaces the API's own message (admin-only, so that's safe) and logs the rest.

## 9. Installing the Observatory (phone & iPad) — and why it's not optional

**The Observatory is installable to the home screen; the public site is not.** Only
[`AdminLayout`](../src/layouts/AdminLayout.astro) carries a manifest
([`public/workshop.webmanifest`](../public/workshop.webmanifest)), so readers are
never offered an "install" they'd have no use for.

**Why it exists — and it has changed twice.** It was built to earn a specific
guarantee: Safari deletes script-written storage after **7 days without a
visit**, and home-screen web apps are exempt, so installing was what kept the
writing sheet's offline outbox alive between sessions. **That outbox was removed
the following day** ([ADR 0010](adr/0010-online-first-writing.md)), and for two
months the install was simply a convenience — its own icon, its own window,
opening straight into Today.

⚠ **It stopped being a convenience on 2026-08-06, and this section said
otherwise until 2026-08-09.** Two capabilities now *depend* on the installed
app, and neither has any browser-tab equivalent on iOS:

- **The number on the icon** (§2c). `navigator.setAppBadge` paints the Home
  Screen icon and the macOS dock; in a tab there is no icon to paint.
- **Web push** (§9a). iOS grants `Notification.requestPermission()` **only** to
  a web app added to the Home Screen — in Safari proper the button cannot work,
  which is why the notifications dialog says so rather than offering one.

So the honest line is no longer "kept because it costs nothing": **the install
is the delivery mechanism for everything HQ says when the app is closed.**

**How, on iOS:** open `/admin` in **Safari** (not another browser) → Share →
**Add to Home Screen** → leave **"Open as Web App"** switched **on**. Since
iOS 26 that toggle defaults to on for every site, and turning it off is what
would forfeit the storage exemption. On Android/desktop Chrome, the install
prompt appears in the address bar.

**Install from `/admin`, not from the homepage** — nothing public links into the
Observatory, so an app that lands anywhere else means typing the URL every time.
The manifest's `start_url` says `/admin` for the same reason; `scope` is `/` so
tapping **Site ↗** stays inside the app instead of bouncing you to Safari.

**What it does *not* do.** There is **no service worker**, and the installed app
still needs the network to **load** and to **save**. Installing buys an icon, a
window, a badge and a push channel — **not offline capability** — see
[ADR 0010](adr/0010-online-first-writing.md) for why that trade was taken
deliberately rather than left as a TODO. ⚠ And registering a worker would now be
actively harmful rather than merely redundant: Safari routes a declarative push
*through* a worker's `push` handler when one exists, so adding one would silently
disable §9a.

**Icons** are generated from the one drawn mark by
[`scripts/build-app-icons.mjs`](../scripts/build-app-icons.mjs) (`node
scripts/build-app-icons.mjs`), which reads `STAR_PATH` out of
[`src/lib/star-mark.ts`](../src/lib/star-mark.ts) so the star is never copied.
It writes the favicon (both formats) and the app icons together — redraw the
mark, re-run it once, and everything follows. The standalone **status-bar tint**
is rendered at dusk and re-tinted by
[`scripts/theme-toggle.ts`](../src/scripts/theme-toggle.ts), so it tracks the
theme you actually chose. *(It followed the system colour scheme until
2026-08-07, which was close enough only while the page did too — see
[ADR 0021](adr/0021-dark-is-the-default-not-the-system-preference.md).)*

## 9a. Push — the tripwire that speaks only on a morning you skipped

*Plan 21 (local working notes), shipped 2026-08-06/07. Schema in [data-model.md](data-model.md) §6b; the decision in [ADR 0019](adr/0019-push-is-a-contract-you-sign.md), which is still **Proposed**. This is the only thing in the building that acts while nobody is looking at it.*

**The control is a bell beside the theme toggle and Sign out**, not a nav item. Those three are the controls about *this device and this session* rather than about the corpus, and push is subscribed **per device** — so "on" here never means "on everywhere". It opens a dialog rather than a `/admin/settings` room, deliberately: there is no settings room in this building (`home_timezone` has never had a UI), and one switch does not justify a ninth item in a nav whose whole argument is that it is short.

**The dialog has four states written as `data-state` on its root**, with every paragraph rendered at once and revealed by CSS — the states *are* the content of this surface, so a reader (and a future edit) sees all of them. ⚠ **Desktop reads *unsupported*, and that is correct rather than broken:** `window.pushManager` is WebKit's declarative-push entry point, and Chrome and Firefox expose push only through a service worker registration, which [ADR 0010](adr/0010-online-first-writing.md) and §9 rule out. An unset `PUBLIC_VAPID_PUBLIC_KEY` gets its **own** state naming the variable — folding it in with *unsupported* once made a deployment fault wear a device fault's clothes and told an already-installed iPhone to add itself to the Home Screen.

**The condition is the whole feature.** The push fires only when the check-in is still unanswered at `settings.push_time` — it is a **tripwire, not a reminder**, and the distinction is the design. Michael, 2026-08-06: *"I don't need a reminder necessarily to do my sleep check-in… the notification telling me 'Hey, do your sleep check-in' is noise because I need to already have that ingrained within me."* At 07:00 the check-in is unanswered on nearly every day including every good one, so it would fire ~365 times a year and become the ping you learn to swipe away. At **10:00** it fires on the days the habit actually broke. ⚠ **If it starts speaking most days, the hour is wrong, not the feature** — count the rows in `push_day_claims` before changing anything.

**No service worker is registered, and that is the design.** Declarative Web Push subscribes from the *page* via `window.pushManager` and WebKit renders the payload itself — display, tap-navigation, badge — with no JavaScript woken on the device. Proven on the real phone before a line of it was written. The cost is that nothing repairs a stale subscription in the background, so `scripts/push.ts` re-asserts on **every admin load**; that is the entire upkeep strategy (§6b of [data-model.md](data-model.md)).

**Turning off deletes the row *before* retiring the endpoint**, and the order is a reliability argument rather than a style preference. The sender can only reach an endpoint it has, so deleting the row is what stops the notifications; if the browser call then fails you are left with a dead endpoint nobody pushes to. Reverse it and a failure leaves a live row for an endpoint the browser already retired — **silent, and it fails open**, which on this feature means a phone that keeps ringing.

⚠ **Every failure mode of this feature is silent, and that is what to know about it.** A wrong schema, a missing secret, a stale key, a Vault entry that never reached the Edge runtime — none of them throw anywhere a person is watching. They just mean **the phone never rings on the morning it should**, which is indistinguishable from *"nothing was waiting"*. Three real ones were found and fixed on the day it shipped: a failed send *burned the day's single claim* (it now releases when it reached nobody); a `dry` run claimed the day, so a diagnostic silenced the real tick an hour later; and the missing-key case above. The sender is a Supabase Edge Function with hand-rolled RFC 8291/8292 crypto on `crypto.subtle` — no dependency, portable enough to have been driven from a laptop against the real phone before it was ever deployed — and it authorizes on its own `PUSH_CRON_SECRET` rather than `verify_jwt`, because *any* valid JWT satisfies that check, including the anon key printed in the client bundle.

## 10. Deferred (not in admin v1)

- ~~**Constellation placement + composed ordering**~~ — **shipped 2026-07-23** with the composing room (§2: composer + fragment browser).
- ~~**Spotify Web API metadata** (auto artist/album)~~ — **shipped 2026-07-31** (§6). Client credentials, oEmbed kept as the fallback. It carries an ongoing dependency the other integrations don't: the app owner must keep Spotify Premium, or lookups quietly drop to the oEmbed tier.
- **Subjects management UI** (rename/merge/delete-with-reassign) — §8.
- ~~**Revision history / timeline**~~ — **shipped 2026-07-30** as draft versions (§5a), and it arrived by a side door: history stopped being a feature to build and became a *consequence* of how editing a published piece works. What is still deferred is a **diff view** — side-by-side preview is enough for one author.
- **Bulk import tooling** beyond paste (quote capture) — [architecture.md](architecture.md) §6.5. *Batch Spotify is off the table, not deferred:* Spotify removed the batch endpoints for Development Mode apps in Feb 2026, so it's one request per track now.
- **`/listening`** — songs have no public surface of their own (no permalink, no `/blog` view); they appear only as stanzas inside a constellation. Plan 04 Piece 5.

## 11. The morning check-in

*The first HQ surface. Schema in [data-model.md](data-model.md) §6b; the boundary it sits behind in [ADR 0012](adr/0012-hq-is-a-private-second-domain.md).*

It is the **Morning zone on Today**, pinned first and always present — answered or not. It is deliberately **not a modal and not a wall**: it is a card that dismisses, so the day behind it is reachable in one tap.

**It is not a form you submit.** One row per local date, upserted as you go. A tap saves immediately; typing debounces and flushes on blur. There is no Save button, because the thing a Save button implies — that the answers are provisional until you press it — is false. "Done" only closes the card.

**Four states, all rendered from the same row:**

| State | What it is |
|---|---|
| **ask** | The prompt. One tap to start, one to skip. |
| **fill** | The form, prefilled from the row — or, on today only, from your recent medians. |
| **done** | A compact summary with a pencil back into the form. |
| **skipped** | Explicit, recorded, and reversible. Skipping never wipes answers already given. |

**What it records, and why those shapes**, is in [data-model.md](data-model.md) §6b — the two star scales that must not be merged, the two affect axes that must not become one, and the buckets that are honest where a number would be a guess.

**Four sections, ordered by when you can answer them** rather than by subject: **Dreams**, **The night**, **How it went**, **Naps**. The ordering is done with flex `order`, not source order.

**Dream first.** Recall decays within minutes of waking, while the times and the ratings are just as answerable at 9am — so the perishable field goes where you are most likely to still have it. **Naps last**, because they are the only thing on the card about the *day*: a nap is not answerable at 7am, and anywhere earlier would put an unanswerable question in the middle of a card built to be finished in under a minute. The summary panel carries its own **"Add a nap"** for the same reason — an afternoon must be able to reach the day's record without walking back through a form about last night.

**⚠ "How it went" is one block holding four marks, and that is a layout decision and not a merge of fields.** Quality and Rested stay two columns; Feeling and Energy stay two axes; the reasons are unchanged and are in §6b. What they share is the *control*, so they share the block — four rows of one shape under two sub-labels read as one gesture, where the same four split across two sections read as two more things to get through.

**Three controls, and only three.** Everything on the card is a row of chips, a 1–5 mark with a word beside it, or a native time picker. That is the whole answer to the card's growth: a long card built from three repeating shapes reads as a handful of questions, and the same card built from eleven bespoke ones reads as a form. A new field that needs a fourth control is a sign the field is wrong, not the card.

**And every follow-up is visibly a follow-up.** A tone's strength, a timed waking, "went off around" — each sits indented under an accent rule (`.sub`), attached to the answer that summoned it. The eye then counts four questions that have opened up rather than twenty controls in a column. Drawn for `asleep_at` on 2026-08-05; made the card's grammar on 2026-08-06, when the alternative was a sea of fields.

**Every scale carries a word for its current value** (`low`, `restless`, `wrung out`), right-aligned. Half-awake, a bare position on a track means nothing, and the word is also how a mis-tap is noticed without re-reading the scale. **Stars get no word** — five stars are self-evident. The words are kept short because at 390px the column has about 66px: the intensity scale's honest top value was *"overwhelming"*, which widened the card and was then sheared off by the zone's `overflow: hidden`, silently.

**The one thing it gives back on day one** is a derived line under the times — time in bed, then an estimate of actual sleep and an efficiency once both buckets are answered. It grows as you answer, and it claims nothing before its inputs exist. The browser recomputes it with **literally the same functions** the server renders the summary with; the second copy that used to live in `src/scripts/checkin.ts` is gone, because the one that drifts is the one on screen at 7am.

**A night is not one sleep, and a dream is not one dream** (2026-08-06). The dream tones are **multi-select** — an anxious dream and a distressing one in the same night both survive, each with its own strength, plus one tap each for *"woke me"* (the clinical line between an anxiety dream and a nightmare) and *"had it before"*. One dream is still exactly one tap; a second kind costs the tap it is worth, and "Nothing" stays exclusive because it is the answer that there was nothing to have a kind. And **`Many` gets the same second question `60m +` already had**: it carries a midpoint of thirty minutes, so a night that went three hours asleep → *three hours awake* → two more read ≈7h 15m at 83% against a truth of 4h 45m at 54%. A timed waking replaces that guess, and **"Got up" takes the excursion out of the denominator** — CBT-I stimulus control tells you to leave the bed, and before this, obeying it scored identically to lying there ignoring it. Two more answers arrived with them: **what you took to sleep** (where `Nothing` is a tap and not an empty answer, for the same reason `skipped` is recorded rather than inferred) and **naps**, which were excluded in v1 alongside caffeine and exercise — a grouping that was the mistake, because a nap does not correlate with sleep, it *is* sleep, and no calendar will ever supply it.

**Three times, not two: in bed → woke → up.** Efficiency is asleep over time *in bed*, and time in bed ends when you get out of it — so an hour spent lying there at 5am belongs in the denominator. "Up" is optional and blank means you got up when you woke. **And the top latency bucket asks a second question.** `60m +` is open-ended, so its midpoint is a ceiling rather than a middle: a night awake until 3am scored an hour and a quarter and the efficiency came out about twenty-five points high, on the one number CBT-I actually moves. Picking it reveals *"Went off around"* — a time, because that is the form the memory takes, and the same native picker already on the card rather than a stepper invented for 7am. It is optional, it appears nowhere else on the scale, and the buckets below it are still right: nobody knows whether it was twelve minutes or twenty. Everybody knows when it was three hours.

**Backfill is three days**, reachable only by navigating to a past date deliberately, and **enforced in the action** rather than only in the form. Prefill is switched **off** for a past day: a plausible suggested time on a day you are reconstructing gets confirmed without ever being recalled. Outside the window a date is readable and not editable.

**Times on screen are never UTC.** A project rule, not a detail of this surface: pages render on a server whose clock is UTC, so any date formatted there is UTC unless something says otherwise — and *"Saved 12:41 AM"* in UTC is not a time anybody was awake for. It looks like a real time, which is what makes it worth a mechanism. Every stamp renders a real `<time datetime>` whose server-side fallback is already in the **configured home zone**, and [`src/scripts/local-time.ts`](../src/scripts/local-time.ts) — mounted from the layout, so no page has to remember to opt in — rewrites it into whatever zone the reader's device is in.

⚠ **AND A CALENDAR DATE TAKES THE OPPOSITE TREATMENT, which this rule did not carve out until [ADR 0039](adr/0039-an-instant-and-a-calendar-date-are-different-values.md).** `occurred_at` at day precision is *the day a piece belongs to*, not the moment a row was written — so it is stored as that day's UTC midnight and rendered in **no zone at all**, with no time beside it. Reading it in a zone is what filed a 6pm-Pacific quote under tomorrow, and reading it in the *viewer's* zone is what would show a backdated essay a day early to every reader west of Greenwich. **Both hazards are real; the split is what makes both correct.**

⚠ **That is display only, and the distinction is load-bearing.** The browser may say what o'clock it was; it never says what *day* it was. The day boundary stays server-side on the configured zone, because scheduled work has no browser and a laptop with a stale clock must not be able to move it ([data-model.md](data-model.md) §6b).

**Phone-first**, and that is not a variant — it is the constraint the design was drawn against: under 60 seconds, one screen, thumb-reachable, done half-awake in bad light. Native `<input type="time">` is used deliberately; anything hand-rolled is slower and worse on iOS. The free-text fields sit behind a tap because they are the ones that summon a keyboard.

## 12. People — the roster

*The second HQ room. Schema in [data-model.md](data-model.md) §6b; the boundary it sits behind in [ADR 0012](adr/0012-hq-is-a-private-second-domain.md).*

Two surfaces: **`/admin/people`**, the roster, and **`/admin/people/[slug]`**, one person's profile. Adding and editing happen in a shared sheet.

**The roster is grouped by circle.** Not alphabetical, which is a contacts app answering a question he does not have; and **not drift-first**, which would greet him with mild accusation every time he opened the room. That would violate HQ's own principle — *absence never accumulates*, and an observation is never a verdict. Above the sections sits a **coming-up rail** carrying what is actually actionable in the next weeks, which is the reason to open the room at all.

**Search appears only above six people.** A search box over four faces is furniture: it takes space and implies the list is too long to read. Past six it filters the cards already on the page rather than asking the server — the roster's ceiling is 50 rows and they are all present, so a keystroke is a DOM pass. A section whose every member is filtered out hides its heading too, because a heading over an empty grid reads as a rendering bug.

**The card is a horizontal photo-beside-text row**, three across on desktop and one on a phone. A vertical photo-above-name tile is the contacts-app shape and leaves the epithet nowhere to live — and the epithet is what makes a roster feel like people. The photo is generous because faces are recognised far faster than names, falling back to a **monogram on a hue wash** taken from the constellation ramp, keyed on the person's id so it is stable and so adding somebody does not repaint the roster. Deliberately left off the card: interaction counts and any cadence progress bar, which turn people into metrics.

**Archiving is the only way somebody leaves the roster**, it is always an explicit click, and it is reversible. Archived people are out of the roster *and* out of search, in a section of their own at the bottom. Nothing is ever archived automatically, however long the silence.

### The profile is a full page, and that is a departure from §3.6

§3.6 retired the standalone writing page in favour of overlays everywhere. **That decision was about editing context** — clicking an essay while composing a constellation threw you out of the room you were working in. A profile has no analogous host: it is a **reading destination** you navigate to on purpose, and it is long and multi-sectioned in a way a sheet would cramp. The rule still holds for the things you *do* here: adding and editing are overlays.

The header is a compact `dt`/`dd` **fact strip** rather than a form-like stacked list — four short facts read faster side by side and wrap cleanly on a phone. **Editing is a pencil on the block it edits**, not a row of buttons in a corner away from them.

### ⚠ No pronouns in any system-authored label

The prototype shipped headings reading *"Who he is"* and *"From him"*, which quietly assumed HQ knows everybody's gender — and would need a pronoun column to keep that promise. **It does not get one.** Every label is neutral: **About**, **Where**, **Known since**, **Last contact**. Pronouns appear only inside Michael's own prose, where he is the author. This is cheap to hold now and expensive to retrofit, since a pronoun column would exist to serve labels that should never have needed it.

### Photos live in a private bucket, and that changes the mechanics

Person photos **cannot** go in the `site` bucket. `site` is `public = true`; listing was closed off later, but objects stay readable by anyone holding the URL, and the unguessable path is the entire protection. That trade is right for an essay's photographs, which are published anyway. It is not right for a friend's face.

So there is a second bucket, **`hq`**, private, `is_admin()` on all four verbs and **no public-read policy at all** — that omission is the point. It excludes GIF on top of `site`'s no-SVG rule, which also means every object in it has been through the downscale path (a canvas keeps one frame of a GIF, so GIF is the one format the uploader passes through untouched).

Three consequences worth knowing:

- **URLs are signed and they expire.** Sign at request time and never bake one into anything cached or persisted. `people.photo_path` stores the object **path**, never a URL.
- **The upload happens after the row exists**, because the path is keyed on the person's id so a rename never orphans a face. Add sheet order is therefore save → upload → point the row at it, and a failed upload leaves you with a created person and a sentence rather than a lost form.
- ⚠ **The nightly archive does not cover this bucket**, and copying the existing step would not fix it. That workflow fetches each object's bytes from its **public URL**; a private bucket has no such URL, so the copied step would archive nothing and the failure would look exactly like an empty bucket. See [backups.md](backups.md).

### The log — the piece that makes the roster pay for itself

*Added 2026-08-03 by 12 · Piece 2.*

Every personal CRM dies the same way: logging is work and the payoff is years away, so by March the database is empty. The defence is that **logging pays out at the moment of use** — you open a profile before seeing somebody and read what you last knew, **in your own words**. Nothing here generates or condenses that text, and the interface must not imply otherwise.

**The box is open at the head of the timeline, always.** Not behind a button, not in a dialog: *"if logging always costs opening a document editor, the 15-second jots never happen — and the 15-second jots are most of what makes the brief good."* So it is one line tall and grows as you type; every field is pre-defaulted (this person, today, hangout); and the kind/date/people controls stay hidden until there are words, because an empty box already showing three controls is not a box you dash a thought into. `Expand ↗` is the second altitude — same entry, same storage, room for the conversation that mattered.

**A textarea, not TipTap** (2026-08-03, reversing the original plan). Piece 4 puts this same box on Today, and Today deliberately ships no editor bundle so the page opened on a phone at 7am stays light. It stores the same Markdown either way.

**One editor, two jobs.** Editing an entry loads it back into the same box rather than opening a second one — a profile with two places to type is a profile where you have to decide which one to use. Deleting is a hard delete behind a confirm: unlike a person there is no archive to fall back on, and a log entry is only ever removed because it was wrong.

**Saving is explicit, unlike the check-in.** That surface autosaves because it is one row per day you return to; an entry is a discrete thing you finish, and a debounce would turn a half-typed sentence into a row every time the phone locked.

**The date is a date.** Three one-tap options (today / yesterday / 2 days ago), then a real date input, and **no time field anywhere** — nobody recalls that the dinner started at 7:14. Backdating is unlimited: this is *not* the check-in's three-day window, because a dinner three months ago is a memory rather than an invention, and entering a year of history on the day you start is a feature. The future is refused.

**What the log gives back:** *Last contact* joins the profile's fact strip — a derived fact sitting in the same row as the stored ones, because they look identical to a reader — and the roster gains a last-contact line on every card, **sorted by last interaction, descending**. That is §3's *information without accusation*: people you are actually in touch with float up and drift sinks on its own. Somebody with no entries reads **"No entries yet"** and sorts last, because they are **new rather than neglected**.

### Shared — the one seam with the corpus

*Added 2026-08-03 by 12 · Piece 3.*

Everywhere else the boundary is absolute: HQ data never becomes corpus data, and a log entry is never promoted into an essay. **Shared** is the exception, and it leaks in one direction only — it renders public rows on a private page, never the reverse. The link rows carry no `anon` policy, and no public route touches the tables at all.

**A work is the link that keeps paying.** Link somebody to a book once and **every quote carrying that `work_id` appears on their profile — including ones added years later**. That is why the link routes through `works` rather than tagging each quote: hand-tagging gives the same page today and a stale one in a year. The row is a `<details>`; the quotes are one tap below it, not behind a navigation, because the thing asked for was *"on their profile I want to see the quotes from that book."*

**A fragment is the direct edge**, for what that path cannot reach: a song somebody sent, a line they said out loud that never came from a book. A fragment reachable **both** ways appears exactly once — under its work, carrying the direct link's note — because the same row twice reads as a rendering bug.

**Both directions get UI.** From a profile, the ＋ opens a two-mode drawer; from the quote and song editors, a collapsed **Shared by** field. And when you search the corpus for a line somebody said and find it is not there, the sheet offers **"Add a quote from them →"**, which opens the fragments room with the quote sheet already attributed. That is a real link rather than an overlay: the quote editor is TipTap, and the profile deliberately ships no composer bundle.

**Unlinking lives inside the fold**, one tap into the expanded row rather than on the summary. Two reasons, and the second is load-bearing: removing a link is deliberate and has no business under the cursor while you are only reading, and **a `<button>` inside a `<summary>` is activated by the same click that toggles the `<details>`** — so an unlink control on the summary row would open or close it every time.

**A trashed fragment leaves the shelf; its link row survives.** Restoring the fragment restores the attribution. Losing it silently on a trash-then-restore is the kind of quiet data loss this database cannot survive.

### Drift — the observation, never the verdict

*Added 2026-08-03 by 12 · Piece 4. This is the piece that pays the logging back.*

**Cadence is one year, on by default, for everyone**, overridable per person. A year is long enough that being told is a favour rather than a scold, and at 25 people it surfaces a handful rather than a wall. The same design would not be defensible at 30 days.

It shows in exactly three places, and never as arrears:

- **On the card**, the last-contact line **shifts weight and darkens**. Nothing else changes — no badge, no count, no red, no progress bar. The person is already named once in the panel above; this exists so that *scanning* a section still tells you, not so drift is announced twice.
- **On the roster**, a **"Been a while"** notice panel above the circle sections. Warm, not red, because it persists until acted on and a permanent red marker becomes wallpaper you resent — and **deliberately not card-shaped**, so it can never read as a second section of the directory. It is an observation *about* the roster, not part of it. It renders a **duration** (*"over a year ago"*), never a date, with the exact day one tap away.
- **On Today**, the same panel **capped at three**, most-drifted first, with a count and a door to the room. Never a fourth row: the roster is where the full list lives, and Today is a nudge rather than an inbox.

**Ordering is by how far past their OWN cadence, not by raw days.** Somebody on a six-month cadence at seven months has drifted further than somebody on a one-year cadence at eleven, even though the second number is bigger — and sorting by days would silently override every cadence set by hand.

**Two dismissals, both on the row**, because a notice you cannot clear from where you are reading it is a notice you learn to scroll past:

- **Reached out** writes a real interaction dated today. Not a hidden flag: a `last_reached_out_on` column would be a *second* source of "when did I last make contact" sitting beside the one everything derives from. The honest cost is that the entry's words are the system's — it is editable and deletable like any other, which is the way back.
- **That's fine** mutes for another full cadence, counted **from today**. Some relationships genuinely *are* annual. The count of mutes accrues for a rule that cannot fire before 2028; see [data-model.md](data-model.md) §6b.

**⚠ What deliberately does *not* reset the clock: editing the person's record.** If fixing a typo silenced a one-year notice, the feature would be defeated by the most trivial possible action — and silently, so you would never know it had happened.

**⚠ Both guards are live.** *Drift requires at least one logged interaction* has always been enforced; *anyone with an event today is never drifting* needed an events table and closed with §15's calendar, as one more clause in the same derivation.

### The brief — logging pays out at the moment of use

*Live since the agenda landed; see §16.* When somebody you have tagged on an event is on today's calendar, Today's People zone leads with **what you last knew about them** — their last contact as a duration, the last log entry **in your own words, verbatim**, the newest thing on their shelf, and their birthday.

**Four lines, four sources, labelled as such.** They are four different queries about four different things, and an early prototype ran them together as one bullet list — which read as a system-written summary of the friendship, the single worst thing this surface could be. The labels are what stop the page implying it understands anything.

**What is absent stays absent.** A person with no logged entry gets no *Last contact* line and no *Then* line rather than "never" — the same guard drift keeps. A brief with nothing to say is reduced to a name, a time, and **Log an entry**, which is the one thing you can do about it.

**It caps at three**, and the cap is applied before the history is fetched: a dinner party of nine must not cost nine people's history to render three briefs. The drift guard is deliberately *not* computed from the capped list — a guest the cap dropped is still someone you are seeing today.

---

## 13. Tasks — the agenda's first surface

*Schema in [data-model.md](data-model.md) §6b; the principle it is built to enforce in [ADR 0013](adr/0013-absence-never-accumulates.md).*

**`/admin/agenda/tasks`**, with a `<dialog>` sheet for writing one down. **Personal only** — work lives on the company's platform, which is what removes the pressure that turns a personal task list into project management. Deliberately excluded, and each is where one goes to die: sub-tasks, dependencies, tags, time-blocking, contexts, energy levels.

**The list is grouped by when: `Past due · Today · This week · Later · Unscheduled`.** Past due is **first here — the opposite of Today**. That looks like an inconsistency and is not one: both rooms order by time, and arrears are chronologically first. Today is a summary you read forward, so meeting them last is right there; this room is where triage happens, so meeting them first is right here.

**Nothing on the page counts what is owed.** The number beside a heading says how big a list is; *"6 overdue"* would be a verdict about a person, on a page that can be opened at 7am on a bad morning.

**Effort is drawn as a magnitude, not a category** — a four-step meter plus the word, filled to the step, because effort is *ordered* and four identical chips throw that away. The ramp is the agenda's own amber at four densities: an intensity ramp **inside** the domain colour, so no fifth colour meaning enters the system and red still means only one thing. **Priority is prominence, and prominence is not colour**: `high` sets the title in bold, `low` mutes it, and neither ever borrows the urgency axis.

### Answering for something

**A task ticks off in place and stays.** One click, no menu, no dialog; it sits there struck through until midnight and the same click undoes it. A task that vanishes gives no sense of progress and no way back from a mis-tap.

**A past-due row carries the choice instead of a circle:** **Did it** / **Skipping it**, with icons rather than two same-shaped text chips, because this is the one control that has to be answerable at a glance. There are two honest answers to something that has gone past its date, and a tick beside a *Did it* chip is two paths to one outcome while saying nothing about the other.

**Both answers are recorded and both advance the schedule.** A skip is an answer, never inferred from silence — a day the app was not opened must stay distinguishable from a day a chore was deliberately let go. Answering twice on the same day is refused, so a double-tap on a slow connection cannot advance a fortnightly chore by a month.

### The two live mechanics in the sheet

Both exist because the rules they express are invisible until weeks later, and an invisible rule is one you fight instead of use.

- **The lead sentence** — *"On Today from **Fri, Aug 7th** — 7 days ahead"*, live as you change effort or priority. It names a **date**, because a date is what you can judge; and when the lead reaches back past today it says **"Already on Today"** rather than printing a date that has gone by. A `project` is 21 days, so that is the common case, not an edge one. One line, and only the outcome: a second line naming which rule fired was drafted and cut for teaching the mechanic instead of stating the result.
- **The next three occurrences** — the only available verification of a recurrence. You cannot read a rule and know it means what you meant, and one that is subtly wrong stays invisible until months of chores have been scheduled against it. Schedules are picked **by name** (*every Monday · every other Monday · monthly on the 3rd Monday · every weekday…*), and the names are rebuilt from the date, because "every Monday" is only true while the date is a Monday. **`After I do it` previews nothing and says so in one clause** — *"Counted from the day you tick it."* Showing three dates for both modes would have been a lie.

**A lead and a recurrence are both functions of a date, so neither section exists until there is one.** Not a disabled control beside a sentence explaining why it is disabled.

---

## 14. Goals — intentions, not projects

*`/admin/agenda/goals`. Goals are visited monthly, so they are a surface of the Agenda room rather than a room of their own. Schema in [data-model.md](data-model.md) §6b.*

**A goal is a direction, not a scoped deliverable.** *Get back in shape. Finish the Sky.* That framing is the whole reason this exists without becoming project management, and it is visible mostly in what the two surfaces refuse to draw: **no progress bar, no percentage, no subtask count, no "3 of 7 done"** — and no paragraph explaining the absence of any of them.

**Five active goals, and the cap is a fact you can see** (`3 of 5 active` beside the New button) rather than an error you hit. Goals are capped harder than constellations because they are about attention, and attention is scarcer than taxonomy. The sixth is refused in a sentence — and so is re-activating a paused one when five are already active, which is the same overflow arriving through a control that looks like a toggle.

**Four statuses, side by side in the goal's header, and one of them is Let go.** Not hidden behind a delete: abandoning a goal should be a dignified act you take, not a row you erase. One tap, no confirm — it is reversible and it destroys nothing, and a confirm would dress a dignified decision as a dangerous one. Deleting a goal outright *does* confirm, because that one cannot be undone; the sentence names what survives, which is the actual question.

**The one number a goal gets is an observation over the last 30 days** — *"4 tasks done"*, or *"nothing in 6 weeks"* set in italic grey. **A cold goal reads quieter, never redder:** the moment it turns amber it becomes a debt. And **a goal with nothing to observe says nothing at all** — a goal written this morning is new, not neglected, and the naive version would greet it with "nothing in 6 weeks" before lunch.

**The goal page is three sections** — *Scheduled*, *Not scheduled yet*, and *Done toward this* — **and a fourth, *Notes*, on the goals that have any.** The third is **a list of what happened**, dated, never a count with a bar beside it — that is the difference between a goal and a project, made visible. The second is why undated tasks have a home at all: a task with a goal and no date is not a graveyard item, it is *part of something I care about, not scheduled yet*. Each of its rows offers **Give it a date**, and that affordance is the entire explanation of what the section is for.

**A goal says two things, and Notes is the second** (2026-08-10). *Why* is what the goal is for; **Notes is how it is actually kept** — what is in the routine, what to remember at 6am. Michael, on the goal that asked for the field — *wake up and get moving*, against the weight of an anxiety dream: **"the why is only half of it."** The alternative was filing the routine as five subtasks, which would have taught a goal to be a project on the one surface built to refuse that.

**One goal's notes ride on the Morning card** (2026-08-11), and the pin that puts them there is a one-tap toggle in the goal's header beside the status control. **The foot of the card, and the order is the argument:** above the check-in it would be a wall between you and the day, which that card's design forbids; below it, you write down the dream and the next thing your eye lands on is what you do about it. That adjacency is the whole feature — anywhere else on Today it is a link.

**It survives a skip**, which is the case it was built for: the block carries no `data-panel`, so the script that shows one panel at a time never hides it, and a bad morning that taps Skip still ends on the routine. Pausing the goal quiets the card without clearing the pin — the card reads only *active* goals, so re-activating brings it back rather than landing you on a card that has forgotten.

**Why not the Practice zone, where goals already are:** that zone shows a goal only when there is an observation to make, and a routine has no tasks to tick — so the goal that most wants reading every morning is the one Practice will never show. Loosening the guard would have put a bare navigation link in a zone whose rule is that everything in it is a signal you read.

**Notes are read, never worked.** Their section appears only on the goals that have any — no empty box on the ones that never will — and it is ordered **first on the narrow layout**, ahead of both task lists, because a routine has nothing scheduled and nothing waiting, and the thing you opened the page for should not sit under two boxes saying so. Nothing in it can be ticked: `- [ ]` renders as a plain bullet, since the sanitizer drops the checkbox ([data-model.md](data-model.md) §6b). A line that wants a tick wants to be a task, and the ✚ two sections down is how it becomes one.

**The horizon is a segmented control, not a text field** — *this season · this year · the next few years*. Three buttons cannot say "March 3rd", which is the vagueness rule enforced by shape rather than by discipline: the moment a goal has a deadline it is a task.

---

## 15. The calendar — four sources, two of them writable

*`/admin/agenda`, the Agenda room's front door. Schema in [data-model.md](data-model.md) §6b; the one-way rule it sits behind in [13-agenda.md] §2.*

A month grid by default — the mental model most people already have, and with one calendar it is not too dense to read. **Week is the same union with room for detail, never a second data model.** Both are **six week rows, always**: a grid that changes height between months makes the page jump and moves the row under the cursor.

### Fill means writable

The contents are a union of four sources, and only two of them can be changed here. Rendering has to make that obvious *without* a label — Today already cut *"Google · read-only"* as chrome nobody would act on — so authority is carried by the shape:

| | Treatment | Because |
|---|---|---|
| **HQ event** | solid fill | yours, and the most present thing on the grid |
| **Task** | lighter fill + `○` | yours, but not an event — it ticks off |
| **Google mirror** | hairline, no fill | a copy of something that lives elsewhere — its title links out to Google |
| **Birthday** | no body at all, a cake and a name | not a row anywhere |

**The first draft got this wrong in a way worth recording:** tasks were given an outline ring, which put them in the same visual class as the Google rows — so the loudest distinction on the grid became *event vs everything else* rather than **yours vs not yours**, which is the one the whole treatment exists to make. Fill is now the writable signal and nothing else uses it.

Two reinforcements, neither a word: read-only rows **do not lift on hover** and **reveal a small lock** when the cursor reaches them. That second one is mouse-only — on a phone there is no hover, which is exactly why fill has to carry it alone.

**The legend is the one piece of chrome that earns itself** — four sources on one grid is genuinely ambiguous, and a four-word key is a fixed cost. It lists **only the sources actually present**: a key for something with nothing in it names a feature that does not exist, so until the Google mirror lands nothing says anything is mirrored.

### The day panel is where read-only is explained

Clicking any item opens the day, and **the affordance is the whole explanation**. An HQ event offers *Edit*; a task offers *Did it*; a mirrored row offers **no Edit at all** — its title is a link out to Google, the only place it *can* be changed — plus **Tag someone**, the one write HQ has against Google's copy; a birthday offers nothing at all, because there is no row to open. **No footer, no per-row note, no summary line** — all three were drafted and cut, and the summary earned its removal twice.

**Every control on this page is a real link.** The month steps, the view switches and the day opens through `?date=` / `?view=` / `?day=`, all rendered server-side, so the page works before a byte of JavaScript runs — and so the day panel survives a reload and a back button. It is also how the whole grid avoids the trap that bit the Today prototype: a calendar built with `createElement` silently gets none of its scoped hover, cursor or focus rules.

### Tagging, and the guard it closes

**Who was there is the point.** An event's people are what make the People zone's brief possible, and tagging is additive by construction — it never has to live inside Google's copy, so it cannot create a conflict.

It also closes something: *anyone with an event today is never drifting*. That guard was named in [§12](#12-people--the-roster) and unenforceable for a day and a half, because it needs an events table. The interaction will not be logged until the evening at the earliest, so without it the "Been a while" panel spends the whole of the one day it is wrong telling you that you have neglected somebody you are about to have dinner with.


### The mirror — what Google puts there ([ADR 0014](adr/0014-calendar-is-one-way.md))

*Live since 2026-08-03.* The fourth source on the grid finally has a producer.

**It is one direction, and the credential enforces it.** The token carries `calendar.events.readonly` — narrower than `calendar.readonly` — so "HQ never writes to Google" is not a convention the code observes but the only thing the credential permits.

**What it actually carries is not what the plan assumed.** Read end to end before it was built, the live calendar held 48 events: 31 auto-generated birthdays, 9 Gmail-extracted bookings (flights, hotel stays, restaurant and cinema reservations), and 8 test events. **One was created by anybody else.** So the mirror's value is *things Michael did not type and would never type into HQ* — roughly one a month, each of them exactly what you want on the day. The correction is recorded in the ADR rather than quietly fixed, because it changes what "this stopped being worth it" would look like later.

**Google's birthdays are dropped at ingest** — 31 of those 48. HQ derives birthdays from `people` and draws them as a mark rather than a row, so importing Google's would put two differently-drawn entries on the same day, which reads as a bug.

**Two things the API's shape decides, both of them silent if you get them wrong:**

- **Google's all-day end date is exclusive.** A two-night stay reads `29 → 31`. Stored verbatim it puts you in the hotel a night longer than you were, on every stay, for ever.
- **A multi-day row is on every day it covers.** A four-night hotel is not an event on the day you checked in; it is where you are all week, and the grid's question is *what is my day*.

**It refreshes when you open a page that shows it**, throttled to ten minutes, not on a schedule. There is no scheduler in this repository, and a calendar that changes monthly does not earn push channels renewed weekly. The page renders from the mirror first and asks Google after paint, so a slow or dead network costs freshness and nothing else. The cost is stated plainly rather than hidden: **the mirror is only ever as fresh as your last visit.**

**Staleness is the one thing that speaks.** A one-way mirror buys its simplicity by introducing exactly one new silent failure — if the sync stops, Today is confidently wrong. So Today and the Agenda room carry a quiet line **only when it has gone a day without reaching Google, or has failed**; the rest of the time they say nothing at all, because a permanent "synced 4 minutes ago" is the status line you read once and ignore for ever.

**A `410 GONE` is an instruction, not an error.** It means the incremental cursor is dead; the sync drops it and does a full one rather than logging and carrying on with a stale mirror. That full sync **upserts and marks** — it never truncates and reloads, because a reload leaves a window in which the mirror is empty.

---

## 16. Today, assembled

*The landing surface, and the reason all of this is in one app: the correlation thesis needs sleep, agenda, people and practice on **one page**, or it is four apps again. Schema is elsewhere — this section owns no table. It is entirely a set of reading rules over what §11–§15 already store.*

**Six zones, and their order is an argument:**

| | Zone | What it holds |
|---|---|---|
| 1 | **Morning** | The check-in (§11). Pinned first, answered or not. |
| 2 | **Today** | The day's events and tasks in **one** time-ordered list — a day does not come in sections. Plus a birthday falling today, which is a fact about the whole day and therefore leads it. |
| 3 | **People** | The brief (§12), then drift capped at three. |
| 4 | **Coming up** | Everything approaching, each on **its own lead**. |
| 5 | **Practice** | Signals. The one zone you cannot act on. |
| 6 | **Past due** | Full width, below both columns, **always open**. |

On a phone the two columns collapse to one stack and **People moves above Coming up** — who you are seeing today matters more than what is three weeks out. That reordering is CSS `order` over a `display: contents` wrapper, so the DOM order and the visual order deliberately disagree below 46rem.

### Only the check-in follows the date bar

The bar exists to **backfill a check-in**. Everything else on the page is a statement about *now*: "Past due", "Been a while" and "Last published" are all false on a Tuesday last March, and offering their dismissals there would write a row dated today from a page that is not about today. So on any other date the page is the date bar and the check-in — which is exactly what it was before the agenda landed, and is still the honest answer.

### Nothing counts what you owe

The single rule the whole page is built to keep ([ADR 0013](adr/0013-absence-never-accumulates.md)). There is no total, no badge, no streak, and no percentage anywhere on it.

- **`1 of 2 done`** counts what you *did*, resets nightly, and **says nothing until you have done one**. `0 of 3 done` at 7am is arithmetic about what you have not done yet — the arrears count wearing a different hat. The alternative that lost was showing `0 of 3` for symmetry, so the line would not "pop in"; a line you earn is a better reward than a line that starts at zero and watches you.
- **Past due can only ever hold as many rows as there are tasks**, never one per missed occurrence, because those occurrences were never rows.
- **A skip is not progress.** It moves a row out of the unanswered state without moving the number.

### Coming up is driven entirely by each item's lead

A `project` announces itself 21 days out; a `quick` task the day before; a birthday at whatever its `birthday_lead_days` says. **There is no "next 7 days" setting anywhere in this feature, and its absence is the point** — the list is short because the leads are honest, so when it gets long the fix is the effort on a task rather than a dial on a page. Which is also why it is uncapped, unlike past due: a cap would be the window arriving again under another name.

**Birthdays live here rather than in People.** They sat in the People zone while there was no Coming up to put them in, with a comment saying so. A birthday needs runway for exactly the reason a task does. The cost is real and was weighed: a person's name now sits in an amber agenda zone rather than the azure people one, so the domain hue no longer says what it is — the cake carries that instead.

### Past due is open, and it is last

Two plans disagreed about this and the interface spec won. The sketch had it collapsed to one line — *"3 things past due →"* — and the argument against is that **hiding arrears at the bottom means never resolving them**, and a click in front of a one-tap disposition defeats the point of the one-tap disposition. Being last already does the work the collapse was doing: **you meet it after today, not before it.**

The one guard kept is a **cap on the list, not a hidden section** — eight rows and then a door to the room that holds them all, so a bad fortnight cannot become a wall while nothing is ever concealed.

### Practice: a signal has no verb

Michael asked for the writing nudge in these words: *"Hey, you haven't actually posted anything, any piece of writing, this week."* It is built as a **quiet line and never an overdue item**, because a self-imposed writing commitment turned into a red row is precisely the guilt engine HQ exists to prevent. Nothing in this zone can be pressed, and **cold reads quieter rather than redder** — the moment one of these turns amber it is a debt.

**Writing only**, and that is a fact about the data as much as about the ask: `published_at` is stamped on every published essay, but on 1 quote in 73, and every song's stamp is the day the catalogue was imported. A "last published" line over all three types would report an import as an act of writing.

Beside it sit the active goals' observations (§14), which keep their own cold-start guard: **a goal with nothing to observe says nothing at all.**

### Today reads; the rooms write

A row's title is plain text here, where in the tasks room it opens the sheet. An event's title is a link to the day panel. **No `TaskSheet`, no `EventSheet`, no TipTap** — this is the page opened on a phone at 7am, and the editors stay in the rooms that need them. The only writes on the page are the tick and drift's two dismissals, and both reuse their room's script verbatim.

## 17. Sets — a curated listen

*The `/listening` room's contents (plan 40 §3; the room got its own route in
[ADR 0040](adr/0040-a-view-state-is-not-a-room.md)). A set is one Spotify
playlist, one quote and one description, and its whole proposition is that
somebody can SAVE it into their own library — which is why it has no page of
its own, no subjects, and no feed entry. `design.md`'s division of labour: **a
constellation is where an idea is worked out; a set is where a feeling is
isolated.***

**The room is `/admin/sets`** — rows in authored order, `New` in the header, and
the ⋯ menu described in §2. Six fields in the sheet, and three of them are worth
knowing:

- **The description is Markdown, edited as Markdown.** `MusicSets.astro` has
  always rendered it through `renderMarkdown`; until 2026-08-17 only the editor
  refused, which made it the one prose field in the building where what you typed
  and what shipped were different languages. It uses the same mini editor the
  quote body and the constellation description do ([ADR 0006](adr/0006-composer-editor-tiptap.md),
  [ADR 0018](adr/0018-notes-use-the-composer-editor.md)).
- **The quote is chosen in the epigraph picker** (§2e), and ⚠ **the pick is held
  on the form until Save** — an epigraph is a column on the set, not a relation,
  so it cannot apply on touch the way a membership does (§4a).
- ⚠ **Visibility has two controls on two screens, and that is the constellations
  shape.** A form-bound switch in the sheet, which saves with the card and says so
  in words until you press Save; and a click-is-commit Publish/Unpublish in the
  list row's ⋯. Plan 41 · §5a's finding was two controls for one fact on **one**
  screen — these are two screens, and the one thing they share is that
  **`sets.setStatus` is the only writer of that column.** `sets.save` does not
  name it, and `src/tests/actions-sets.test.ts` keeps it that way.

⚠ **A set hard-deletes, where the corpus soft-deletes**, and the reason is at the
action: a set is a title, a sentence and a link, the playlist on Spotify is
untouched, and the quote stays in the corpus. There is nothing here a minute of
retyping cannot restore, so a `deleted_at` column would be a bin nobody opens.

⚠ **The epigraph picker offers PUBLISHED quotes only**, which is narrower than
`checkQuote` allows — that refuses a binned quote and permits a draft one, since
you may be writing both at once. The picker is narrower on purpose: a set's
epigraph is the first thing a reader meets on the music page, so offering a draft
would invite a pick whose words the public cannot see. **The picker offers what is
safe; the action refuses what is wrong.**

**The room was seven open `<form>`s until 2026-08-17** — one page-scoped commit
unit that discarded unsaved text in every other card on any POST. See
[ADR 0038](adr/0038-a-private-admin-surface-may-require-javascript.md).
