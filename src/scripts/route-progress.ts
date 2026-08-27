// The click lands first, on the PUBLIC site — the other half of 24 · Piece 1.
//
// ⚠ THE PUBLIC SITE WAS WORSE THAN A PLAIN LINK, AND THAT IS THE FINDING. The
// Observatory's problem (nav-progress.ts) was that a full document navigation
// hands feedback to the browser's tab spinner, which a phone hides behind a
// collapsed URL bar — weak, but present. Here `<ClientRouter />` is mounted, so
// a nav click is a `fetch()` and a swap: **there is no browser navigation at
// all, and therefore no browser indicator of any kind.** Nothing moves between
// the press and the new page painting. Michael, 2026-08-19: *"clicking blog or
// about … there's a delay between pressing the button and anything changing."*
//
// Measured against production the same day (edge cache HIT, so this is the good
// case) — gzipped HTML the router has to fetch, parse and swap:
//
//     /                              14.6 KB
//     /about                         ~11 KB
//     /blog                          33.3 KB
//     /conditions-not-character      36.4 KB
//     /the-proving-ground            44.5 KB   ← 298 KB raw
//
// Which is why the same complaint arrived twice in one message, about the nav
// AND about "opening constellations": they are one defect. A constellation suite
// is simply the biggest document on the site, so the silent gap is longest
// there. The reader inside a suite is NOT implicated — ConstellationSuite ships
// a `<template>` per fragment, so that half opens with no network at all.
//
// ⚠ IT SHARES THE BAR WITH THE OBSERVATORY AND NOT THE SCRIPT, which looks
// backwards and is the right split. `#nav-progress`'s CSS lives in `admin.css`,
// which `app.css` imports — so both chromes already draw the identical 1px
// creep, and the argument for its shape (front-loaded, asymptotic at 92%, never
// completes on its own) is written there once, along with why it is a hairline
// of text ink rather than the accent strip it was until 2026-08-27. What cannot
// be shared is the DRIVING:
//
//   · The Observatory has no router, so `nav-progress.ts` has to infer a
//     navigation from a click and then decide, in nine lines of `navigates()`,
//     whether that click will actually replace the document.
//   · Here the router announces it. `astro:before-preparation` fires only for
//     navigations that are really happening, and it carries `sourceElement` —
//     the element that started it. Every guess that file has to make is a fact
//     in this one, INCLUDING the ones it cannot make at all: back/forward and
//     `navigate()` calls have no click to listen for and are covered here for
//     free.
//
// ⚠ AND THE READER DOES NOT TRIP IT, WHICH HAD TO BE VERIFIED RATHER THAN
// HOPED. `Reader.astro` opens through `navigate('#read=slug')`, and a progress
// bar flashing across the top on every fragment tap would be a new tic in the
// site's quietest interaction. Astro's router short-circuits a same-page hash
// move — `samePage(from, to) && to.hash` returns via `moveToLocation` BEFORE
// `doPreparation` (astro/dist/transitions/router.js) — so no preparation event
// is dispatched, in either direction. Closing via `history.back()` takes the
// mirrored branch. Nothing to suppress here; the router already did.

const BAR = 'nav-progress';

/** Give up if the navigation never lands — see `clear()`. */
const SAFETY_MS = 10_000;

let timer = 0;

/**
 * How wide the creep had got when the swap took the old page away, or -1 for
 * "no navigation is in flight".
 *
 * ⚠ IT IS CAUGHT AT `astro:before-swap` RATHER THAN READ AT THE END, AND THE
 * REASON IS NOT OBVIOUS (measured 2026-08-27). Persisting the element means
 * Astro ADOPTS it into the new document, and adopting a node restarts its CSS
 * animations — so the creep silently begins again from zero at the swap. Read
 * the width a moment later, at `astro:page-load`, and it measures ~0: the bar
 * rewinds a seventh of the screen and then sweeps from nothing, which is a
 * worse ending than the one being replaced. `before-swap` is the last moment
 * the old page's creep is still the one on screen.
 */
let caught = -1;

const bar = () => document.getElementById(BAR);

/** How far the creep actually got, 0–1, read off the live animation. */
function creepAt(el: HTMLElement): number {
  // `matrix(a, b, c, d, tx, ty)` — `a` is the horizontal scale, which is the
  // only thing the creep animates. `none` before the first navigation.
  const t = getComputedStyle(el).transform;
  const a = t && t !== 'none' ? parseFloat(t.slice(t.indexOf('(') + 1)) : 0;
  return Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 0;
}

/** Shared teardown: the safety timer, and the link that was claiming to be pending. */
function reset() {
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
  document.querySelector('[data-nav-pending]')?.removeAttribute('data-nav-pending');
}

/**
 * End the bar with nothing to show for it — for the navigations that never
 * happened.
 *
 * ⚠ THE SPLIT FROM `finish()` IS THE HONEST HALF OF THIS FILE. A bar that
 * snapped to full width whenever it went away would be claiming the page
 * arrived, which is precisely the one fact it exists to report and the one it
 * would then be wrong about. A cancelled preparation, a fetch that fell back to
 * a document load, a bfcache restore: none of those is an arrival, so none of
 * them gets the gesture that means one.
 */
function clear() {
  reset();
  caught = -1;
  const el = bar();
  if (!el) return;
  el.classList.remove('is-active', 'is-done');
  el.style.removeProperty('--nav-progress-at');
  el.style.removeProperty('transform');
  el.style.removeProperty('opacity');
}

/**
 * The new page is on screen: snap to full width and fade.
 *
 * ⚠ THIS IS NEW WORK RATHER THAN A TIDY-UP, AND FOR MOST OF THIS FILE'S LIFE IT
 * WAS IMPOSSIBLE (2026-08-27). The bar had no ending because it had no element
 * to end: `<ClientRouter />` replaced the whole document, this div with it, and
 * the old `stop()` removed `is-active` from a fresh one that had never carried
 * it. What a reader saw was the creep being demolished at whatever width the
 * swap caught it — around 14% on an edge-cached page. `transition:persist` in
 * SiteLayout is what carries the running bar across the swap so there is
 * something here to finish.
 *
 * By here the width has already been caught and the bar pinned to it by
 * `astro:before-swap`, so this only has to hand over to the finish animation:
 * dropping the inline hold and adding the class in the same block means the
 * browser computes style once and the ending starts from exactly where the
 * creep stopped. The live measure is a fallback for a swap that never
 * announced itself.
 */
function finish() {
  reset();
  const el = bar();
  if (!el) return;

  // Not mid-navigation — `astro:page-load` also fires on a cold load, and on a
  // navigation this file deliberately never started (a Reader hash move).
  const at = caught >= 0 ? caught : el.classList.contains('is-active') ? creepAt(el) : -1;
  if (at < 0) return;
  caught = -1;

  el.style.setProperty('--nav-progress-at', String(at));
  el.style.removeProperty('transform');
  el.style.removeProperty('opacity');
  el.classList.remove('is-active');
  el.classList.add('is-done');
}

/*
  Hold the creep where it is while the documents change hands.

  ⚠ THE INLINE STYLES ARE THE HOLD, AND THEY EXIST BECAUSE OF THE ADOPTION
  RESTART DESCRIBED AT `caught`. Taking `is-active` off stops the creep from
  starting over in the new document; pinning `transform` and `opacity` by hand
  is what keeps the bar visible at the width it had reached in the meantime,
  since without the class the element's own rule says `scaleX(0)` and
  `opacity: 0`. `finish()` drops both a few milliseconds later.
*/
document.addEventListener('astro:before-swap', () => {
  const el = bar();
  if (!el?.classList.contains('is-active')) return;
  caught = creepAt(el);
  el.style.transform = `scaleX(${caught})`;
  el.style.opacity = '1';
  el.classList.remove('is-active');
});

/*
  Tidy-up after the ending: take `is-done` back off, so the next navigation
  starts from the same flat bar as the first one did.

  ⚠ ON `document`, AND KEYED ON THE ANIMATION NAME. Both halves avoid a trap.
  Bound to the element instead, this would depend on `#nav-progress` existing at
  module-evaluation time and on it surviving every swap afterwards — two
  assumptions that are true today and are not this listener's business.
  Attaching one per `finish()` would leak a closure per navigation.

  ⚠ AND IT MUST NOT LISTEN FOR `animationcancel`, which looks like the obvious
  companion and would be a real bug: removing `is-active` at the START of a
  finish cancels the creep, so a cancel handler would strip `is-done` off the
  ending in the same frame it was added. Only the finish's own completion tidies
  up; `start()` handles the case where a new press interrupts one.
*/
document.addEventListener('animationend', (e) => {
  if ((e as AnimationEvent).animationName !== 'nav-progress-finish') return;
  const el = e.target as HTMLElement;
  el.classList.remove('is-done');
  el.style.removeProperty('--nav-progress-at');
});

function start(source: Element | undefined) {
  const el = bar();
  if (!el) return;

  // Restart the creep from zero on a second press (impatience is a real input).
  // `is-done` comes off here too: a press landing inside the 200ms ending must
  // take the bar back to a creep rather than leave the two animations arguing.
  caught = -1;
  el.classList.remove('is-active', 'is-done');
  el.style.removeProperty('--nav-progress-at');
  el.style.removeProperty('transform');
  el.style.removeProperty('opacity');
  void el.offsetWidth; // reflow, so the animation actually re-runs
  el.classList.add('is-active');

  // THE BAR ANSWERS BEFORE THE PAGE DOES. The link you pressed takes the active
  // ink on the frame you press it, rather than a second later when the new
  // document paints — and the one that WAS active gives it up in the same
  // frame, so the mark moves once instead of two links glowing at each other.
  //
  // ⚠ ONLY FOR CHROME LINKS — `data-nav-row` marks the three in the top bar and
  // their twins in the footer. A link in the CONTENT moving the bar's mark
  // would be a lie: /blog's cards, a constellation's fragments and the footer's
  // "Say hello" all navigate, and none of them changes which room you are in.
  //
  // ⚠ `data-nav-pending`, NOT `aria-current` — the same rule the Observatory's
  // sidebar states: the visual state may run ahead of the truth, the
  // accessibility tree may not. Moving `aria-current` here would tell a screen
  // reader it is on a page that has not arrived.
  const row = source?.closest?.('[data-nav-row]');
  if (row) {
    document.querySelector('[data-nav-pending]')?.removeAttribute('data-nav-pending');
    row.setAttribute('data-nav-pending', '');
  }

  // A navigation that never completes: a cancelled `astro:before-preparation`,
  // a fetch that fails and falls back to a full page load, a 302 the browser
  // declines. `astro:page-load` is the normal end and arrives long before this.
  timer = window.setTimeout(clear, SAFETY_MS);
}

document.addEventListener('astro:before-preparation', (e) => start(e.sourceElement));

// ⚠ `astro:page-load` AND NOT `astro:after-preparation`, which is what the
// Astro guide's loading-indicator snippet uses. After-preparation means the
// next document has been FETCHED; the swap, the view transition and the paint
// all still lie between there and anything the reader can see. Ending the bar
// at the fetch would put the gap back at the end instead of the beginning,
// which is where it is least noticeable but still exactly as long. This event
// means the new page is on screen — which is why it is the one caller that gets
// `finish()` rather than `clear()`.
document.addEventListener('astro:page-load', finish);

// The document is going away — or coming back from bfcache, where a bar frozen
// mid-creep would be restored along with everything else. Public HTML is
// CDN-cached rather than `no-store`, so unlike the Observatory this restore
// really can happen.
window.addEventListener('pagehide', clear);
window.addEventListener('pageshow', clear);

// ⚠ THIS LINE IS LOAD-BEARING AND LOOKS LIKE DEAD CODE. TypeScript treats a
// file with no top-level import or export as a global SCRIPT, not a module — so
// `BAR`, `SAFETY_MS`, `timer`, `start` and `clear` would all be declared in the
// global scope. `nav-progress.ts` next door is such a file and names four of
// the same five, which `astro check` reports as eight redeclaration errors
// across both files the moment this one exists. Nothing at runtime cares (Vite
// gives each its own module scope either way); the type-checker is the one that
// has to be told, and this is how it is told.
export {};
