# 0042 — A shelf is where a jotting lives

Status: **Accepted** *(2026-09-01)*
Date: 2026-09-01
Benches: [`/lab/search`](../../src/pages/lab/search.astro), [`/lab/shelves`](../../src/pages/lab/shelves.astro)
Migration: `20260901171801_a_jotting_lives_on_a_shelf.sql`
Relates to: [0003](0003-fragments-single-table.md) (one table), [0040](0040-a-view-state-is-not-a-room.md) (the guards are the bill)

## Context

Michael, on the pile growing: ***"I want to be able to categorize things or put stuff into certain buckets, and I need to see that visually"*** — for the jottings that will never publish: job application writing, notes to himself, philosophy.

Underneath it, a second and larger question he asked in the same breath:

> ***"There's this temptation within me to consolidate: we should have one consolidated fragment browser, and everything's in there… I see a lot of beauty and utility in just being able to search everything I've ever written in one place."***

**Two things made the consolidation unavailable and something better visible.**

**1. The consolidated version already existed, and was deleted.** `?view=notes` was the fragment manager holding notes. It went on 2026-08-03 (plan 14 · Piece 1) for a reason quoted in `notes.astro`'s header to this day: *"I have to title these things… I see untitled, untitled, untitled."* Rebuilding it is not a new idea; it is re-litigating a decision made with evidence, where the evidence was that a shared table forces the jotting to wear the piece's chrome.

**2. [0040](0040-a-view-state-is-not-a-room.md) had already generalised the test.** *"A section of this site earns a route when it stops sharing the machinery of the room it sits in… the branches are the bill for not saying so."* Applied here, the overlap between the two rooms is **delete, and a timestamp**:

| Fragment Manager row | Notes card |
| --- | --- |
| Title (+ open action) | *no title, no slug, no open* |
| Type mark, status chip | *neither* |
| Checkbox + bulk bar | *no checkbox* |
| Subjects, constellations | *neither, and constellations never* |
| Author / work provenance | *never — it is his own scratch* |
| — | The words themselves, rendered |
| — | Clamp + `more` |
| — | → chooser: four destinations |

And the bill is not hypothetical. `fragment-query.ts` already carries four modes with `pairable`/`quotable`/`constellation`/`membership`/`pairedSong` guards; its fifth — `placeable` — **took the composer's browser down completely for two days** with every check green. A "notes" mode is a sixth guard on that function.

**What the debate was actually about.** The data is *already* consolidated — [0003](0003-fragments-single-table.md), one `fragments` table, a note is a `writing` row at `status = 'note'`, and **make a piece** is a tier move on that row. What did not exist was any surface that reads across the boundary: `neq('status','note')` appears in the only query that could search, and nothing else searched at all. **The ask was a query, not a room.**

**And the pile had a shape problem the buckets turned out to answer.** Its four exits — the Agenda, a log entry, a quote, a piece — all *remove* the note. There was no way to say *"I am keeping this and it is not going anywhere"*, so a thought kept on purpose looked exactly like one not yet dealt with, the pile only ever grew, and that growth is what made a search field feel necessary in the first place.

## Decision

### 1. The rooms stay separate; the *finding* consolidates

**No merged browser.** A find surface has no verbs — it does not publish, place, pair, convert or delete; it shows hits and hands you to the room that owns the thing. No verbs means no guards, which is what keeps it a view under 0040's test rather than a third room.

Shipped in this pass: search inside the pile, which is the half that was missing entirely. Cross-corpus search is the follow-up and is now unblocked, because the pile is searchable at all for the first time.

**What this constrains:** consolidate *reading*, never *managing*. The moment a shared surface grows a verb that only one of its corpora can answer, it has become a room and owes itself an address.

### 2. Filing to a shelf is the fifth exit — and the only one that keeps the note

`shelves` + `fragment_shelves`, admin-only, **entirely private**. Unshelved is the inbox; shelved is kept, deliberately. A shelf is a **filter on the pile, never a room**: the same three controls edit, delete and convert a shelved note, so no guards appear.

**A note may sit on at most two** (`MAX_SHELVES`, enforced in the action, not only the menu). Chosen on the bench against the ten-times-cheaper single-valued column — `alter table fragments add column shelf text` would have done, and lost to the case where a thought is genuinely reading-I-keep *and* a note to myself. The cap is what stops the axis becoming a tag vocabulary by the back door.

**Not `subjects`, which already existed and would have cost nothing.** A subject is what a piece is *about* and is **public** (rendered on `PostCard` and `PostArticle`); a shelf is what a jotting is *for* and no reader ever sees one. Same argument [`feelings_are_not_subjects`](../../supabase/migrations/20260811154707_feelings_are_not_subjects.sql) makes about songs.

⚠ **A row leaving the note tier drops its shelves, and this is application code.** `fragment_shelves` rows survive a status flip because it is the same row — exactly the hazard that ruled out `subjects`, and moving tables only stopped it being *public*. Without the delete in `fragments.bulk`, a promoted essay would keep `Applications` for ever: invisible in the manager, invisible on the page, visible only in an export.

**What this constrains:** a private annotation on a note must be dropped when the note graduates, by the action that graduates it. There is no cascade that will do this for you, and the schema cannot express it.

## Consequences

- **The pile can be emptied again.** Nine live notes today; the inbox is the default view and a filed note leaves it with the same undo strip a delete gets.
- **Search reaches a jotting for the first time.** Third consumer of `search-highlight.ts`, contract unchanged — `docs/search.md` §6, and §7 for the two things this consumer settled.
- **Two rules that generalise**, both in search.md §7: a bounded container makes `highlight()` lie (24 of 36 matches were invisible behind the pile's 16rem clamp), and a live term must escape a filter the reader did not choose.
- **The chooser is nine rows now**, four exits and the shelves under a rule. It needed its own `max-height` (`.pop--tall`); `.pop--wide`'s 15rem was sized for five. **Accepted cost, and the one to watch:** this room's founding argument was *three controls, not six*, and the menu behind → is now the longest in the building. A vocabulary past five or six shelves will need a different shape, not a longer list.
- **Accepted cost — no rename, no delete.** The chooser can create a shelf and nothing else. A rename must leave the frozen slug alone; a delete cascades and would silently unfile every note on that shelf. Both belong beside the subjects vocabulary in `/admin/library`, which does not know about shelves yet.
- **Accepted cost — filing happens at the pile, not at the door.** The ✚ cannot file at capture time, so everything still arrives unshelved. If filing while *looking at* the pile turns out to be the only time it happens, the inbox stays where things live and this decision has bought less than it looks. That is a `/lab/capture` question.

## Alternatives

- **One consolidated fragment browser.** The thing that was asked for. Rejected above: it existed, it was deleted for a stated reason, and 0040's test says the guards are the bill. It also does not deliver what the ask was really about — searching everything — which is separable and cheaper.
- **A single-valued `shelf` column.** Ten times cheaper: one column, no join, one chip. Lost on the bench to notes that genuinely sit in two drawers; kept on the bench as the losing option so the comparison survives.
- **Reuse `subjects`.** Free, and wrong twice: different axis, and a live path to printing `job applications` under a published essay.
- **Group the pile by shelf under headings** (`grouped` on the bench). Cannot be had honestly alongside multi-valued shelves — a note in two drawers can only be sectioned under one heading, and the alternative is printing the same thought twice and letting the reader work out it is one note.
- **A "kept" boolean instead of a vocabulary.** Answers the triage half and none of the *"I need to see that visually"* half, which was the actual ask.
- **Do nothing until the pile is 100 deep**, which `notes.astro` had ruled — *"the moment to add one and not before."* Rejected because the depth was never the point: the pile grew a way of being deliberately kept, so it stopped being only a queue and could no longer be read by scrolling it.
