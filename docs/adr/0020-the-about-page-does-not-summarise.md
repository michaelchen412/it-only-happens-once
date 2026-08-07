# 0020 — The About page does not summarise the sky

Status: **Proposed** *(2026-08-07. Becomes **Accepted** with the commit that
removes the three fields — [plan 23](../plans/23-about-stops-summarising.md).
Written now rather than after, because the reasoning is the part that has to
survive: three sessions could each re-derive "the About page should introduce his
interests" from first principles and each be wrong for the same reason.)*
Date: 2026-08-07

## Context

`vision.md` §1 says the site "should *show* who he is by being navigated, rather
than *tell* who he is through claims. **The medium is the proof.**" §2.6 states it
as a principle: **show, don't tell.**

The About page grew three fields that tell:

| Field | What it holds | Live value |
|---|---|---|
| `me.interests[]` | a repeater of `{ term, note }` | 2 entries — Jazz, "Cooking, and food in general" |
| `me.headline` | a short opening display line | `""` — never used |
| `site.thesis` | a large opening statement | `""` — never used |

All three were built in good faith. All three are wrong, and reading the corpus
on 2026-08-07 found that two of them are wrong for the *same* reason.

### The interests finding, which is the load-bearing one

The jazz note reads:

> …the **generosity** of **improvisation**, the thoughtful **iteration** of
> ideas…

"The Spirit of Jazz" — 8,242 characters, published, position 6 of
`wayfinding—for yourself, and for others` — closes on:

> to **iterate** … to **improvise** … to be **generous** …

**The note is the essay's own ending, compressed.** Not a promise of depth: a
*spoiler* of depth that already exists on the same site, one click away. It hands
over the conclusion and withholds the 8,242 characters that earn it.

The food note fails from the opposite direction. `cooking|kitchen|recipe|cuisine|ingredient`
occurs in the entire corpus **twice**, both incidental (`Ad Hominem`, `Emotions`).
There is no food fragment. So *"far more important than mere nourishment, or even
mere pleasure"* has nothing behind it, and never names its predicate — more
important **as what?** The missing clause is the whole content.

**One form, two failure modes, decided entirely by whether the essay exists.**
Where Michael has written, the note spends the constellation's ending; where he
has not, it claims a depth it does not pay for. Neither is reachable by editing
the prose — which is why the section resisted several attempts to make it feel
honest, and why the feeling it produced ("disingenuous") was a correct reading of
the structure rather than a scruple to talk himself out of.

Two further contradictions, each with `vision.md` on the other side:

- **A constellation is "a way of seeing, not a topic"** (§3), and its first test
  is whether the name says what something is *about* (topic → no). `Jazz` and
  `Cooking, and food in general` are topics. The interests list was the one
  topic-organised surface on a site whose architecture exists to reject topic
  organisation.
- **Weight is signal and must be "*shown*, not flattened"** (§3). Two entries at
  equal visual weight assert that jazz and cooking occupy equal space in him. One
  has 8,242 published characters behind it; the other has nothing. **The shape
  lied independently of the words** — which is the general reason a list of true
  statements can still read as false.

### `headline`

Michael's reason, 2026-08-07: **it's cheesy.** Never set. A large display line
naming yourself is the most direct possible self-description on a page whose
governing principle is indirection.

### `thesis` — the interesting one, because it is architectural

Two reasons, and the second is the one that generalises.

**One: most of what this page is about cannot be distilled at all.**

> *"There are simply too many. There's no one idea that encapsulates everything.
> That's why I have constellations, because they all represent kind of disparate
> angles or perspectives of truth. There's no way to distill that, and even if
> you could, it would sound like something absurd, like 'have wisdom'."*

`conditions, not character` · `the blizzard covers us all the same` ·
`an inseparable truth` · `put away your books` are not four facets of one
sentence, and the sentence containing all four would be a fortune cookie. **The
plurality is the position**, and a distillation field asks the page to abandon it
in its own opening line.

**Two, and this is the load-bearing reason: the one idea that *does* generalise
must not be promoted ahead of what earns it.** Michael, 2026-08-07:

> *"The thing about the practical empathy is that I'm still going to mention it in
> my About section, because that's really the way I approach things overall… but I
> just don't need a separate UI element to throw it in your face. What I really
> want is a narrative. It's like, don't skip straight to the part where I already
> give you the practical empathy piece — please read the part before that that
> explains me and how I got here and the background of that idea."*

**Practical empathy stays. The deck goes.** And note what the removed element
actually did: [`about.astro:129`](../../src/pages/about.astro#L129) rendered it at
`text-xl`, italic, behind a left rule, **above** `site.body`. That is a *deck* —
and a deck belongs to one of exactly two genres, both of which Michael named:

| Genre | Function of the statement on top | Reader it presumes |
|---|---|---|
| **SaaS hero** | the value proposition, above the fold | one who **won't** read |
| **Editorial standfirst** | triage — what this piece is about | one **choosing** whether to read |

`/about` presumes neither. It presumes someone who came to read, which is the
whole premise of a walkable self-portrait. **A deck is a genre built for
non-readers**, and putting one on this page mistakes who is standing there.

**This is the interests failure at a larger scale.** The jazz note served an
essay's conclusion without the 8,242 characters that earn it; a thesis deck serves
the *narrative's* conclusion without the life that earns it. Practical empathy is
not a claim a reader can be handed — it is only worth anything once you know how
someone arrived at it. Hoisting it to the top inverts the order of understanding.

*(A smaller sign the field never fit: it lived under `site` — "About the Blog" —
while practical empathy is a fact about **him**. The field's own section was wrong
for the only sentence it was ever going to hold.)*

## Decision

**The About page does not summarise the sky.** Three fields are **removed**, not
left empty: `me.interests[]` (with its editor and the `InterestRow` component),
`me.headline`, and `site.thesis`.

And the rule the three of them share, which is one rule with two halves:

> **A conclusion may not outrank the thing that earns it** — not *across*
> surfaces, and not *within* a page.

**Across surfaces:** no surface may restate what a constellation exists to
deliver. About may say who Michael is in prose written for that page (`me.body`),
and what this place is and where its name came from (`site.body`, `site.name`) —
none of which exists anywhere else. It may **not** carry a compressed index of his
themes, because the sky *is* that index, walked rather than read.

**Within the page:** About has one narrative order, and no element may hoist a
conclusion out of it. This is the half that governs practical empathy, and it is
why that idea is *not* removed along with its field. **It stays, in the prose,
where the reader arrives at it** — after the background that makes it mean
something. The field is removed because a `text-xl` italic pull-quote above the
body is structurally incapable of being arrived at.

⚠ **The second half is needed because the first does not reach this case.** §8 is
explicit that practical empathy is **not** a constellation — "a way of seeing
*specific* things is a constellation; the way of seeing *everything* is the
About." So the deck was not restating the sky, and a rule about the sky would have
permitted it.

**Three registers, and the ban is on the middle one:**

| Register | Example | Verdict |
|---|---|---|
| **Label** | "Jazz" | No information. Pointless rather than harmful. |
| **Conclusion** | "Ideas are not property" | Information — and it is a constellation's ending. **Banned.** |
| **Particular** | "Ben Wendel's *July*: four versions, one of them right" | Information, verdict withheld. **Admissible.** |

*No particular is being added here — the section goes away entirely.* The table
exists so a future session proposing to bring interests back knows which third of
the design space is open, and so that the obvious "fix" (promote the insight to
the heading) is on the record as **worse**, not better.

## Consequences

- `/about` becomes portrait + prose + the name + contact. Every remaining element
  is something the sky cannot say.
- `/admin/about` loses the room's most complex control — a per-row TipTap
  instance, a clone `<template>`, four delegated buttons and a `WeakMap`
  teardown — and `InterestRow.astro` is deleted.
- ⚠ **[22 · Piece 4](../plans/22-proofread.md) goes stale by one number.** It
  enumerates `mountRichEditor`'s five callers and counts *three editors in the
  About builder*; after this it is two. 22 gates its plugin behind an option
  either way, so nothing breaks — but 22's own header is a lesson about plans
  that are wrong about the tree they build on, so the count is corrected there
  rather than left to be discovered.
- **Stored prose is discarded, and this names it rather than glossing it.** The
  jazz note is the only real content in the three fields. It survives in the
  nightly backup, and it is a compression of a published essay — nothing original
  is lost. Recorded explicitly because *"we dropped two paragraphs of your
  writing"* is a sentence a future session should be able to find.
- **No migration.** Zod strips unknown keys, so the removed keys simply stop
  round-tripping on the next save. Nothing reads them in the meantime. Stripping
  them from the live row is optional tidying, not a correctness step.
- ✅ **`vision.md` §8 stands, in full, and needs no amendment.** *(Corrected
  2026-08-07, before acceptance — the first draft of this ADR claimed §8's
  practical-empathy thesis "does not survive," and that was wrong in a way worth
  keeping on the record, because it would have damaged a document that was
  right.)* §8 calls practical empathy "the About page's **spine**." A spine runs
  the whole length of a body; it is not a banner across the front of it. **The
  `thesis` field implemented the second reading.** So §8 was never the thing being
  contradicted — the field was a misreading of it, and removing the field brings
  the page *closer* to §8, not further. §8's other claim — About is "as
  load-bearing as the blog" — is likewise untouched and arguably strengthened: the
  page stops being a lobby directory.
- **Practical empathy therefore has somewhere to be, and it is `me.body`.** This
  ADR removes a container, not an idea. Any future session reading "the thesis
  field was removed" as "the site no longer states its thesis" has it backwards.
- **The fields cannot return without answering this ADR.** A future interests
  surface must sit in the *Particular* register and must show weight rather than
  flatten it.

## Alternatives

**Rewrite the notes better.** Attempted twice in conversation, 2026-08-07. The
first rewrite promoted each interest's *insight* to the heading ("Ideas are not
property") — strictly **worse** by vision's own principle, because it turns the
section into a table of contents for the sky's punchlines. The second deepened the
prose under the topic, which reproduces the original problem: the form
`{ term, note }` can hold only a claim *about* an interest, never the interest.
**The failure is structural and prose cannot reach it.** This is the alternative
most likely to be re-attempted, because it is the one that feels like craft.

**Keep the `thesis` field, move it *below* the prose.** The natural next proposal
once the objection is understood as one about order. Rejected on both halves of
the reasoning: below the prose it becomes a summary of what you have just read,
which is redundant rather than crass — and it is still a dedicated element
asserting that one distillation exists, which reason **One** rules out
independently of where it sits. The sentence belongs *inside* the narrative, as a
sentence, not in a box of its own at either end.

**Leave the fields; simply stop using them.** Zero work, and it is what has been
happening. Rejected: an empty field in an editor is a standing invitation,
`hasMe` / `hasSite` still branch on them, and the next session to open
`/admin/about` reads *"Thesis — the large opening statement"* as a thing to fill
in. **A decision not recorded in the schema is a decision that gets re-made.**

**Keep interests, drop the notes — bare terms only.** A list of ten nouns.
Rejected: that is the *Label* register, which carries no information at all, and
it would still be flat, evenly weighted and topic-organised — three separate
violations for zero payload.

**Move interests to their own page.** Rejected *for now*, and it is the one
alternative with a real idea in it: **nothing in the sky shows range.** The
adjacency of jazz, traffic engineering, ecclesiology and braising says something
about the shape of a mind that no single essay can, and the Sky (depth) and the
Index (chronology) are both blind to it. But that is a **new surface with its own
plan**, built out of particulars — not a rescue of this one. Relocating a section
does not answer an objection to what the section says.
