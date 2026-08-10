// focus-mode — which element is the reader ATTENDING TO, on whichever kind of
// device they brought (design.md §13; ADR-0022, decided 2026-08-07).
//
// THE PROBLEM IT SOLVES. Every affordance in the Sky used to be a `:hover`
// rule, so on a phone the overview was a list of names with nothing to say it
// was a list of links, and a suite gave a tappable essay and an inert quote the
// same passing lamplight. Hover is not a weaker signal on touch — it is an
// absent one, and no amount of polishing it reaches a thumb.
//
// ⚠ TOUCH AND POINTER ARE TWO MODELS, NOT ONE MODEL PLUS A FALLBACK, and this
// is the whole design. The obvious build — proximity everywhere, hover layered
// on top — was tried first and is wrong: a desktop then has TWO systems
// narrating at once, the page lighting rows as you scroll while the cursor
// lights a different one. Precedence does not save it. Precedence only stops
// them CONTRADICTING each other; it cannot stop them both being in motion, and
// the busyness is the motion.
//
// So proximity is not a fallback that hover overrides. It is the answer to a
// different question — "what am I looking at, on a device that cannot point?" —
// and it is not asked at all where a cursor exists. Each mode consults exactly
// one ambient input; the other is not outranked but never read:
//
//     touch    keyboard ?? proximity     (pointer never consulted)
//     pointer  pointer  ?? keyboard      (proximity never consulted)
//
// Keyboard answers in both, because a keyboard is orthogonal to both.
//
// ⚠ `(hover: hover)` is the right question — not `(pointer: coarse)`, not a UA
// string. It asks whether the PRIMARY input can hover at all, which is exactly
// the capability the decision turns on. A touchscreen laptop answers yes and
// gets the pointer model, which is correct: it has a cursor.
//
// ⚠ And it is read LIVE. An iPad becomes a hover device the moment a Magic
// Keyboard is attached and stops being one when it is pulled off, with the same
// page still on screen. Reading this once at startup would strand that device
// in the wrong model until a reload it has no reason to perform.

const mq = matchMedia('(hover: hover)');

/** Every live tracker's re-evaluator, so a mode change re-decides all of them in
 *  one pass — otherwise switching leaves whatever the cursor last rested on lit
 *  by a pointer the page has just stopped believing in. */
const live = new Set<() => void>();
mq.addEventListener('change', () => {
  for (const apply of live) apply();
});

/** True when the primary input cannot hover — i.e. proximity is the ambient
 *  input and `:hover` will never fire. CSS asks this same question directly
 *  with `@media (hover: hover)`; this is for the half that must be JS. */
export const isTouch = () => !mq.matches;

export interface FocusTracker {
  /** The element nearest the reading line, or null when none is on screen.
   *  Ignored entirely on a hovering device. */
  setProximate(el: HTMLElement | null): void;
  /** Drop the mode listener. Call before re-initialising on `astro:page-load`,
   *  or every navigation leaks one more tracker onto a dead DOM. */
  destroy(): void;
}

/**
 * Marks exactly one of `els` with `.is-focus` — never two, which is the point.
 * Listeners live on the elements themselves, so they die with the DOM on swap;
 * only the mode subscription needs `destroy()`.
 */
export function focusTracker(els: HTMLElement[]): FocusTracker {
  let pointerEl: HTMLElement | null = null;
  let keyEl: HTMLElement | null = null;
  let proximate: HTMLElement | null = null;
  let current: HTMLElement | null = null;

  const apply = () => {
    const next = isTouch() ? (keyEl ?? proximate) : (pointerEl ?? keyEl);
    if (next === current) return;
    current?.classList.remove('is-focus');
    next?.classList.add('is-focus');
    current = next;
  };
  live.add(apply);

  for (const el of els) {
    el.addEventListener('pointerenter', () => {
      pointerEl = el;
      apply();
    });
    el.addEventListener('pointerleave', () => {
      if (pointerEl === el) pointerEl = null;
      apply();
    });
    // focusin/focusout, NOT focus/blur: on the overview the element IS the
    // anchor, but a suite stanza's focusable link is a descendant, and
    // focus/blur do not bubble. One pair that serves both beats two that each
    // serve one.
    el.addEventListener('focusin', () => {
      keyEl = el;
      apply();
    });
    el.addEventListener('focusout', () => {
      if (keyEl === el) keyEl = null;
      apply();
    });
  }

  return {
    setProximate(el) {
      proximate = el;
      apply();
    },
    destroy() {
      live.delete(apply);
      current?.classList.remove('is-focus');
    },
  };
}

/**
 * Whichever of `els` sits closest to `line` (viewport px) right now, or null if
 * none is on screen — nothing should be lit by a page you cannot see.
 */
export function nearest(els: HTMLElement[], line: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestD = Infinity;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    const d = Math.abs(r.top + r.height / 2 - line);
    if (d < bestD) {
      bestD = d;
      best = el;
    }
  }
  return best;
}
