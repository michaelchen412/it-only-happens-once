# 0021 — Dark is the default, not the system preference

Status: **Proposed** *(2026-08-07. The change is shipped; this records why, per
this repo's pattern that an ADR is written when the decision is made. It becomes
**Accepted** once the dark-first first impression has been lived with on a real
light-mode machine for long enough to know whether the one-click cost is
actually paid cheerfully.)*
Date: 2026-08-07

## Context

The theme was picked before paint by a three-step rule, in `Base.astro` and
again after every view-transition swap:

> saved choice → `prefers-color-scheme: light` ? `paper` : `dusk`

Which reads as obviously correct. Respecting the operating system is the
standard courtesy, it costs nothing, and the site has two real themes rather
than one theme and an apology — `paper` is a designed surface, not a
high-contrast fallback.

**The problem is what it does to a first impression.** This site was drawn at
dusk. `app.css` says so in its own banner: the two themes are "the same room at
different hours", and the room is a night one — *"the night sky as INTIMACY, not
as space. Warm ink, cream text, lamplight amber. A jazz club at 11pm; a porch at
dusk."* Concretely:

- **The Sky only reads as a sky against dark.** The whole overview is stars at
  varying brightness on a ground — `.sky-star` carries a `drop-shadow` glow, the
  magnitude ramp is expressed as brightness rather than size, and `StarBloom`
  parts a point of light into companions. On paper that is a set of small warm
  marks on cream. It still works; it is not the thing.
- **The accent ramps were tuned there.** The constellation colour slots are
  OKLCH values chosen against `base-100` at dusk, and paper re-derives them.
- **`paper` exists for long-form reading**, which is a reader's second act. It is
  the concession, not the design.

So the rule handed a first-time visitor on a light machine — which is most
machines, and effectively all machines in daylight — the weaker of the two
themes, silently, with no indication that another one existed. The toggle is in
the header, but a control that changes something you have never seen does not
read as an invitation.

There was a second, smaller symptom that turned out to have the same cause. The
standalone app's status bar was tinted by two metas:

```html
<meta name="theme-color" media="(prefers-color-scheme: dark)"  content="#1a1511" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f9f6f1" />
```

documented as a known seam — following the system was *close enough*, and cheaper
than duplicating the toggle's logic into `<head>`. That was true only while the
page followed the system too.

## Decision

**Dark is the site's own default. Light is an opt-in, and it persists.**

The pick becomes two steps, in both places it happens:

> a saved `paper` wins; otherwise `dusk`

`prefers-color-scheme` is **not consulted at all** — not as a tiebreak, not on
first visit. The operating system's preference is a fact about the machine; which
of two designed rooms this site opens in is a fact about the site.

**And the status bar follows the choice rather than the machine.** One
unconditional `theme-color` rendered at dusk, re-tinted by
`scripts/theme-toggle.ts` whenever the theme changes. The seam the media-query
version was documented as accepting — "a forced theme can leave the bar a shade
out" — stopped being an edge case the moment dusk became unconditional: a
light-machine user would have got the dark app under a paper-coloured bar
**every** time.

## Consequences

- ⚠ **A reader who keeps their whole machine light gets a dark page they did not
  ask for.** This is the real cost and it is accepted, not argued away. It is one
  press of the sun, remembered forever, against a first impression of the site as
  it was actually designed.
- The two `theme-color` metas become one, and `theme-toggle.ts` gains the job of
  keeping it in step. ⚠ **The two colours are duplicated there as hex literals**,
  because `<meta>` cannot read a custom property. They are `--color-base-100` in
  each theme — but that token is authored in **OKLCH**
  (`oklch(20% 0.012 62)` / `oklch(97.5% 0.008 82)`), so these are hand-rendered
  approximations rather than the same string in two places. Nothing checks them
  against each other, and a change to either theme's base will not show up here
  until someone notices the status bar is a shade out. Named at the constant, and
  named again here because it is the one piece of drift this decision creates.
- **Accessibility is unchanged, and this is the check worth stating.** The
  decision overrides a *preference*, never a need: `prefers-reduced-motion` is
  untouched and still zeroes every duration, and both themes are contrast-checked
  surfaces rather than one real theme and a fallback. A reader who needs light
  has a control that takes one press and never forgets.
- `localStorage` now holds the only signal, so a reader who clears site data
  returns to dusk. That is the same trade the old rule made in the other
  direction and is the point of a default.
- Pinned by two specs under `test.use({ colorScheme: 'light' })`: a light machine
  with no saved choice still lands on dusk, and an explicit `paper` still
  survives a reload. The first would have failed before this change, which is why
  it is the one that matters.

## Alternatives

**Keep following the system, and make the toggle louder.** The obvious repair
once the problem is stated as discoverability — a tooltip, a one-time hint, a
brighter control. Rejected because it treats a first impression as something that
can be annotated. The reader who most needs to see the Sky at dusk is the one
who has not yet decided the site is worth a second gesture, and asking them to
make one is asking at exactly the wrong moment.

**Follow the system only on the public side; force dusk in the Observatory (or
the reverse).** Rejected: two rules is not a smaller decision than one, it is a
larger one that also has to be remembered. `Base.astro` is deliberately the one
place the pick happens, and both layouts wrap it.

**Ship `paper` as the default instead.** Considered honestly, because most
machines are light and a light default would make the OS question moot. Rejected
on the same evidence that motivates this ADR: the Sky, the glow, the bloom and
the colour ramps are dusk's. Defaulting to paper would mean defaulting to the
concession.

**Detect once, then stop following.** Read `prefers-color-scheme` on the first
visit only, write the result to `localStorage`, and honour that thereafter.
Rejected as the worst of both: it still hands most first-time readers `paper`,
and it does so *stickily*, so the one visit that mattered is also the one that
gets recorded.
