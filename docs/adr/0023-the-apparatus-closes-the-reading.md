# 0023 — The apparatus closes the reading

Status: **Proposed** *(2026-08-10. Two of the three rules below reverse a
decision that shipped hours earlier, which is precisely why they are written
down rather than left as a diff. It becomes **Accepted** once the foot of a long
essay has been read to the end on a phone — the moment the whole thing is built
around, and the one no green suite reaches.)*
Date: 2026-08-10

## Context

Plan 32 gave a fragment an **apparatus**: subjects, the constellations it sits
in, the lines it is kin to, when it arrived, and a share mark. A quote's is
trivial to place — a quote is two lines, so its end and its beginning are the
same place. An essay's is not, and the first build put it in the header with a
stated argument:

> *"An essay is a sitting: a reader who decides to pass it on usually decides
> partway through, and a control at the end is only reachable by finishing
> something they already stopped reading to share."*

That reader exists. He is not the one who matters. **Michael, 2026-08-10:**

> *"a lot of pieces of writing can be rather long. By the time the user is done
> reading and they feel really inspired, we should have some kind of share
> affordance near the bottom of the piece, don't you think? actually, it makes
> sense that we add a divider, move the tags to the bottom, and put the same kind
> of share affordance/similar pieces/constellation associations at the bottom as
> well."*

**The corpus says how far away the header was.** Published essays average **5,738
characters** and run to **14,296** — roughly a thousand words, and up to two and
a half thousand. A reader finishing one is thousands of pixels below a control
placed at the top, and the premise of the whole feature is that they will want
it *then*: the reason the share verb is a link rather than copied text is that
the sharer wants the recipient to come and look around, and that impulse arrives
at the last paragraph.

**A separate decision, from the same conversation, turned out to share a spine.**
Quotes in a constellation became openable, and briefly carried an `About →` next
to the essays' `Read →`, on the reading that the suite's rule was *"openable
stanzas get a word"*. Michael:

> *"quotes dont need the about button. they should just be clickable … it's not
> ultimately necessary to click the quotes. It's only really meant for sharing
> or viewing related content. However, we do need the read a button for my
> writing because you obviously need to click it to read the whole thing."*

Both corrections are the same instinct: **the reading is the thing, and the
apparatus arranges itself around it** — in position, and in whether it speaks at
all.

## Decision

**1 · A fragment's apparatus sits at the FOOT, after a rule.** Subjects,
constellations, related lines, the date, and the share mark, in one strip
(`FragmentStrip`). It is the same component on an essay and on a quote — one
idea, written once. For a quote this is not a choice; for an essay it is the
whole decision.

**2 · Moved, not duplicated.** There is exactly one share mark per fragment. Two
would be the same redundancy this site keeps removing: the paired-song caption
that repeated what the embed already printed, the `” ♪ ▤` glyphs that told a
reader a quote was a quote. A reader who wants to send a piece without reading it
still has the feed card's permalink.

**3 · A word is for a stanza whose content is INCOMPLETE without the click.** Not
"a stanza that opens". An essay in a suite is a title and a fading excerpt — the
piece is elsewhere, and a reader who does not click has not read it, so it gets
`Read →`. A quote is set whole; clicking adds provenance and a share mark to
something already finished, so it gets nothing. The same test put `Read →` on the
blog's feed cards, which had argued the opposite for most of their life.

**4 · The header keeps only what a reader needs BEFORE committing** — the date
and the read time. Everything else moved down.

## Consequences

**Three surfaces agree where two used to.** `PostCard` already footed its
subjects and the quote page footed its whole apparatus; `PostArticle`'s header
was the odd one. The runway from title to first sentence drops from four rows of
chrome to one.

**One component, so "related" cannot come to mean two things.** `FragmentStrip`
is shared by the essay and the quote, and both are fed by one batched loader. The
cost of the copy would not have been duplication — it would have been drift, two
strips answering the same question in two registers with nobody able to say which
was intended.

⚠ **It costs discoverability on a quote, knowingly.** A clickable quote with no
word announces itself to nobody: on a phone there is no hover, and the suite's
lamplight touches every stanza alike, which is exactly the failure
[ADR-0022](0022-the-sky-affords-differently-on-a-thumb.md) was written against.
Accepted here because the click is *optional* — it opens provenance, not content
— and because this site has already made and recorded the same trade once, for
the citation reveal: an answer to a question most readers never ask, reached by
the ones who ask because they reach for the line anyway. **If a reader ever
reports not knowing a quote was clickable, that is not a bug report about this
ADR — it is the accepted cost arriving, and the question is whether it still
looks worth it.**

⚠ **A reader who wants to share a long piece without finishing it now has
further to go.** That is the trade taken deliberately in Decision 2, and the
population is smaller than the one the change serves.

**The batch is load-bearing.** A feed page carries seven essays and a
constellation up to eight quotes; asking each one's neighbourhood separately
would have put dozens of round trips on the two busiest reader-facing routes —
including the one plan 24 · Piece 4 spent its effort collapsing to a single
query. Every surface asks set-wise.

## Alternatives

**A share mark at both ends.** Rejected under Decision 2. The head placement's
argument was real but weaker than the foot's, and this site's consistent answer
to "say it twice" is to delete the smaller saying.

**A visible list of related pieces at the foot, instead of popovers.** Genuinely
tempting for an essay: a reader who has just finished has attention to spend, and
that is the classic case for showing rather than hiding. Rejected because it
re-opens exactly what was ruled out on the quote page — *"long, extended sections
at the bottom … causes visual clutter, mixes in with all the other main UI
elements, and creates confusion"* — and because the register at the end of a long
read should be quiet, not four more things being offered. The popovers are there
for whoever wants them.

**Keeping the subjects in the header** as orientation before reading. Rejected:
they are filing, not orientation, and the piece's own title and excerpt already
say what it is about. The feed card had reached this conclusion first.

**A word on the quote after all, phrased so it does not promise text** — `About`,
which is what shipped for one commit. Rejected by Decision 3: any word there
implies something is being withheld, and nothing is.
