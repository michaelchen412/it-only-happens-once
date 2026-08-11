# 0018 — Notes use the composer's editor; the plain-textarea rule is retired

Status: Accepted
Date: 2026-08-06

## Context

Two surfaces existed for typing a brain dump, and both were plain `<textarea>`s:
the **✚ capture box** reachable from every Observatory room, and the **pencil**
on a card in the Notes pile. That was not an omission. Plan 14 (`docs/plans/archive/14-capture.md`)
§4 wrote it down as a rule:

> ⚠ **The box must stay a plain `<textarea>`.** Wispr Flow dictates into any
> text field, so voice capture works for free — but only while nothing gets
> clever with the input handling. That is a constraint on future changes, not a
> feature: **no rich editor here, ever.**

The rule bought something real and it cost something real, and only the benefit
had ever been written down.

**What it cost was visible in the storage model.** ADR-0003 and plan 14 §3 make a
note and a piece **the same row**: `note → draft → published` is one status flip,
same id, same `body`, no copy and no second write path. That is the property the
whole tier was designed around. But the *editor* did not follow the row. A body
typed in the note tier could hold only plain text; the moment it was promoted it
landed in a composer (ADR-0006) that could express headings, emphasis, quotes,
lists, links and images. The thing that was supposed to be one continuous
document had two different vocabularies depending on which tier you happened to
be looking at it from.

**And the ask was direct.** Michael, 2026-08-06, on the notes editor:

> *"Can this be the same spec of editor that we have for the main writing editor
> sheet? Meaning, it has the same ability to have bold or italics, etc., and all
> the tiptap controls. Basically, I think those are important still to have,
> **even though they take up a little bit of UI space**."*

He was shown the dictation constraint before anything was built, offered the
narrower option — enrich the pile, leave the ✚ plain — and chose **both
surfaces**, images included.

## Decision

**Both note editors are the composer's editor.** `mountRichEditor` and the shared
`EditorToolbar`, the same link and alt-text dialogs, images on. The ✚ box and the
pile's in-place edit are now the writing sheet's engine at a jotting's scale.

**The plain-textarea rule of 14 §4 is retired**, not quietly dropped. It is
recorded as reversed — with its reason — in `CaptureDialog.astro`, in the
`.cap-box` styles, and in `docs/admin.md` §5b.

Five things fall out of that choice and are part of it:

1. **Storage is unchanged.** Still `fragments.body`, still Markdown (ADR-0006),
   still `status: 'note'`. No migration, and *make it a piece* is the same one
   status flip it was.
2. **Both ends read `breaks: true`.** Every dump written before this is plain
   text whose newlines are its shape — an errand list, a stanza. Parsed as soft
   wraps they collapse into one paragraph, and the autosave writes that back. So
   the editors set `breaks` and the pile renders with it. A bare newline and the
   `\`-terminated hard break TipTap serializes both give exactly one `<br>`;
   `src/tests/markdown.test.ts` pins that, because the day they disagree the
   whole pile reflows.
3. **One editor per room, moved into the card you open.** A pile lists a hundred
   jottings and cannot mount a hundred TipTap instances. Each card keeps its
   Markdown in a hidden `<textarea>` — what the four `→` destinations read from a
   card that has no editor of its own.
4. **The marks come off on the way out.** A task's title is an `<input>` and a
   log entry's body is a `<textarea>`; triage strips the syntax
   (`lib/markdown-plain.ts`, dependency-free — the real renderer must never reach
   the browser). **Add to a piece…** is the exception and appends Markdown to
   Markdown on the server.
5. **A note's images live under `essays/<fragment id>/`.** The path a piece uses,
   because promotion is a status flip on that same row — so a screenshot jotted
   into a dump follows the thought into a published essay with nothing to move.

## Consequences

**The cost we accept, stated first.** Dictation software types into a
`contenteditable` — it is still a text field — but it is no longer the *plainest
possible* one, which is exactly what 14 §4 was protecting. **This has not been
verified against Wispr Flow**; there is no way to drive it from a test harness,
and saying it works would be a claim nobody checked. If voice capture ever
misbehaves in the ✚ box, this decision is the first thing to suspect, and the
honest fix is a plain-textarea escape hatch rather than a re-litigation of the
toolbar.

**Escape had to be closed by hand, and it will bite again.** ProseMirror's
`captureKeyDown` calls `preventDefault()` on keyCode 27 unconditionally, and a
`<dialog>` only treats Escape as a close request if the keydown's default
survives. So the moment the ✚ box became an editor, Escape stopped closing it —
silently, with the save still working. Caught by e2e, fixed in `capture.ts`.
**Any future TipTap editor placed inside a `<dialog>` inherits this**, and a
green typecheck will not see it.

**Enter is a paragraph now, not a newline.** Shift+Enter is the hard break. That
is the composer's behaviour and it is what "the same spec" means, but it is a
change in the hand for anyone used to the textarea. `.jot-prose` keeps the
paragraph gap at 0.65em so a two-line errand list does not read like an essay.

**An old dump re-spells itself on its first real edit** — a newline becomes
Markdown's `\` hard break. Merely *opening* one must not do that, because the
pile is ordered by when a note was last touched and a rewrite would bump every
card you glanced at to the top. So the "did this change?" baseline is what the
editor would **serialize**, not what the server sent.

**The pile renders Markdown server-side** — up to 100 bodies through `marked` +
`sanitize-html` per page load. Acceptable while the pile is meant to be triaged
and therefore short; if it is ever genuinely long the answer was already a search
field, not pagination.

**The toolbar occupies space in a card**, which was the explicit trade. It sits
**below** the words on both surfaces rather than above: entering edit mode must
not move the text, and the ✚ dialog has no title, so a strip of controls at the
top would be chrome introducing a box that needs no introduction.

## Alternatives

**Leave the ✚ box plain and enrich only the pile.** This was the recommended
option, and it keeps 14 §4 intact where the rule actually earns its keep — the ✚
is the voice-capture path, the pile is not. Rejected by Michael in favour of one
consistent editor everywhere. The narrower version remains the fallback if
dictation turns out to have been the load-bearing constraint.

**Formatting only, no images.** Rejected: the ask was the writing sheet's spec,
and the image button is part of it. It also turned out to be the cheaper half —
because a note and a piece are one row, `essays/<id>/` makes a jotted screenshot
survive promotion for free, where a `notes/` path would have needed moving.

**One TipTap instance per card.** The obvious reading of "the pile has an
editor". Rejected on cost: a hundred editors mounted to serve one at a time,
against a shared element that costs a `insertBefore` to move. The room already
had this rule for its chooser and its piece picker.

**Make Enter a hard break, to keep the textarea's feel.** Rejected: it breaks
lists (Enter is how you get the next item), and it would make these editors
quietly different from the composer — which is the one thing the request was
asking us not to do.

**A `captures` table with an honestly plain body.** Rejected already, by plan 14
§3, and this decision leans on that: a separate store would buy a model with no
slug and no title and pay for it with a cross-table move on the motion that
matters most. Splitting the *editor* by tier would have reintroduced the same
split one layer up.
