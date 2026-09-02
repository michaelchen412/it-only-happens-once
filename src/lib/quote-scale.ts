/**
 * HOW LARGE A QUOTE IS SET, AS A FUNCTION OF HOW MUCH OF IT THERE IS.
 *
 * THE QUESTION WAS: how far does a quote's type fall as the quote gets longer,
 * and on which surfaces? Michael, 2026-09-01: *"for longer quotes that are
 * displayed on the public frontend, we probably want to reduce the font size as
 * things get larger. The large font is nice for short quotes and it's very
 * beautiful and aesthetic, but for some longer ones that can be ostentatious."*
 *
 * ANSWERED on `/lab/quotes`, over all 83 published quotes at their real lengths:
 * **a continuous curve, on all four surfaces.** The two rivals — the three
 * hardcoded steps that shipped, and a finer five-tier version of them — are
 * deleted rather than kept as controls, which is the rule this repo's benches
 * run on. What they were is in `git log`, and the bench that compared them is in
 * the same place.
 *
 * ⚠ ONE OF FOUR SURFACES RAMPED BEFORE THIS, and that was the larger half of the
 * problem. `QuoteArticle` had carried a three-step ramp since the quote page
 * shipped; `QuoteCard` (the feed), `SuiteStanza` (a constellation suite) and
 * `MusicSets` (/listening) were FLAT — a 30-character aphorism and an
 * 843-character passage set identically on three surfaces out of four. That is
 * not visible from inside any single component, which is why the ramp is a
 * primitive here rather than a fourth copy of a size ladder.
 *
 * ⚠ THE RAMP IS SHARED AND THE REGISTERS ARE NOT, which is the distinction
 * `app.css` already draws about `.quote-body`: *"a quote sets its own scale per
 * surface (2.6rem on a permalink, 1.35rem in the feed)"*. A permalink and a feed
 * card disagree about how large a SHORT quote should be, and they go on
 * disagreeing. What they must not disagree about is the SHAPE of the fall from
 * short to long. So this file answers "how far down its own range does this
 * length sit" and the surface answers "what is my range".
 */

/**
 * Where a length sits on its surface's range: `0` is the largest that surface
 * sets a quote, `1` the smallest. Deliberately unitless — the curve knows
 * nothing about rem, which is what lets one of it drive four registers.
 *
 * ⚠ CONTINUOUS, AND ON THE LOG OF THE LENGTH RATHER THAN THE LENGTH. Linear
 * interpolation is wrong here and the corpus says why: raw length puts the
 * median quote at `(121 − 30) / (843 − 30)` = **0.11**, barely off the top of
 * the range, and then spends the whole rest of the ramp on the nine quotes past
 * 500 characters. The eye does not read length linearly either — the step from
 * 40 characters to 120 changes what is on the page far more than the step from
 * 700 to 780 does.
 *
 * On a log scale that same median lands at 0.42, which is where a reader would
 * put it. `LO`/`HI` are the ends of the USEFUL range rather than the corpus
 * extremes: below 40 characters every candidate agreed on "as large as this
 * surface goes", and past 550 a quote is a passage and wants the floor.
 *
 * ⚠ AND IT PASSES ABOVE THE OLD RAMP ON THE WAY DOWN, which is a real change and
 * not a rounding artefact. The three steps dropped 23% at a single character
 * (2.6rem → 2.0rem at 90), so a curve that removes the cliff must sit higher
 * than it just after it: everything from 90 to about 141 characters is set up to
 * 11% LARGER than it used to be, level again by 141, and smaller from there on.
 * Judged on the bench and kept — the cliff was the thing worth losing.
 */
const LO = 40;
const HI = 550;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function ramp(len: number): number {
  return clamp01((Math.log(Math.max(len, 1)) - Math.log(LO)) / (Math.log(HI) - Math.log(LO)));
}

/**
 * A surface's own range, `[largest, smallest]` in rem, at the two widths the
 * site's type already switches on.
 *
 * ⚠ EVERY `largest` IS WHAT THAT SURFACE SHIPPED BEFORE THE RAMP, deliberately:
 * the ask was to bring the long ones DOWN, not to push the short ones up. So the
 * shortest quotes in the corpus render exactly as they always have, everywhere,
 * and every difference this change makes is a long quote getting smaller.
 */
export interface Register {
  /** Below `sm` (40rem). */
  sm: [max: number, min: number];
  /** `sm` and up. */
  lg: [max: number, min: number];
}

export type RegisterName = 'permalink' | 'feed' | 'suite' | 'listening';

export const REGISTERS: Record<RegisterName, Register> = {
  /** `QuoteArticle` — the permalink and the Reader. The only surface that ramped before. */
  permalink: { sm: [2, 1.2], lg: [2.6, 1.35] },
  /** `QuoteCard` — the blog feed. Was flat 1.35rem at both widths. */
  feed: { sm: [1.35, 1.05], lg: [1.35, 1.05] },
  /** `SuiteStanza` — a stanza of a constellation suite. Was flat 1.35 / 1.6rem. */
  suite: { sm: [1.35, 1.05], lg: [1.6, 1.2] },
  /** `MusicSets` — the set's epigraph on /listening. Was flat 1.25 / 1.5rem. */
  listening: { sm: [1.25, 1], lg: [1.5, 1.1] },
};

/** Round to 3dp so the emitted style string does not carry float noise. */
const rem = (max: number, min: number, t: number) => Math.round((max - t * (max - min)) * 1000) / 1000;

export interface QuoteSize {
  /** rem, below `sm`. */
  sm: number;
  /** rem, `sm` and up. */
  lg: number;
}

export function quoteSize(len: number, register: RegisterName): QuoteSize {
  const t = ramp(len);
  const r = REGISTERS[register];
  return { sm: rem(r.sm[0], r.sm[1], t), lg: rem(r.lg[0], r.lg[1], t) };
}

/**
 * ⚠ THE ARITHMETIC HAPPENS HERE AND THE BREAKPOINT HAPPENS IN CSS, which is the
 * only division that survives both server rendering and the client-side swap on
 * /listening. A `calc()` over a `--t` custom property would push the curve into
 * the stylesheet and read well, but then every surface's range would have to be
 * declared as custom properties too — and `music-sets.ts` rewrites a live pane's
 * quote in the browser, so it would have to learn to restate them. Two numbers
 * and a class is the whole contract instead, and the one client that swaps
 * quotes is handed the numbers in its payload rather than the curve.
 *
 * Pair with `.quote-ramp` in app.css.
 */
export function quoteStyle(len: number, register: RegisterName): string {
  const { sm, lg } = quoteSize(len, register);
  return `--qs:${sm}rem;--ql:${lg}rem`;
}
