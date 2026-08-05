/*
  sky-slot — the sky remembers where you were.

  ⚠ THIS IS NOT A SCROLL TWEAK, AND DELETING IT BREAKS THE ANIMATION.

  `/` and `/{slug}` share `transition:name` on the constellation's name, so the
  View Transitions API morphs it between the overview and the landing header.
  The morph animates the old snapshot toward wherever that element LANDS in the
  new page — so when you return to `/` at scroll 0, the name doesn't settle back
  into its own line, it flies up to wherever the list happens to start and
  stops. The morph is doing exactly what it was told; it was told the wrong
  destination. One cause, two symptoms: fix the scroll and the motion fixes
  itself. A future reader who removes this as "just a scroll thing" will
  silently un-fix the reverse zoom, and nothing in either file says so alone.

  ── Three decisions, and what lost ──────────────────────────────────────────

  1. THE SLUG, NOT THE PIXEL OFFSET. Storing `scrollY` is simpler and quietly
     wrong: the overview re-flows whenever a constellation is published,
     renamed, reordered or recoloured — and the admin index can now drag the
     sky into a new order, so this is routine, not hypothetical. A remembered
     scrollY would then restore you to the wrong constellation and read as a
     brand-new bug. We remember WHICH name you left through and WHERE IN THE
     VIEWPORT it sat, then put that element back at that offset — which
     survives every one of those edits.

  2. ARRIVAL, NOT DEPARTURE. A suite has SEVEN ways home: the ✦ beside the
     title, the title itself, the return at the foot, the floating ✦, Escape
     (design.md §13 — five deliberate affordances), plus the wordmark and the
     Home nav item in SiteLayout. Wiring the restore into each one means seven
     code paths to the same destination, and the odds that all seven behave
     alike are poor — Escape isn't even a link, so a click handler would skip
     it, and the two in SiteLayout belong to the public chrome rather than to
     the Sky. Keying on ARRIVAL instead means NONE of them need to know this
     file exists. They navigate to `/`; this runs. Consistency stops being
     something to be careful about and becomes structural.

  3. RESTORE ONLY WHEN YOU CAME BACK FROM THE CONSTELLATION YOU LEFT THROUGH.
     The looser rule — restore on any arrival at `/` — was rejected: coming
     home from an essay, three navigations later, and landing mid-list with no
     explanation reads as a bug rather than as being remembered.
*/
import type { TransitionBeforePreparationEvent } from 'astro:transitions/client';

/** sessionStorage, not a module variable: in-memory is lost on a hard reload,
 *  so "deep link into a suite, refresh, press return" would land at the top
 *  while every other return remembered. Tab-scoped, so it can't leak sideways
 *  into another window. */
const KEY = 'sky-slot';

interface Slot {
  /** which name you left through */
  slug: string;
  /** and where in the viewport it sat, in px from the top */
  top: number;
}

function save(slot: Slot): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(slot));
  } catch {
    /* private mode, quota — the restore simply doesn't happen */
  }
}

function load(): Slot | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.slug === 'string' && typeof v?.top === 'number' ? v : null;
  } catch {
    return null;
  }
}

/** The overview's own name element for a slug — the `<h2>` carrying
 *  `transition:name`, i.e. the very thing that morphs. Matched by walking the
 *  handful of rows rather than by an attribute selector, so a slug never has
 *  to be escaped into a query. */
function nameEl(slug: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-sky-slot]')) {
    if (el.dataset.skySlot === slug) return el;
  }
  return null;
}

/** Put `el` back at `top` px down the viewport.
 *
 *  Scrolls by the DIFFERENCE rather than to a remembered absolute position:
 *  that is what makes this survive a re-flowed list (see decision 1 above). If
 *  the list is now shorter than it was, or the window narrower, the browser
 *  clamps and the name lands near instead of exactly. We take the clamp — the
 *  alternative, falling back to centring the element, is a DIFFERENT wrong
 *  answer that looks deliberate: a near miss reads as the page settling, a
 *  centred name reads as a decision nobody made.
 *
 *  ⚠ `behavior: 'instant'` IS LOAD-BEARING. app.css sets
 *  `scroll-behavior: smooth` on <html> ("nothing snaps"), so a bare
 *  `scrollTo(0, y)` here ANIMATES: the new snapshot is captured at the OLD
 *  scroll, the morph still lands wrong, and the page then slides underneath it.
 *  Measured, not assumed — without it the page reads 0 at `astro:after-swap`
 *  where it needs to already be at its destination. Worse, that same CSS rule
 *  flips to `auto` under prefers-reduced-motion, so the naive version works for
 *  anyone who asked for less motion and fails for everyone else. */
function place(el: HTMLElement, top: number): void {
  const delta = el.getBoundingClientRect().top - top;
  if (delta) window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' });
}

/** `astro:after-swap` is a plain Event — it carries no `from`, `to` or
 *  `navigationType`. Those exist only on the two `before-*` events, so the one
 *  navigation's context has to be carried across by hand. */
let nav: { from: string; type: string } | null = null;

document.addEventListener('astro:before-preparation', (e) => {
  const ev = e as TransitionBeforePreparationEvent;
  nav = { from: ev.from.pathname, type: ev.navigationType };

  // Leaving the overview for a constellation is the only departure worth
  // recording, and there is exactly one link into a suite (index.astro). A
  // pathname that isn't a constellation — /blog, /about — finds no slot
  // element and falls out here on its own.
  if (ev.from.pathname !== '/') return;
  const slug = ev.to.pathname.replace(/^\/|\/$/g, '');
  const el = slug && nameEl(slug);
  if (!el) return;
  save({ slug, top: el.getBoundingClientRect().top });
});

// ⚠ `astro:after-swap` AND NOT `astro:page-load`. This one fires after the
// router has set the scroll position but BEFORE the view transition ends, so
// the geometry the browser captures for the new snapshot includes our
// correction — which is the entire point: the reverse morph then animates
// toward the right place instead of being corrected after it lands. On
// `astro:page-load` the transition is already over, and the page would visibly
// jump AFTER the name had settled in the wrong spot. Worse than doing nothing.
document.addEventListener('astro:after-swap', () => {
  const n = nav;
  nav = null;
  if (!n || location.pathname !== '/') return;

  // A browser Back/Forward already restores correctly — Astro saves and
  // restores scroll across history entries, which is exactly why the return
  // links felt inconsistent with the Back button in the first place. Standing
  // down here leaves one mechanism owning history navigation rather than two
  // writing the same number and eventually disagreeing.
  if (n.type === 'traverse') return;

  const slot = load();
  if (!slot || n.from !== `/${slot.slug}`) return;
  const el = nameEl(slot.slug);
  if (!el) return;

  // Once, and only here. A SECOND placement on `document.fonts.ready` was
  // built and reverted 2026-08-05, and the reversal is the useful part:
  //
  // Returning to `/` within ~50ms of the suite loading — before the webfonts
  // had finished — left the name up to 124px off its line, because the whole
  // overview reflows when the font lands. Re-placing on `fonts.ready` looked
  // like the obvious fix and measured no better (−34/−53/−89 with it against
  // −81/−124 without, overlapping and noisy): it chases a layout that is still
  // moving, so it can as easily land somewhere new as somewhere right.
  //
  // What the same measurements DO show is that this single placement is exact
  // — `window.scrollY` reads the remembered position at `astro:after-swap` in
  // every run — and that the drift disappears entirely once the suite is given
  // ~400ms to settle, i.e. for every visitor who actually reads anything. A
  // sub-100ms round trip is a robot, not a reader.
  place(el, slot.top);
});
