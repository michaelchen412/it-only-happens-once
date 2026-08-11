// The drawn figure of a constellation suite — the geometry ONLY, as pure
// functions over points, with no DOM in sight. `scripts/constellation-suite.ts`
// turns the result into SVG; `src/tests/sky-figure.test.ts` asserts the
// continuity properties as arithmetic, which is the half of "does it look
// right" that does not need an eye.
//
// ⚠ WHAT THIS REPLACED, AND WHY — because the thing it replaced was deliberate,
// documented, and had its own careful comment. Until 2026-08-11 the figure was
// **per-segment arcs**: each pair of marks joined by its own quadratic, trimmed
// 14px at both ends and bowed by `±min(30, len × 0.16)` with the sign flipping
// on index parity — "phrase marks in a score, not a wire" (design.md §235,
// chosen on the sky-lab bench in 2026-07 over a continuous "thread" and a
// straight polyline).
//
// The intent was right and the execution contradicted it. A phrase mark in a
// score is a smooth slur; this was not smooth, because each arc was derived
// from its own chord alone and nothing told arc n+1 which way arc n had been
// travelling when it arrived. Measured on `/conditions-not-character` at
// 1280px, the line turned **26.1°, 32.0°, 46.3°, 43.6°, 29.1°** instantly at
// the five interior joints, and its curvature reversed at every one of them —
// a property of the LOOP COUNTER, not of the constellation. On a phone, where
// the marks were collinear, that bow was the only thing bending the line at
// all: ±30px, clamped identically on every segment, the same periodic sine wave
// down the margin of every suite on the site.
//
// Michael, seeing it on a phone: *"any way we can get them to be more
// aesthetic/seamless? … this looks a bit strange now looking at it."*
//
// Prototyped as an A/B on a `/lab/sky-line` bench (deleted with its question,
// 2026-08-11) and chosen from the numbers as well as the picture: the reader's
// eye crosses a gap, so what says "corner" is the line diving into one pointing
// somewhere the far side plainly is not. That figure went from **27–36°** to
// **4.2–7.3°**.
//
// The gap at each mark is kept, and keeping it is why this is a synthesis
// rather than a reversal — the sky-lab's `thread` variant ran straight THROUGH
// every mark, which is almost certainly why arcs beat it. Nothing ever forced a
// choice between the gap and the continuity; the two builders just happened to
// be written that way.

export type Pt = { x: number; y: number };
export type Star = { x: number; y: number; size: number };
export type Figure = { d: string; stars: Star[] };

/**
 * Star magnitudes, varied a little — a figure of identical stars reads as a
 * diagram. Size is pinned between two hard limits: the tips must stay inside
 * the gap the line leaves, and must clear the stanza's own glyph, which paints
 * on top of the star. 22–27 sits squarely in that band (tips 11–13.5).
 */
export function starSizes(count: number): number[] {
  return Array.from({ length: count }, (_, i) => 22 + (i % 3) * 2.5);
}

type Cubic = { p0: Pt; c1: Pt; c2: Pt; p1: Pt };

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function cubicAt(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * c.p0.x + w1 * c.c1.x + w2 * c.c2.x + w3 * c.p1.x,
    y: w0 * c.p0.y + w1 * c.c1.y + w2 * c.c2.y + w3 * c.p1.y,
  };
}

/** de Casteljau — split one cubic into two that together trace the original. */
function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const a = lerp(c.p0, c.c1, t);
  const b = lerp(c.c1, c.c2, t);
  const d = lerp(c.c2, c.p1, t);
  const e = lerp(a, b, t);
  const f = lerp(b, d, t);
  const g = lerp(e, f, t);
  return [
    { p0: c.p0, c1: a, c2: e, p1: g },
    { p0: g, c1: f, c2: d, p1: c.p1 },
  ];
}

/**
 * Arc length by flattening. 24 chords is far more than a ~250px curve of this
 * gentleness needs — the error is well under a pixel, and this runs once per
 * layout, not per scroll frame.
 */
const SAMPLES = 24;
function lengthTable(c: Cubic): { cumulative: number[]; total: number } {
  const cumulative = [0];
  let prev = c.p0;
  let total = 0;
  for (let i = 1; i <= SAMPLES; i++) {
    const p = cubicAt(c, i / SAMPLES);
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    cumulative.push(total);
    prev = p;
  }
  return { cumulative, total };
}

/** The parameter t at which the curve has run `len` from its start. */
function tAtLength(table: { cumulative: number[] }, len: number): number {
  const c = table.cumulative;
  for (let i = 1; i < c.length; i++) {
    if (c[i] >= len) {
      const span = c[i] - c[i - 1];
      const frac = span > 0 ? (len - c[i - 1]) / span : 0;
      return (i - 1 + frac) / SAMPLES;
    }
  }
  return 1;
}

/**
 * Cut `head` off the front and `tail` off the back, MEASURED ALONG THE CURVE.
 *
 * ⚠ ALONG THE CURVE, not along the chord, and that is the whole difference from
 * the arcs builder this replaced. Walking back down the straight chord (what it
 * did) leaves a gap whose real size depends on how hard the curve is bending
 * there, so the clearance around each star varies visibly. Subdividing the
 * actual cubic leaves exactly the gap asked for, and — because both halves of a
 * de Casteljau split lie ON the original curve — the piece that survives still
 * carries the spline's own tangents. The line therefore leaves a star pointing
 * exactly where it will be pointing when it arrives at the next one, which is
 * what makes the gaps read as one interrupted line rather than as N bows.
 */
function trimCubic(c: Cubic, head: number, tail: number): Cubic | null {
  const table = lengthTable(c);
  // Nothing worth drawing between two stars this close together — the caller
  // still draws both stars, so the figure just skips a joint rather than
  // sprouting a stub. (The arcs builder had the same guard as `len < GAP * 2.5`.)
  if (table.total <= head + tail + 6) return null;
  const afterHead = splitCubic(c, tAtLength(table, head))[1];
  const t2 = lengthTable(afterHead);
  return splitCubic(afterHead, tAtLength(t2, t2.total - tail))[0];
}

/**
 * The tangents for one segment, as a CENTRIPETAL Catmull–Rom (α = 0.5).
 *
 * ⚠ CENTRIPETAL, NOT UNIFORM, AND THE DIFFERENCE IS NOT COSMETIC. The textbook
 * uniform form — `(p[i+1] − p[i−1]) / 6`, which is what the deleted sky-lab
 * `thread` variant used — assumes the points are evenly spaced. A suite's marks
 * are spaced by how tall each stanza is, so a one-line quote next to a long
 * essay excerpt is a 12px gap next to a 390px one, and uniform CR answers that
 * by OVERSHOOTING: fed marks at y = 0, 12, 400 it swings the curve up to
 * y = −20.6 before coming back down to the second star. That is a visible loop
 * above a star, on real content, on any suite that mixes registers — which is
 * most of them.
 *
 * Centripetal parameterisation (Yuksel et al.) is the standard fix and is
 * *proven* to produce no cusps and no self-intersections for any input, which
 * is a stronger guarantee than "looked fine on the suite I tested".
 *
 * The end points are REFLECTED (`2·p1 − p2`) rather than duplicated. Duplicating
 * gives a zero-length knot interval and divides by zero; reflecting resolves to
 * `c1 = p1 + (p2 − p1)/3`, i.e. the figure sets off straight toward its second
 * star, which is also the behaviour you want at an open end.
 */
function centripetalTangents(p0: Pt, p1: Pt, p2: Pt, p3: Pt): { c1: Pt; c2: Pt } {
  const knot = (a: Pt, b: Pt) => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)); // |Δ|^0.5
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);

  // Two marks in the same place: no tangent to estimate, and `trimCubic` will
  // drop the segment anyway. A straight chord keeps the arithmetic finite.
  if (t1 === t0 || t2 === t1 || t3 === t2) {
    return {
      c1: lerp(p1, p2, 1 / 3),
      c2: lerp(p1, p2, 2 / 3),
    };
  }

  const axis = (k: 'x' | 'y') => {
    const m1 = (t2 - t1) * ((p1[k] - p0[k]) / (t1 - t0) - (p2[k] - p0[k]) / (t2 - t0) + (p2[k] - p1[k]) / (t2 - t1));
    const m2 = (t2 - t1) * ((p2[k] - p1[k]) / (t2 - t1) - (p3[k] - p1[k]) / (t3 - t1) + (p3[k] - p2[k]) / (t3 - t2));
    return { c1: p1[k] + m1 / 3, c2: p2[k] - m2 / 3 };
  };
  const x = axis('x');
  const y = axis('y');
  return { c1: { x: x.c1, y: y.c1 }, c2: { x: x.c2, y: y.c2 } };
}

/**
 * One Catmull–Rom spline through every mark, interrupted by a gap at each — the
 * figure, and the only builder. See the file header for what it replaced.
 *
 * Its shape comes from where the stanzas actually SIT (the indents in
 * `ConstellationSuite.astro`), which is what design.md §235 always claimed was
 * happening: *"asymmetric stanza offsets give the line its angles."* That
 * sentence was only half true while a ±30px alternating bow was added on top of
 * the offsets regardless of them. Now the offsets are the whole story, which
 * means the figure is genuinely different per constellation and moving a stanza
 * moves the drawing — the two are one thing.
 */
export function splineFigure(pts: Pt[]): Figure {
  const sizes = starSizes(pts.length);
  const stars = pts.map((p, i) => ({ x: p.x, y: p.y, size: sizes[i] }));
  if (pts.length < 2) return { d: '', stars };

  const reflect = (a: Pt, b: Pt): Pt => ({ x: 2 * a.x - b.x, y: 2 * a.y - b.y });

  let d = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p0 = pts[i - 1] ?? reflect(p1, p2);
    const p3 = pts[i + 2] ?? reflect(p2, p1);
    const { c1, c2 } = centripetalTangents(p0, p1, p2, p3);
    const seg: Cubic = { p0: p1, c1, c2, p1: p2 };
    // The gap is the star's OWN radius plus a hair, so every star sits in a gap
    // that clears it by the same amount. (The arcs builder used a flat 14 while
    // the stars run 22–27, so the tightest clearance was 3px less than the
    // loosest — small, but it is why some stars used to look pinched.)
    const t = trimCubic(seg, sizes[i] / 2 + 3, sizes[i + 1] / 2 + 3);
    if (!t) continue;
    d += `M ${t.p0.x.toFixed(2)} ${t.p0.y.toFixed(2)} C ${t.c1.x.toFixed(2)} ${t.c1.y.toFixed(2)}, ${t.c2.x.toFixed(2)} ${t.c2.y.toFixed(2)}, ${t.p1.x.toFixed(2)} ${t.p1.y.toFixed(2)} `;
  }
  return { d, stars };
}
