import { navigate } from 'astro:transitions/client';
import { STAR_PATH } from '../lib/star-mark';
import { splineFigure, type Pt } from '../lib/sky-figure';
// Puts the overview back where you left it, so the name morphs home into its
// own line instead of flying to the top of the page. None of the ways out
// below know about it — it keys on ARRIVAL at `/`, which is the only reason
// all of them behave alike.
//
// ⚠ IMPORTED HERE, NOT ONLY FROM index.astro. `astro:after-swap` fires
// BEFORE the incoming page's scripts run, so a listener that only ships with
// `/` would not yet be registered on the first return of a session — deep
// link into a suite, press return, no restore. Loading it on this side means
// it is already listening while you read.
import './sky-slot';
import { focusTracker, isTouch, type FocusTracker } from './focus-mode';

const SVGNS = 'http://www.w3.org/2000/svg';

/**
 * The drawn line's brightness, as a gradient that travels with the reading line.
 *
 * ⚠ THE LINE USED TO BE INERT, and that is the defect this replaced. It was one
 * `stroke-opacity: 0.22`, written at draw time and never touched again, while
 * the stars beside it ran a smoothstep field from 0 to 0.7. Two halves of one
 * figure obeying different physics: measured mid-scroll, stars at 0, 0.19,
 * 0.63, 0.58, 0.15, 0, 0 — and a line joining them at a flat 0.22 the whole way
 * down, which near the top of a suite is BRIGHTER than the star it is attached
 * to. Michael: *"the stars gradually appear but the lines do not."*
 *
 * ⚠ ONE LIGHT, TWO THINGS SAMPLING IT. The stops are the same smoothstep
 * `updateLight` applies to each star, at the same `FALLOFF`, so this is not a
 * second effect tuned to look similar — it is the same field read a second way.
 * If the star falloff is ever retuned, these stops move with it or the figure
 * comes apart again.
 *
 * PEAK is a shade above the old flat value and the floor is ZERO — the line
 * goes dark away from the reading line exactly as a star does, chosen over a
 * faint always-on trace on the bench (2026-08-11). The cost, accepted
 * knowingly: you can no longer see the whole figure at a glance, only the
 * stretch you are reading. That is the same bargain the stars have always made,
 * and making the line keep its own counsel is what stopped the two reading as
 * separate systems.
 */
const PEAK = 0.32;
/** smoothstep sampled across the light's reach, mirrored about the reading line */
const STOPS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((offset) => {
  const k = 1 - Math.abs(offset - 0.5) * 2; // 0 at the edges of reach, 1 at the line
  return { offset, lit: k * k * (3 - 2 * k) };
});

let tracker: FocusTracker | null = null;
let suiteEl: HTMLElement | null = null;
let items: HTMLElement[] = [];
let svg: SVGSVGElement | null = null;
let lit: HTMLElement | null = null;
let returnBtn: HTMLElement | null = null;
let ro: ResizeObserver | null = null;
// Star elements plus their y WITHIN the suite, cached at draw time: their
// offset only changes on relayout, so a scroll frame needs one rect read for
// the whole figure rather than one per star.
let starEls: { el: SVGElement; y: number; shown: number }[] = [];
// The line's gradient, when it is in the same light as the stars. Held so a
// scroll frame moves the light by writing two attributes rather than rebuilding.
let lampGrad: SVGLinearGradientElement | null = null;

// The drawn line and the stars it joins are built by `lib/sky-figure` — pure
// geometry, unit-tested in `src/tests/sky-figure.test.ts` rather than by
// eye. Each segment stops short of its endpoints, so the line leaves a gap at
// every mark: the star drops into that gap, centred on the fragment it belongs
// to, and the line reads as drawn BETWEEN stars. (Scattering stars along the
// curve instead makes them decoration — they line up with nothing you are
// reading.) Every mark gets a star, including the first and last and any whose
// segment was too short to draw between.

/** The line's own light, as a gradient that travels with the reading line. */
function buildLamp(): SVGLinearGradientElement {
  const grad = document.createElementNS(SVGNS, 'linearGradient');
  grad.setAttribute('id', 'suite-lamp');
  // In the SVG's own coordinates — the same space the path is drawn in — so a
  // scroll frame only has to move y1/y2. `pad` clamps everything beyond the
  // light's reach to the end stops, which is what makes `floor` the rest state.
  grad.setAttribute('gradientUnits', 'userSpaceOnUse');
  grad.setAttribute('spreadMethod', 'pad');
  grad.setAttribute('x1', '0');
  grad.setAttribute('x2', '0');
  for (const s of STOPS) {
    const stop = document.createElementNS(SVGNS, 'stop');
    stop.setAttribute('offset', String(s.offset));
    // `--lamp` is the constellation's own colour, inherited from the `cn-*`
    // class on the section — the line burns in it exactly as the stars do.
    stop.setAttribute('stop-color', 'var(--lamp)');
    stop.setAttribute('stop-opacity', (PEAK * s.lit).toFixed(3));
    grad.appendChild(stop);
  }
  return grad;
}

function drawLine() {
  if (!suiteEl?.isConnected) return;
  svg?.remove();
  svg = null;
  lampGrad = null;
  starEls = [];
  const box = suiteEl.getBoundingClientRect();
  const pts: Pt[] = items.map((el) => {
    const r = el.querySelector('.suite-mark')!.getBoundingClientRect();
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
  });
  const { d, stars } = splineFigure(pts);
  if (!d) return;
  svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'suite-line');
  svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS(SVGNS, 'defs');
  lampGrad = buildLamp();
  defs.appendChild(lampGrad);
  svg.appendChild(defs);
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  // The line takes the constellation's own light like everything else in the
  // suite — `--lamp`, set by the `cn-*` class on the section — but through the
  // gradient, so WHERE it burns answers the reading line.
  path.setAttribute('stroke', 'url(#suite-lamp)');
  path.setAttribute('stroke-width', '1');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);

  // The site's own mark, not a dot — the same STAR_PATH the header and the
  // overview draw, so a fragment's star is recognisably the same object at
  // a smaller magnitude. Its glow is a drop-shadow at a FIXED blur radius,
  // with `--lit` driving opacity alone (app.css "The Sky"): animating the
  // blur instead would re-rasterise every star on every scroll frame.
  for (const s of stars) {
    const star = document.createElementNS(SVGNS, 'path');
    star.setAttribute('class', 'suite-star');
    star.setAttribute('d', STAR_PATH);
    // STAR_PATH is authored in a 24×24 box — place its centre on the mark.
    star.setAttribute(
      'transform',
      `translate(${(s.x - s.size / 2).toFixed(1)} ${(s.y - s.size / 2).toFixed(1)}) scale(${(s.size / 24).toFixed(4)})`,
    );
    svg.appendChild(star);
    starEls.push({ el: star, y: s.y, shown: -1 });
  }
  suiteEl.prepend(svg);
}

// Where the light falls right now, in viewport coordinates. It DRIFTS with
// scroll progress — high in the viewport at the top of the page, low near
// the end — so the hand-off passes through EVERY stanza in order: the first
// and last get the light at the extremes, and nothing between is skipped.
// (A fixed line starves the edges; edge-clamps starve their neighbors.)
function readingLine(): number {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const t = maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0.5;
  return window.innerHeight * (0.15 + 0.7 * t);
}

// The passing lamplight: the fragment nearest the reading line takes the
// glow. Exactly one at a time; none once the suite is out of view.
function updateGlow() {
  let best: HTMLElement | null = null;
  if (suiteEl?.isConnected) {
    const line = readingLine();
    let bestD = Infinity;
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const d = Math.abs(r.top + r.height / 2 - line);
      if (d < bestD) {
        bestD = d;
        best = el;
      }
    }
  }
  if (best !== lit) {
    lit?.classList.remove('is-lit');
    best?.classList.add('is-lit');
    lit = best;
  }
  // ⚠ The lamplight itself is NOT input-conditional and runs on every device —
  // it is atmosphere and it shipped long before any of this. What is
  // touch-only is the AFFORDANCE riding it: on a desktop the stanzas still
  // warm as you scroll, but the "Read →" answers the cursor alone, so the two
  // never narrate at once. Feeding it here rather than in its own pass keeps
  // one definition of "nearest" for both.
  if (isTouch()) tracker?.setProximate(lit);
}

// The stars answer to the SAME reading line, but on a far wider and softer
// falloff: where the stanza lamplight is a spotlight picking out one at a
// time, this is the ambient half of it — dozens lit at once, brightest at
// the reading line and dimming with distance, so the whole figure seems to
// kindle ahead of you and settle behind. Brightness is written as `--lit`
// and mapped to opacity in CSS.
const FALLOFF = 0.62; // share of the viewport the light reaches, either way

function updateLight() {
  if (!suiteEl?.isConnected || !starEls.length) return;
  const top = suiteEl.getBoundingClientRect().top; // one read for the figure
  const line = readingLine();
  const reach = window.innerHeight * FALLOFF;
  // The line, when it is in the same light: slide the gradient's window so it
  // straddles the reading line. Two attribute writes, the stops never change,
  // and the whole path gets its brightness from the same field the stars read.
  if (lampGrad) {
    const y = line - top; // the reading line, in the figure's own coordinates
    lampGrad.setAttribute('y1', (y - reach).toFixed(1));
    lampGrad.setAttribute('y2', (y + reach).toFixed(1));
  }
  for (const s of starEls) {
    const d = Math.abs(top + s.y - line);
    const k = Math.max(0, 1 - d / reach);
    // smoothstep: no hard edge where a star winks on, and a broad plateau
    // of brightness through the middle rather than a sharp peak
    const lit = k * k * (3 - 2 * k);
    // Quantised, and only written when it actually changes — a scroll frame
    // otherwise restyles every star for differences no one can see.
    const q = Math.round(lit * 50) / 50;
    if (q !== s.shown) {
      s.shown = q;
      s.el.style.setProperty('--lit', String(q));
    }
  }
}

// The floating ✦ appears once you've scrolled into the suite's depths.
function updateReturn() {
  returnBtn?.classList.toggle('is-visible', window.scrollY > window.innerHeight * 0.75);
}

let raf = 0;
function onScroll() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    updateGlow();
    updateLight();
    updateReturn();
  });
}

function init() {
  suiteEl = document.getElementById('suite');
  returnBtn = document.querySelector('[data-sky-return]');
  ro?.disconnect();
  ro = null;
  lit = null;
  // Before the early return: leaving a suite for a page without one must
  // still drop the old tracker, or every navigation leaks one onto a dead DOM.
  tracker?.destroy();
  tracker = null;
  if (!suiteEl) return;
  items = [...suiteEl.querySelectorAll<HTMLElement>('.suite-item')];
  tracker = focusTracker(items);
  drawLine();
  updateGlow();
  updateLight();
  updateReturn();
  // Redrawing rebuilds the stars, so their brightness has to be re-applied
  // in the same frame — otherwise a resize leaves the whole figure dark
  // until the next scroll.
  ro = new ResizeObserver(() => {
    drawLine();
    updateLight();
  });
  ro.observe(document.body);
  (document as any).fonts?.ready?.then(() => {
    drawLine();
    updateLight();
  });
}

addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);

// Escape lifts you to the sky — unless the Reader is open (it owns Escape).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !document.getElementById('suite')) return;
  const reader = document.getElementById('site-reader') as HTMLDialogElement | null;
  if (reader?.open) return;
  navigate('/');
});

document.addEventListener('astro:page-load', init);
init();
