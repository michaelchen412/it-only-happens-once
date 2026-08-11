# 0030 — The chrome recedes; the page carries the masthead

Status: **Accepted** *(2026-08-11)*
Date: 2026-08-11

## Context

The public top bar was a 56px sticky strip: translucent blurred ground, hairline
bottom, the site's name at the left in the slot where a logo goes, three links
and a sun/moon at the right, the active link underlined in `--color-primary`.
Michael, looking at `/blog`: ***"if I look at the main site header for the blog,
I feel like it's a little bit generic."***

That feeling resolved into four findings, and they are not equally important.

1. **The shape is the starter-template shape.** Every piece is defensible alone.
   The arrangement is the thing design.md §3 bans on sight — it could belong to
   anyone.
2. **The wordmark is the site's best asset, rendered as a nav label.** "It Only
   Happens Once" is a whole sentence and the site's whole thesis, set at 16/18px,
   `leading-none`, `whitespace-nowrap`. Newsreader carries optical sizing
   precisely so a display face can behave differently at masthead scale. The
   header never asked it to.
3. **On `/blog` there were two mastheads, stacked.** The bar, then 2rem below it
   the Writing · Quotes · Music switch at `text-3xl` — *and both marked "where
   you are" the same way*, with a `border-primary` underline. One idiom, two
   sizes, one directly above the other. The lower one is the good, editorial,
   specifically-his element; the bar read as a weaker echo of the thing it sat
   on. **This was most of the feeling.**
4. **And that underline is accent in chrome**, which §5 forbids in the sentence
   that defines it: *"Accent color is for content, never for chrome … it never
   colors a label, an eyebrow, or a category tag."* An active-state marker is
   furniture.

⚠ **The star was never on the table, and its being banned is what made the
answer good.** §3's reserved-glyph rule keeps ✦ and `StarMark` for the
constellations, so no variant could reach for a mark. Every one had to be made
of **structure and typography** — which is what §3 says distinctiveness is made
of anyway. The obvious first move was ruled out before it could be drawn.

## Decision

**The bar is a running head. The room's own switch is the masthead. The footer
is an address block, not an ending.** One claim about where authority sits on a
page, in three parts.

**The bar recedes.** No hairline, no blur, a solid ground, 3.25rem, and one
uniform typographic register across the whole line: the site's name set in the
same serif small caps as the links beside it, **at the same size**,
distinguished only by ink (80% against their 60%, full for the active item). The
running head of a printed book, where the page you are on is the thing you read
and the head above it is a courtesy.

The ground goes **solid rather than transparent**. A sticky header still has to
hide what passes under it; "no background" is a different proposal — an overlay
— and nothing here is making it.

**The accent leaves the bar.** Ink alone marks the active item. The lamplight
underline stays on the **page's** switch, where the thing being marked is
content navigation rather than furniture, so §5 is obeyed and nothing is lost:
"where you are" is still said once, loudly, below. That is also the answer to
finding 3 — not *"which of the two mastheads wins"* but *"only one of them was
ever a masthead."*

**The footer closes nothing.** Site links left, three utilities right, one line,
the bar's own register, so both ends of the page speak the same way:

    Constellations · Blog · About                Say hello   ⌁ RSS   ⌗ GitHub

**And the ⌗ stays in the bar even though the footer now carries the same mark.**
They are not the same claim. The bar's is a **credential**, and a credential
works by being *seen*, not by being read: it says at a glance, before anything is
opened, that a person built this. Michael: *"I did want to keep the GitHub button
at the top since I do want it to be known that I didn't use a website builder."*
The footer's says *how*. The division of labour that falls out of it is what
designed the footer — the **popover is a drawer** (opened on demand, reachable
from every page including short ones, good at detail); the **footer is a
terminus** (reached only by finishing, and therefore good at the two things a
drawer is bad at: what to do next, and what you want found by someone who read to
the end).

**One sentence on the rename, which gets no ADR of its own.** The bar's first
item now says **Constellations**, not Home. §13 had been holding both positions
since July — chrome that said Home, prose that said *"Visitors see
**constellations**"* — and `/constellations` has 301'd to `/` the whole time, so
the routing was already calling the room by this name. "Home" was the more
generic of the two words in the most-seen row on the site, which is finding 1 in
miniature. It earns its place here as the reason the visitor vocabulary and the
chrome vocabulary are finally the same word. The prop key stays `home`.

## Consequences

**A solid bar over a same-coloured page has no lower edge, and something has to
pay for that.** *(Added the same day, before this record was first committed —
the amendment path the index describes for 0014: a decision is corrected on the
way in, never after.)* Dropping the hairline is right and it is not free. With a
`bg-base-100` strip over a `bg-base-100` page there is no visual event when
content passes under, so at scroll 640 on `/blog` a line of an excerpt was
**guillotined mid-letterform** at exactly y=52 — descenders sliced, nothing to
attribute the disappearance to. It did not read as text passing behind a bar; it
read as a clipping bug. Michael: *"you clearly see the content going into a
uniform background into the void."*

**The answer is a scrim: 1.5rem of ground fading out below the bar, so content
dissolves before it reaches the edge.** Three candidates were driven side by side
over the real feed in both themes.

- **A hairline** works, and costs twice — it re-imports one of the four pieces of
  the starter-template shape above, and on `/blog` it puts a full-bleed rule 78px
  above the page's own `max-w-6xl` rule under the switch. Two rules, different
  widths, close together: the same "bolted on" geometry the footer's measure
  ruling exists to avoid at the other end of the page.
- **Glass** — translucency plus `backdrop-filter` — is the obvious reach and the
  worst of the three. Measured at 82% over `oklch(20%)` ground with a 14px blur:
  cream text at `oklch(91%)` smears to a faint grey ghost **and the guillotine is
  still there underneath it.** A frosted strip is the most recognisable single
  item on §3's list of tells, and it buys almost nothing on dusk — the theme
  nearly every visitor sees, since `Base.astro` deliberately never consults the
  OS preference. It reads strongest on `paper`, which fewest people see. **The
  tell is loud and the effect is quiet**, which is the trade backwards.
- **The scrim** wins on two properties rather than on taste. It **self-hides with
  no JavaScript** — the other good answer, a hairline that fades in past scroll
  0, needs a listener, a class and a state, while a gradient from the ground into
  the ground is invisible exactly when there is nothing to hide (verified at
  scroll 0 on `/`). And it is **a gesture this site already makes twice**:
  `.excerpt-fade`, and ADR-0029's writing sheet fading in from the left so the
  drawn figure passes through it. On a constellation suite the spline now fades
  as it goes under the bar, which makes the bar the same kind of soft boundary
  the sheet is rather than a lid the drawing hits.

Two costs accepted: it eats ~24px, so on a post roughly one line dissolves (that
line is leaving anyway); and over a photograph a fade-to-ground reads as a smear
rather than a dissolve, so **cover images in the feed would reopen this**. Two
implementation notes are load-bearing rather than tidy, and both are argued
beside the CSS: `z-index: -1`, because `::after` is the header's last child and
the mobile dropdown opens into exactly the band it paints; and
`pointer-events: none`, without which the top 24px of every page silently stops
taking clicks.


**A footer needs a measure, and this site has four.** The sky is `max-w-4xl`,
the feed `max-w-6xl`, a post `max-w-3xl`, `/about` `max-w-2xl`. "Line up with the
content" is therefore not available to a site-wide element — no single width
aligns with more than one room. The footer takes the **widest**, because its job
at the end of the page is to be the outermost thing: anything narrower reads as
inset *inside* the feed it is closing, and full-bleed (the bar's own measure)
strands two link groups at opposite ends of a 1900px viewport, which is the
generic footer this replaced. `space-between` needs a bounded line. **The visible
cost is real and accepted:** in every room but `/blog` the footer's rule is wider
than the last rule of the content above it.

**Nothing a reader needs may live only in the footer.** `scripts/blog-feed.ts`
appends pages as you scroll and stops only at `pageCount`, so in the site's
busiest room the footer is reached last or never. RSS gaining a footer address
passes that test only because it stays in the colophon drawer too.

**A second trigger found two latent defects in shipped code, and neither was
reachable with one.** This is the argument for the bench in two lines:

- `Colophon.astro` positioned its drawer against
  `document.querySelector('button[popovertarget="site-colophon"]')` — the
  **first** such button in the document, always the bar's. A footer trigger
  placed the drawer under a button ~2,000px above: off-screen, at the top of a
  page you are at the bottom of. It now anchors to the button that was pressed.
- The drawer itself was rendered **inside** the bar's utilities `<div>`, which
  is inside `#site-menu`, which is `display: none` below `md:` until the
  hamburger opens it. Harmless while the only trigger lived in there with it —
  pressing it meant the menu was open. With two triggers it is a silent failure:
  on a phone the footer's ⌗ flips the popover to `:popover-open` and paints
  nothing, because an element in a `display: none` subtree has no box (measured
  0×0). **`Colophon.astro` now renders the drawer and no trigger at all**, and is
  mounted once at layout level, in a place that belongs to neither trigger.

**The colophon drawer widened to 24rem.** Its lead-in became *"This site is an
independent project built with"* the same day — the one line in there that
actually makes the claim the ⌗ is standing for — and at 22rem it measured 310px
inside a 312px content box. One line, and one line only by luck: a fallback face
while Newsreader loads, or one more word, wraps it. Widening was the option that
cost nothing, since this is a drawer rather than a card and nothing else in it is
width-constrained.

**Two `design.md` sections were edited rather than left to drift** — §13's
Home paragraph, which this reverses, and §14's wordmark line, which this half
answers. That file is git-ignored, which is exactly why this ADR exists.

**The `md:` collapse point did not move**, and the floating back-to-top control
governs the footer's bottom padding: `.back-to-top` (and the sky's ✦) is fixed at
1.25rem and 2.75rem tall, so it owns the bottom 4rem of the viewport at the right
edge — exactly where the footer's last item sits when you are scrolled to the
end. At 3rem the ⌗ and the ↑ met to the pixel; 5rem clears it by 33.

## Alternatives rejected

Seven header variants and nine footer variants were built on a dev-gated bench
(`src/pages/lab/chrome.astro`) that restyled `SiteLayout`'s **real** DOM — so the
control was the shipped element rather than a copy of it — over the real blog
feed and the real sky. These are the ones a competent person would re-propose.

**For the bar:**

- **`masthead`** — the sentence at display size on its own line, nav as a
  contents line beneath. A journal cover, and the most obvious answer to finding
  2. It costs vertical space on every page forever, and it pays for that by
  demoting the page's own switch to an instrument panel — trading the good
  masthead for a new one.
- **`spine`** — the three links leave the bar entirely and rejoin the page's own
  switch row on one baseline. Solves finding 3 by deletion. It makes the site's
  navigation a property of each page's layout, which is a much larger claim than
  the problem needed.

**For the footer — four variants were built on the assumption that a footer's
job is to CLOSE, and all four are wrong for the same reason:**

- **`invitation`** generalised `ConstellationSuite`'s outro (a rule, `pt-16`, a
  `text-4xl` "← return") to every room; **`provenance`** and **`addresses`** hung
  one thing off that close; **`reprise`** set the wordmark again as a back cover.

  **The suite already closes, and it closes upward.** A site-wide return
  duplicates that in the one room where it works and *invents a destination* in
  the room where it does not — at the front door "upward" means nothing, so the
  variant had to turn its arrow around and offer "the writing". A close that
  changes direction per room is two patterns wearing one coat. Michael: *"the
  return button for footer is just bad."*

- **`colophon`** unfolded the popover into the page and took the ⌗ out of the
  bar, on the argument that end matter cannot live in two places. That argument
  was answering the wrong question — see the credential/drawer split above.

**Two arrangements lost to measurement, and both measurements are the point:**

- **`chrome`** dropped the utilities to §7's chrome register (uppercase sans,
  11.5px) while the links stayed serif small caps (16px), on the argument that
  destinations and instruments are different kinds of thing. Measured: **243px
  wide against 245px**, cap heights nearly identical. The two registers land in
  the same place at this size. **A fork that cannot be seen is not a fork.**
- **`stack`** put the two groups on two lines flush left. Measured at 390px:
  **143px tall against 149px**, and *both are two lines* — `stack` is simply what
  the shipped arrangement already becomes on a phone. It differs only above
  ~600px, where one line reads better anyway.

⚠ **The bench is not in `git log`.** Unlike `/lab/page-card` (ADR-0029),
`src/pages/lab/chrome.astro` was never committed, so nothing above is
reconstructible from the repository by any other route. That is not a footnote
about tidiness — it is the reason this record is Accepted rather than deferred,
and the reason the losing variants are described here in enough detail to be
re-derived rather than merely named.

## Still open

- **`provenance` is unplaced, not dead.** A single line ending in the commit the
  deploy was built from, linked: *a website builder can render the words "hand
  built"; it cannot render a SHA that resolves.* `VERCEL_GIT_COMMIT_SHA` is set
  on every build and read by nothing. It did not survive as a **footer** because
  it needs prose around it and this footer has none.
- **A constellation suite gets a site footer under an outro that already closes**
  — the second ending in a row, and the one room where the decision above might
  simply be wrong. Suppressing it there would be the first time the public chrome
  forks by room, which is a bigger claim than this change earned, so it ships
  uniform and the question stays open.
- **§14's wordmark item.** Every variant set the **same words in the same face**
  and changed only their rank. Whether the sentence should be drawn, lettered,
  broken across lines or given a mark of its own is a separate question, and this
  decision is upstream of it: **rank first, then form.**
