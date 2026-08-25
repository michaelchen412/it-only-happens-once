# 0041 — A capture surface declares a destination, it does not become one

Status: **Accepted** *(2026-08-25)*
Date: 2026-08-25

From [plan 45](../plans/45-the-tab-declares-the-room-collects.md), whose
five propositions were built and compared at a bench before any of this was
decided. Extends [0013](0013-absence-never-accumulates.md) in kind: that one
constrains every future HQ surface, this one constrains every future thing the
✚ learns to make.

## Context

Michael, 2026-08-24: ***"my instinct tells me I should use this to add anything —
a task, a quote, writing. But I realize I can't, and when I want to add a quote
I have to shut down that idea and then go to the fragment browser."***

A bare **✚** pinned bottom-right is the universal-create affordance by
convention. `CaptureDialog` labelled it *"Write something down"*, and nobody
reads a label on a FAB. Widening the promise to match the glyph meant deciding
what the ✚ becomes when it can make more than one kind of thing — and the
obvious answer is that it grows the fields each kind needs.

**That answer was built, picked, and then costed.** `/lab/capture` put it beside
four rivals; Michael chose it on sight. Costing it against the schemas and the
phone is what produced this decision instead.

**Two facts made the obvious answer unavailable.**

**1. Only the note tier can hold a half-typed thought.** The ✚'s whole promise is
that the thought survives the typing of it — a 700ms autosave, a flush on close,
⌘/Ctrl+Enter to park one and start another. But `tasks.save` demands a title,
`interactions.save` demands a `personId: z.uuid()`, and `fragments.saveQuote`
demands words plus a sheet of provenance around them. A box that switched its
write target with the kind would have had **nothing valid to autosave into** for
four of its five kinds, and the promise would have held on one.

**2. The corner runs out of room, measured.** At 390px the fields-in-the-box
version cost **319px** of chrome; with a keyboard up on a 390×844 phone that
leaves ~157px for the words, and about **16px** on a 375×667 one. The ✚ is the
mobile capture path — the PWA shortcut exists for it. A first attempt to narrow
it saved 61px, because the bordered *section* holding one chip cost ~96px and
the tab row was never the expense.

## Decision

**A capture surface DECLARES where a thought is going. It never becomes that
destination's form.**

Concretely, and binding on anything the ✚ learns to make next:

1. **What is written while you type is always a note.** The declaration changes
   where **Done** sends you and nothing else. Every destination is then reached
   through the note→X plumbing that already exists, inheriting its ordering rule
   and its undo table wholesale.
2. **The order is: write the destination, then consume the jot.** Never the
   reverse. A failure must leave a dump still sitting in the pile — visible, and
   deletable — rather than a thought that went nowhere.
3. **A field belongs in the corner only if it is the ADDRESS of the
   destination**, not a fact about it. `Who` for a log entry qualifies: an
   entry's room is somebody's profile, so there is nowhere to go until you have
   said whose. `When` for a task and `Said by` for a quote do not — the room
   asks for them on arrival anyway.
4. **The destination room does the collecting, including the reading.** The
   model parse runs there, not in the dialog: it costs 1.5–4s, and making the ✚
   wait on a model before it will let go of you spends the budget in the one
   place plan 14 refuses to.
5. **Done never blocks on a field.** It files what it has; the room asks for the
   rest. A capture box whose primary is disabled is a thought you cannot put
   down.

## Consequences

- **The ✚ stays cheap.** Piece 2 added 36px of resting chrome and **no** server
  data to any admin page. Piece 3's roster is one `head: true` count for the
  tab's existence; the names load on first use.
- **A new kind is a route, not a form.** Adding one means giving its room a
  `?from=<jot id>` arrival — which is `lib/hq/jot-seed.ts` for the read and
  `scripts/jot-arrival.ts` for the rest — rather than growing the dialog.
- **`hq:note-filed` is a handshake.** The notes pile calls `preventDefault()` to
  claim a filing it can tidy; an uncancelled event means the sheet consumes the
  jot itself. Any new destination inherits that contract.
- **Undo does not survive leaving the room** (ruled 2026-08-24: *"no undo for
  now"*). The pile's strip is on the pile's page. What stands in for it is that
  nothing leaves the pile until the destination is saved, and when it is, the
  thing you made is in front of you.
- **A picture does not travel.** `stripMarkdown` drops images on the way to a
  task or a log entry (*"a picture is not a task title"*), and the quote sheet's
  mini editor has no image node, so one dropped into a jot stays with the jot.
  The jot is trashed rather than purged, so the file is still reachable.

## Alternatives

**Fields in the box — the version that was picked before it was costed.** It is
the obvious idea and the one a competent person re-proposes, which is why it is
recorded rather than dismissed: it was built at `/lab/capture`, and both columns
are still there to be read against each other. It fails on the two facts in
Context, and it fails progressively — the corner is fine holding one date and
ruinous holding a quote's provenance block, so the version that feels right on
the day is not the version that survives the third kind.

**A router that reads the jot and files it for you.** Refused before this plan
started ([10-hq §4.21](../plans/archive/10-hq.md)) because a router's failure is
SILENT — a thought filed as the wrong kind disappears into the wrong room. A
sixth bench proposition that *offered* a destination rather than choosing one
was proposed on 2026-08-24 and Michael declined to have it built: an offer you
confirm is arguably not what the ban is about, but it is a second question, and
building it would have let a good suggestion engine rescue a bad chooser.

**A chooser in the footer instead of a declaration up front** (`Box first, file
after`, the bench's first column). Genuinely close, and cheaper: nothing before
typing, two taps to file. It loses on the one case that motivated the whole
thing — you already know it is a quote when you start typing it — and it keeps
the ✚'s promise narrower than its glyph.
