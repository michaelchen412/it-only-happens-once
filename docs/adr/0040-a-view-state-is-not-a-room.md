# 0040 — A view state is not a room

Status: **Accepted** *(2026-08-21)*
Date: 2026-08-21
Supersedes: docs/plans/33 §4 ruling 4 (*"Music is a third register"* — a view of
the Index, not a route). Amends [0035](0035-a-set-is-a-listen-you-can-take-away.md)
and [0031](0031-a-song-carries-a-feeling-not-an-idea.md), which both name the old
address in passing.

## Context

Michael, looking at the top bar: ***"I'm kind of wanting users to be able to see
that I have other sections of the blog — mainly wanting to highlight that I have
a quote and music collection and not merely writing. But the blog button in both
the top nav bar as well as the footer only say 'Blog'."***

The corpus behind that one word, measured the same day: **57 published essays,
83 quotes, 8 published sets**. So the complaint is sharper than
under-description. **"Blog" is a genre label that promises exactly one of the
three things in the room** — it is not silent about the quotes and the music, it
is wrong about them.

Two things made the obvious fix unavailable and a better one visible.

**1. The bar cannot enumerate.** [0030](0030-the-page-carries-the-masthead.md)
had just finished ruling that the bar is a running head and the page's own
`Writing · Quotes · Music` switch is the only masthead — *because* `/blog` had
been showing two mastheads stacked, both marking "where you are" the same way.
Splitting the nav item into three would have printed those same three words in
the bar, at 780px, directly above the switch printing them at `text-3xl`. Not a
regression of that ADR by analogy: the same defect, with the words now matched.
A dropdown (click or hover) failed differently and worse — it hides the answer
behind the word that already failed, costs "Blog" its destination, and below
`md:` the row is a burger where hover does not exist at all.

**2. Music had never actually been a view.** It was ruled one in plan 33 §4, and
the code spent four months disagreeing in every line it wrote about it:

| The two text views | Music |
| --- | --- |
| A subject taxonomy in a sticky rail | No rail — `view === 'music' ? [] : listSubjects(…)` |
| A paginated feed with infinite scroll | No feed, no pagination, no `?page` |
| Search, debounced, server + client | No search |
| Filtered by **subjects** | Filtered by **feelings** ([0031](0031-a-song-carries-a-feeling-not-an-idea.md)) |
| `?view=` | `?view=` **and** `?set=` |

`blog/index.astro` carried `view === 'music'` or `view !== 'music'` in seven
places, and the two biggest subtrees on the page were guarded by one of them.
That is a room's worth of exceptions wearing a view's clothes. The file's own
header had already half-admitted it — *"MUSIC IS A THIRD REGISTER — not a third
list"* — and a register with its own vocabulary, its own act and none of the
machinery is a **room** that had not been given an address.

There is also a silent cost that nobody was going to notice. `canonicalPath`
drops the query string, correctly: filter state is not a document. So
`/blog?view=music` canonicalised to `/blog` — **the sets have been live since
2026-08-11 and no crawler has ever been told they exist**, and none could have
been while the room was a parameter.

## Decision

**Two claims, and the second one only came into view once the first had
shipped.**

### 1. A view state is not a destination

**The room leaves `/blog` for a route of its own, and the top bar gets a fourth
room rather than a fork.**

    Constellations · Blog · Listening · About

- `/listening` is a route: `MusicSets` full width, `?set=<slug>` for the open
  one, an `sr-only` h1, and no visible masthead — the index of set titles in
  display type is the page, which is `MusicSets`' own rule and `/about`'s
  pattern.
- `/blog?view=music` **301s** to it, carrying `?set=` along. Cached at the edge
  for a year and in a browser for an hour, the pair `constellations.astro`
  argues for.
- `/blog` loses the third tab, the `Music soon` word, the `musicOpen` count
  query on every request, and the Spotify controller it was importing into two
  views that never had a pane for it.
- The room joins `sitemap.xml` — the first time the sets are listed anywhere a
  crawler reads.

**What this constrains:** a section of this site earns a route when it stops
sharing the machinery of the room it sits in. The test is not importance,
traffic or how much Michael wants it seen — it is whether the guards have
appeared. When a page starts branching its rail, its feed and its filters on
which state it is in, the state has become a room, and the branches are the bill
for not saying so.

### 2. Name the act, not the artifact — when the artifact would over-claim

**The room shipped as `Music` at `/music` and was renamed the same afternoon.**
Michael, on seeing it in the bar: ***"it implies too much that I may be a
musician and that I'm trying to share music I made, but may lead the user to be
disappointed that I'm merely sharing playlists."***

He is right, and the cost lands earlier than the disappointment does. Beside
`About` on a personal site, **`Music` is the slot a discography goes in** — the
word was making a claim the site cannot back, which is design.md §3's problem
wearing a different coat: the label belongs more naturally to a different kind of
site than this one. The room resolves the misread in about two seconds (eight
sentence-titled sets and a Spotify player), and the embed prints *Michael Chen*
under the playlist title, so for those two seconds the wrong reading is being
reinforced rather than corrected.

**`Listening` cannot be read as authorship.** It names what Michael does with
this music rather than what he made of it — the same convention a *Reading* page
uses, and understood the same way. It also costs nothing that `Music` was
buying: a stranger still learns from the bar that the site is more than essays,
which was the entire ask.

It is not a new coinage either. `design.md` §13 has carried ***"whether
`/listening` exists"*** as an open question since July, never struck through.
This strikes it.

**The route moved with the word, not just the label.** `/` gets away with being
labelled `Constellations` because its path is a slash; a `/music` under the word
`Listening` would put the retired claim back into every shared link, which is the
one place a label cannot follow you. This was free because nothing had been
committed yet — the general rule is that a public URL is a promise and the 301 is
what it costs, so the moment to get a name right is before the first deploy.

**And the schema did not follow:** `sets`, `songs`, `MusicSets`,
`scripts/music-sets.ts`, `/admin/sets` and the `song` fragment type all keep
their names. Those describe what the corpus can HOLD; the room name describes
what a reader is invited to do. It is the same division `index.astro` already
argues for the word *jazz*, applied in the other direction.

**What this constrains:** when a room's obvious name would let a reader infer a
role Michael does not hold, name the act instead. The test is not whether the
word is accurate — `Music` was perfectly accurate — but whether a stranger can
draw a false claim out of it before the page has a chance to answer.

## Consequences

- **The nav says something true.** A stranger who never clicks anything now
  learns the site has music. That was the whole ask, and it cost one array entry
  because the room turned out to be real.
- **`/blog` gets simpler in exactly the places it was worst.** Seven branches
  gone, one query gone, one script import gone from the busiest route on the
  site.
- **The sets become indexable.** See above; this is the change nobody asked for
  and the one with the longest tail.
- **The `§9` gate retires.** The tab waited on one published set before
  announcing itself. The nav item does not wait, and re-gating it would mean a
  count query in `SiteLayout` on *every* route, public and admin, to answer a
  question whose answer is yes. The room's empty state covers the case instead,
  which is what it was always for.
- **The blog's switch is a pair now**, `Writing · Quotes`, which is a more
  honest control than the three ever were: both are text, both are retrieval
  over one taxonomy, and they genuinely share the rail below them.
- **Accepted cost — the collection story is told in two places.** "Blog" still
  under-describes the room it names, and a reader now learns about the quotes
  only by clicking. This ADR answers the music half of Michael's sentence and
  not the quotes half. Renaming the item (**Library** is the site's own word for
  this corpus — `/admin/library` manages all three kinds) is the open question,
  and it is one string; it belongs on the `/lab/chrome` bench with the wordmark,
  which `design.md` §14 has never struck through.
- **Accepted cost — a fourth item in a 3.25rem bar, and the longer of the two
  words.** Measured at 780px, the tightest width where the row is still
  horizontal: "Listening" sets at 70px, its `gap-5` adds 20, and the space
  between wordmark and nav goes from the 264px [0029](0029-a-writing-stanza-sits-on-a-page.md)
  recorded to **174px**. Room for two more items of that length, so the fourth
  room is not what will eventually bite this row.

## Alternatives

- **Three nav items (Writing · Quotes · Music).** The obvious one, and it is the
  two-mastheads defect of [0030](0030-the-page-carries-the-masthead.md) restored
  with the words matched. It also flattens rank — Music becomes a peer of the
  entire Sky — and breaks `active`, which is one key per room and knows nothing
  about query strings.
- **"Blog" in the bar, the three split in the footer.** The best of the ones
  that keep music a view, and it respects the two ends' different jobs. It loses
  on reach: the footer is read by people who *finish*, which is the smallest and
  most-already-converted audience, and the ask was about strangers.
- **A dropdown under "Blog"** — click or hover. Hides the answer behind the word
  that failed; costs the item its destination or adds a second target to a
  3.25rem bar; and the hover variant does not exist on touch, where this row is
  a burger. It is also the most generic chrome pattern there is, on a site whose
  design.md §3 bans the arrangement that could belong to anyone.
- **Keep the tab AND add the nav item.** Rejected as two doors with one name and
  two different active states — the same "two names for one door" argument
  [0030](0030-the-page-carries-the-masthead.md) settled for Source/GitHub, in
  reverse.
- **Leave `?view=music` answering as well.** Two addresses for one room, one of
  them canonicalising to the writing feed. The 301 is the whole point.
- **`Music`** — see Decision 2; it shipped and was withdrawn the same day.
- **`Playlists`.** Kills the ambiguity outright and undersells the thing: it is
  Spotify's word for a container, where [0035](0035-a-set-is-a-listen-you-can-take-away.md)'s
  whole argument is that a set is a listen with a sentence and a quote attached.
- **`Jazz`**, to match the homepage copy. Carries the *same* authorship
  ambiguity as `Music` and arguably more — a site whose nav says Jazz reads like
  a player's.
