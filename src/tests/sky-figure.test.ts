// The drawn figure's geometry — the half of "does it look right" that is
// arithmetic rather than taste.
//
// ⚠ THE POINTS BELOW ARE REAL, lifted from `/conditions-not-character` on the
// dev server rather than invented. A fixture of evenly-spaced round numbers
// would hide the exact thing under test: the desktop marks are pushed around by
// the stanza indents (0/9/3/15/0/11/5%) and the narrow ones by a third of that,
// so the two viewports stress the builder differently — and until 2026-08-11
// the phone marks were COLLINEAR, which is how the figure there came to be a
// periodic sine wave nobody had looked at.
//
// ⚠ EVERY NUMBER ASSERTED HERE IS A PROPERTY, NOT A SNAPSHOT. Pinning the `d`
// string would fail on any harmless retune of the indents and prove nothing
// about how the line looks. What these check is that it stays smooth through
// its joints, keeps an even gap at every star, and never loops back on itself —
// the three ways this drawing can actually go wrong.
import { describe, it, expect } from 'vitest';
import { splineFigure, starSizes, type Pt } from '../lib/sky-figure';

/** Seven fragments at 1280px — the indents give the marks their spread. */
const DESKTOP: Pt[] = [
  { x: 10, y: 100.5 },
  { x: 84.9, y: 365.6 },
  { x: 35, y: 630.7 },
  { x: 134.8, y: 895.7 },
  { x: 10, y: 1160.8 },
  { x: 101.5, y: 1425.8 },
  { x: 51.6, y: 1690.9 },
];

/** The same suite at 390px, with the narrow indents. */
const PHONE: Pt[] = [
  { x: 10, y: 96.8 },
  { x: 20.5, y: 354.3 },
  { x: 13.5, y: 611.9 },
  { x: 27.5, y: 869.5 },
  { x: 10, y: 1127 },
  { x: 24, y: 1384.6 },
  { x: 17, y: 1642.2 },
];

type Seg = { start: Pt; end: Pt; outDir: Pt; inDir: Pt };

/**
 * Pull each drawn subpath back out of the `d` string as its endpoints and the
 * direction the line is travelling AT each of them.
 *
 * Parsing the output rather than exporting internals on purpose: the `d`
 * attribute is the only thing the browser ever sees, so it is the only thing
 * worth asserting on. A refactor that keeps the curve and changes the internals
 * should not break these.
 */
function segments(d: string): Seg[] {
  const out: Seg[] = [];
  const cubic = /M ([-\d.]+) ([-\d.]+) C ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+)/g;
  for (const m of d.matchAll(cubic)) {
    const [ax, ay, c1x, c1y, c2x, c2y, bx, by] = m.slice(1).map(Number);
    out.push({
      start: { x: ax, y: ay },
      end: { x: bx, y: by },
      outDir: { x: c1x - ax, y: c1y - ay },
      inDir: { x: bx - c2x, y: by - c2y },
    });
  }
  return out.sort((a, b) => a.start.y - b.start.y);
}

const deg = (v: Pt) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
const wrap = (a: number) => {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
};
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * How far the line's heading strays from the straight run across the gap, on
 * either side of each star.
 *
 * ⚠ THIS IS THE METRIC THAT MATCHES THE EYE, and it is a better one than the
 * raw angle the line turns at a joint. A gap is crossed by the reader, not by
 * the renderer: what says "corner" is the line diving into the gap pointing
 * somewhere the far side plainly is not. A gently curving line turns at its
 * joints too — that is just curvature, and it looks like a curve.
 *
 * The builder this replaced measured 27–36° here. This one measures 4–8°, and
 * that difference is the entire visible change.
 */
function gapDeviation(d: string): number[] {
  const segs = segments(d);
  const out: number[] = [];
  for (let i = 0; i < segs.length - 1; i++) {
    const chord = { x: segs[i + 1].start.x - segs[i].end.x, y: segs[i + 1].start.y - segs[i].end.y };
    out.push(
      Math.max(Math.abs(wrap(deg(chord) - deg(segs[i].inDir))), Math.abs(wrap(deg(segs[i + 1].outDir) - deg(chord)))),
    );
  }
  return out;
}

/** Signed degrees each drawn piece bends, and which way. */
function bends(d: string): number[] {
  return segments(d).map((s) => wrap(deg(s.inDir) - deg(s.outDir)));
}

describe('starSizes', () => {
  it('varies magnitude so the figure does not read as a diagram', () => {
    expect(starSizes(7)).toEqual([22, 24.5, 27, 22, 24.5, 27, 22]);
  });

  it('keeps every star inside the band its tips have to live in', () => {
    // Tips must stay within the gap the line leaves, and must clear the
    // stanza's glyph — see the note in sky-figure.ts.
    for (const s of starSizes(30)) {
      expect(s).toBeGreaterThanOrEqual(22);
      expect(s).toBeLessThanOrEqual(27);
    }
  });
});

describe('the drawn figure', () => {
  it('leaves a gap at every star — one drawn piece between each pair', () => {
    // The gap is what makes the stars sit IN the line rather than on it, and it
    // is the half of the old design worth keeping. A continuous spline that ran
    // through the marks was prototyped in 2026-07 and lost for exactly this.
    expect(segments(splineFigure(DESKTOP).d)).toHaveLength(6);
    expect(segments(splineFigure(PHONE).d)).toHaveLength(6);
  });

  it('points across each gap instead of turning a corner at it', () => {
    for (const marks of [DESKTOP, PHONE]) {
      expect(Math.max(...gapDeviation(splineFigure(marks).d))).toBeLessThan(10);
    }
  });

  it('bends because of where the stanzas sit, not because of the loop counter', () => {
    // The figure this replaced flipped its bow on index parity, so curvature
    // reversed at EVERY joint whatever the marks were doing — perfectly
    // alternating signs, a property of the loop rather than the constellation.
    // Measured here: +11.4, −1.7, +7.0, +1.2, −6.5, +12.6.
    const signs = bends(splineFigure(DESKTOP).d).map(Math.sign);
    expect(signs).not.toEqual([-1, 1, -1, 1, -1, 1]);
    expect(signs).not.toEqual([1, -1, 1, -1, 1, -1]);
  });

  it('leaves every star the same clearance', () => {
    // A flat gap against varying star sizes is why some stars used to look
    // pinched: the old builder trimmed 14px while the stars run 22–27.
    const { d, stars } = splineFigure(DESKTOP);
    const segs = segments(d);
    for (let i = 0; i < segs.length; i++) {
      expect(dist(segs[i].start, stars[i])).toBeCloseTo(stars[i].size / 2 + 3, 0);
      expect(dist(segs[i].end, stars[i + 1])).toBeCloseTo(stars[i + 1].size / 2 + 3, 0);
    }
  });

  it('leans on a phone rather than repeating', () => {
    // The narrow indents earn themselves here. With the marks collinear (as
    // they were until 2026-08-11) a spline through them is a dead straight
    // line, so the figure needed either its own offsets or a synthetic wave.
    // Offsets won: the shape stays a consequence of the layout at every width.
    const segs = segments(splineFigure(PHONE).d);
    const xs = segs.map((s) => s.start.x);
    expect(new Set(xs.map((x) => Math.round(x))).size).toBeGreaterThan(1);
    // ...and not the periodic ±30px excursion it replaced.
    const spread = Math.max(...xs) - Math.min(...xs);
    expect(spread).toBeLessThan(25);
  });

  it('never overshoots a star, however uneven the spacing', () => {
    // The centripetal parameterisation's whole reason for being. Uniform
    // Catmull–Rom fed these marks swung up to y = −20.6 before coming back down
    // to the second one — a loop above a star, on the sort of content a suite
    // actually holds (a one-line quote beside a long excerpt).
    const marks: Pt[] = [
      { x: 10, y: 0 },
      { x: 10, y: 12 },
      { x: 10, y: 400 },
      { x: 40, y: 415 },
      { x: 10, y: 900 },
    ];
    for (const s of segments(splineFigure(marks).d)) {
      const lo = Math.min(s.start.y, s.end.y);
      const hi = Math.max(s.start.y, s.end.y);
      // Control points inside the endpoints' band ⇒ the cubic cannot leave it.
      expect(s.start.y + s.outDir.y).toBeGreaterThanOrEqual(lo - 1);
      expect(s.start.y + s.outDir.y).toBeLessThanOrEqual(hi + 1);
      expect(s.end.y - s.inDir.y).toBeGreaterThanOrEqual(lo - 1);
      expect(s.end.y - s.inDir.y).toBeLessThanOrEqual(hi + 1);
    }
  });

  it('gives every mark a star, including ones no curve reaches', () => {
    expect(splineFigure(DESKTOP).stars).toHaveLength(DESKTOP.length);
    // Two marks too close together to draw between: the joint is skipped, both
    // stars still appear.
    const tight: Pt[] = [
      { x: 10, y: 0 },
      { x: 10, y: 12 },
      { x: 10, y: 400 },
    ];
    const f = splineFigure(tight);
    expect(f.stars).toHaveLength(3);
    expect(segments(f.d)).toHaveLength(1);
  });

  it('survives a suite with nothing to join', () => {
    expect(splineFigure([]).d).toBe('');
    expect(splineFigure([{ x: 10, y: 10 }])).toEqual({ d: '', stars: [{ x: 10, y: 10, size: 22 }] });
  });

  it('emits no NaN, whatever the input', () => {
    const dupes: Pt[] = [
      { x: 10, y: 100 },
      { x: 10, y: 100 },
      { x: 60, y: 500 },
    ];
    expect(splineFigure(dupes).d).not.toMatch(/NaN|Infinity/);
  });
});
