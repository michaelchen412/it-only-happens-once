import { navigate } from 'astro:transitions/client';
import { STAR_PATH } from '../lib/star-mark';
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
type Pt = { x: number; y: number };
type Star = { x: number; y: number; size: number };

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

// The drawn line: per-segment arcs that stop short of each mark and bow
// gently side to side — phrase marks in a score, not a wire. (The single
// continuous-spline "thread" variant lives in /sky-lab if we ever swap.)
//
// It also yields the STARS — one per mark, at the figure's JOINTS, which is
// where a constellation's stars actually are. Each arc stops GAP short of
// its endpoints, so the line already leaves a gap at every mark: the star
// drops into that gap, centred on the fragment it belongs to, and the arcs
// read as drawn BETWEEN stars. (Scattering them along the arcs instead makes
// them decoration — they line up with nothing you are reading.)
function buildFigure(pts: Pt[]): { d: string; stars: Star[] } {
  const GAP = 14;
  let d = '';
  const stars: Star[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < GAP * 2.5) continue;
    const ux = dx / len;
    const uy = dy / len;
    const a = { x: p1.x + ux * GAP, y: p1.y + uy * GAP };
    const b = { x: p2.x - ux * GAP, y: p2.y - uy * GAP };
    const bow = Math.min(30, len * 0.16) * (i % 2 ? -1 : 1);
    const c = { x: (a.x + b.x) / 2 + -uy * bow, y: (a.y + b.y) / 2 + ux * bow };
    d += `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y} `;
  }

  // Every mark gets one, including the first and last (which no arc reaches
  // past) and any whose segment was too short to draw. Magnitude varies a
  // little — a figure of identical stars reads as a diagram.
  //
  // Size is pinned between two hard limits. Its tips must stay inside GAP
  // (14) so the star stops exactly where the line resumes and never collides
  // with it — and must clear the fragment's glyph, which paints on top of it
  // out to roughly half the 16px em box, or the star is simply swallowed.
  // 22–27 sits squarely in that band: tips 11–13.5.
  pts.forEach((p, i) => stars.push({ x: p.x, y: p.y, size: 22 + (i % 3) * 2.5 }));

  return { d, stars };
}

function drawLine() {
  if (!suiteEl?.isConnected) return;
  svg?.remove();
  svg = null;
  starEls = [];
  const box = suiteEl.getBoundingClientRect();
  const pts = items.map((el) => {
    const r = el.querySelector('.suite-mark')!.getBoundingClientRect();
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
  });
  const { d, stars } = buildFigure(pts);
  if (!d) return;
  svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'suite-line');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  // the drawn line takes the constellation's own light, like everything else
  // in the suite (app.css --lamp, set by the `cn-*` class on the section)
  path.setAttribute('stroke', 'var(--lamp)');
  path.setAttribute('stroke-opacity', '0.22');
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

function updateStars() {
  if (!suiteEl?.isConnected || !starEls.length) return;
  const top = suiteEl.getBoundingClientRect().top; // one read for the figure
  const line = readingLine();
  const reach = window.innerHeight * FALLOFF;
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
    updateStars();
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
  updateStars();
  updateReturn();
  // Redrawing rebuilds the stars, so their brightness has to be re-applied
  // in the same frame — otherwise a resize leaves the whole figure dark
  // until the next scroll.
  ro = new ResizeObserver(() => {
    drawLine();
    updateStars();
  });
  ro.observe(document.body);
  (document as any).fonts?.ready?.then(() => {
    drawLine();
    updateStars();
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
