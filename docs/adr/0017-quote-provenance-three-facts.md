# 0017 — A quote is three facts; the line under it is derived

Status: **Accepted** *(2026-08-05 — supersedes the display half of
[0008](0008-provenance-and-facets.md), which stays correct about everything else)*
Date: 2026-08-05

## Context

[0008](0008-provenance-and-facets.md) added `authors` and `works` as query
facets and was explicit that they were **decoupled from display**: *"Display
stays where it was… Nothing about rendering changed; no joins needed to show a
row."* That was the right call for what it was solving — browse and merge and
rename — and it left the shown line exactly where it had always been, in the
`attribution` column.

Ten months of use said the display half had a cost nobody had counted.

> *"something still seems fundamentally limited or broken about the attribution
> process when putting in quotes… if I'm adding a Bible verse, what is the
> process? Do I put attribution first, or do I put the work? Do I have to put an
> author, and then do I have to put the source title again? I think the way that
> we've conceptualized or broken down this is not quite right."* — Michael,
> 2026-08-03

**Four questions, and the form could not answer any of them.** An audit of all
76 quotes found why:

| Field | Rows | Who ever saw it |
|---|---|---|
| `attribution` | 75/76 | **readers — the only one** |
| `author_id` | 72/76 | admin filtering only |
| `work_id` | 43/76 | admin filtering only |
| `details.source_title` | 42/76 | one admin column; **41 of the 42 a verbatim copy of `works.title`** |
| `details.citation` | 23/76 | **nothing. Rendered nowhere.** |
| `details.page` | 7/76 | nothing |
| `details.work_year`, `details.source_author` | **0/76** | nothing, and no form field for one of them |

Three of the seven fields were duplicates of data that already existed
elsewhere. `citation` — *Book 7:56*, *Letter 24:19–20*, *Book 8:22a* — was
careful, consistent, deliberately entered data that **nothing displayed**.

**The root cause was one sentence.** `attribution` held the *who* on some rows
and the *where* on others, depending on whether a who existed — so **every
single quote made you decide which**, and Michael had performed that derivation
by hand seventy-six times. The Bible rows put the locator in `attribution`
because there was no author to put there; the Marcus Aurelius rows put the name
there and the locator in a field nobody could read.

The proof that this was a model problem and not a labelling one: a regex,
`/\d+\s*:\s*\d+/`, existed in the editor purely to stop *"Matthew 5:43-48"*
being mistaken for a person's name. **It was incomplete** — a bare book name
("Ecclesiastes") did not match, so typing one seeded a phantom author, which
emptied the Work list, so "The Bible" could no longer be chosen and the only way
forward was to type it again as free text. One row in the corpus bore exactly
that scar: a verse filed under no work at all, with the Bible as a loose string.
Three scripture quotes, entered in three sessions, stored three different ways.

A model that needs a hardcoded special case for scripture, and whose special
case is wrong, is the thing to change.

## Decision

**A quote stores three facts. The line under it is a rendering of them, not a
fourth fact.**

| Fact | Column | Question it answers |
|---|---|---|
| **Who** | `author_id`, or `is_self`, or neither | Whose words are these? |
| **From** | `work_id` | What work is it from? |
| **Where** | `details.citation` — free text | Where in it? |

One rule generates every case
([`src/lib/provenance.ts`](../../src/lib/provenance.ts), 33 unit tests):

```
THE LINE — always visible
  1. Who = Me                     →  (nothing at all)
  2. Who = a person               →  the name
  3. no Who, but a Where          →  the locator
  4. no Who, no Where, but a From →  the work
  5. none of the three            →  (nothing at all)

THE REVEAL — on demand; absent entirely when there is nothing behind it
  A. Who = Me                     →  "Michael Chen"
  B. otherwise                    →  everything the line didn't say
```

Four decisions follow from it, and each is the load-bearing part of a different
complaint:

**1. `attribution` becomes derived, and is computed server-side.** The form
never asks for it; `saveQuote` computes it from the three facts on every save
and writes it. It survives as a nullable **per-quote override**, revealed behind
a `change` control — the exception rather than the thing you fill in every time.
Applied to all 76 live quotes the rule reproduced what Michael had typed by hand
on **74**, and on **76** after a migration moved two scripture locators out of
the column meant for names. **Zero surviving overrides.**

**2. The Where is free text, permanently.** The corpus already holds six
citation traditions — books and verses, letters and verses, chapter-and-verse,
acts and scenes, a bare circumstance (*"in conversation"*), and an
attribution-within-an-attribution (*"quoted in Seneca, Letter 24:19–20"*). A
structured locator would have to know which tradition it is in, which makes
choosing one a new decision on every quote — the exact overhead this exists to
remove — and needs a new branch for every tradition that turns up next. That is
the `scriptureRe` mistake generalised and made permanent. **The rule to hold in
your head: the Where is whatever you'd say out loud after the name.**

**3. `is_self` — a boolean column, because silence means two opposite things.**
"Michael wrote it" and "nobody knows" both render no line. On his own site his
own words are the default voice — the essays do not sign themselves, and this is
also the convention among aphorists (Taleb, La Rochefoucauld, Cioran; Marcus
Aurelius wrote *Meditations* to himself and signed nothing). **You sign at the
level where authorship is ambiguous, and on a single-author site the item level
never is.** But a blank field cannot mean both in a corpus that only grows, and
the workshop must be able to say `your words` where it otherwise says
`source unknown` — or every such row reads as one you forgot to finish.
⚠ **Michael is never a row in `authors`**: an author row would give the
derivation a name to lead with and sign every one of them.

**4. The citation becomes reachable — and the attribution is the control.**
`details.citation` had 23 rows and no reader. It is now what a **reveal** opens
onto: the attribution line itself is a button, a dotted underline appears on
hover and focus, and the citation opens beneath it in the native top layer
([`QuoteReveal.astro`](../../src/components/QuoteReveal.astro)). **Nothing is
added to the line** — no glyph, no icon, no footnote mark. Four candidates were
built and compared on real quotes on the **reveal-lab** bench; every other one
made the quietest line on the site louder. *(The bench was removed 2026-08-10 —
`git log -- src/pages/reveal-lab.astro` has the four.)*

## Consequences

- **Entering a quote is three mechanical fields and a sentence you can read.**
  The judgement moved out of "which field does the reader see" and into a live
  preview that shows the line *and* what the reveal holds. That preview is the
  actual fix for "overwhelming" — the fields stopped requiring a mental model.
- **A locator can never be mistaken for a name**, because a locator is never
  stored where a name goes. The `scriptureRe` special case is gone rather than
  extended.
- **The three scripture rows group as one and display as three** — which had
  never been true.
- **`details` is down to one key.** Four were deleted; the drawer of write-only
  fields that made this plan necessary is nearly empty.
- ⚠ **`attribution` is still stored, not dropped.** The renderers read the
  column for the line, so emptying it would blank every published card. It is
  now provably redundant (stored == derived on all 76 rows and on every new
  save), and emptying it is a one-line follow-up when the renderers derive.
  **Until then it is a denormalization that must be written on every save** —
  which `saveQuote` does, from the canonical names, not from what the client
  sent.
- ⚠ **The reveal's price is discoverability, accepted knowingly.** Nothing
  announces that the line is interactive until a pointer or focus ring is on it.
  This was chosen over every louder alternative because the citation answers a
  question most readers never ask, and the ones who do ask reach for the
  attribution first. **It is keyboard-reachable and labelled** — hover is never
  the only way in.
- **`authors` and `works` now reach the public site**, for the reveal only. Both
  are `select → true` for `anon` in RLS; closing that would empty the reveal
  rather than break the page.
- **Three fields is a claim, not a fact.** The model fits all 76 quotes and the
  fourteen cases enumerated before it was built. A fifteenth shape may not fit,
  and the honest response then is a better rule or an override — **not a fifth
  field creeping back in.**

## Alternatives

- **Label the fields better.** This plan's own first proposal, and rejected by
  its author: explaining a seven-field model does not help when the model is the
  problem. Too small, not wrong.
- **A toggle for whether the citation shows** — per quote, or per category
  ("scripture always shows its reference"). Rejected: the rule already produces
  the right answer for every case, because **the Where joins the line only when
  it has to**. Scripture leads with its locator because it has no author to lead
  with; that is clause 3, not an exception. A toggle would be a second source of
  truth for a question the first one already answers, and getting the two out of
  step is a bug you can only find by reading.
- **A structured locator** (book / chapter / verse fields). Rejected — see
  decision 2. Six traditions, and the seventh arrives next year.
- **A fourth `fragment_type` for self-authored quotes.** Rejected on cost:
  `fragment_type` is a Postgres enum, so a new member means a migration plus
  `TYPE_META`, the glyph set, every `switch` on type, the Add ▾ menus, the
  export, the type-count badges and the filters — **to produce something that
  renders identically to a quote.**
- **A "my own words" checkbox** beside the attribution. Rejected — every quote
  answers "who said it", and sometimes the answer is you. A checkbox makes a
  fourth thing to remember out of a case the model already covers. `Me` is the
  first option under *Who*.
- **`Me` as a row in `authors`.** Rejected, and warned against in three places,
  because it is precisely the simplification a future session would make on
  sight. It would render `— Michael Chen` under every aphorism on his own site.
- **Appending the Where to the line whenever it exists.** This was the first
  draft of the display rule, and it would have silently rewritten **22 live
  published cards** from `— Marcus Aurelius` to `— Marcus Aurelius, Book 8:9` —
  a public design change smuggled inside an admin fix. The reveal is what made
  the whole change additive.
- **Nulling `attribution` in the migration**, as the plan originally specified.
  Deferred, not rejected — see Consequences. The renderers read the column.
- **Three other reveal controls** — a raised hairline `＋`, a caret that unfolds
  the citation in place, and a true footnote collecting at the page foot. All
  built, all compared side by side on real quotes. The caret reflows the page
  under the reader's eye, which is costly in a suite where the drawn arcs
  between stanzas are positioned; the footnote puts the citation far from the
  quote and numbers imply an order the corpus does not have; the `＋` was the
  runner-up and lost only on quietness.

## What this leaves of 0008

**Everything except the display half.** `authors` and `works` as tables, the
query axis, `/admin/library`, the merge/rename surface, and the insight that
*what you group by and what you show must be allowed to differ* — all stand. The
Bible rule stands too; it simply stopped being a rule. It is now what the
derivation does when a work has no author.
