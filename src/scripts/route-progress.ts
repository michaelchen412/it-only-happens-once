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
// which `app.css` imports — so both chromes already draw the identical 2px
// creep, and the argument for its shape (front-loaded, asymptotic at 92%, never
// completes) is written there once. What cannot be shared is the DRIVING:
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

/** Give up if the navigation never lands — see `stop()`'s callers. */
const SAFETY_MS = 10_000;

let timer = 0;

function stop() {
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
  document.getElementById(BAR)?.classList.remove('is-active');
  document.querySelector('[data-nav-pending]')?.removeAttribute('data-nav-pending');
}

function start(source: Element | undefined) {
  const bar = document.getElementById(BAR);
  if (!bar) return;

  // Restart the creep from zero on a second press (impatience is a real input).
  bar.classList.remove('is-active');
  void bar.offsetWidth; // reflow, so the animation actually re-runs
  bar.classList.add('is-active');

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
  timer = window.setTimeout(stop, SAFETY_MS);
}

document.addEventListener('astro:before-preparation', (e) => start(e.sourceElement));

// ⚠ `astro:page-load` AND NOT `astro:after-preparation`, which is what the
// Astro guide's loading-indicator snippet uses. After-preparation means the
// next document has been FETCHED; the swap, the view transition and the paint
// all still lie between there and anything the reader can see. Ending the bar
// at the fetch would put the gap back at the end instead of the beginning,
// which is where it is least noticeable but still exactly as long. This event
// means the new page is on screen.
document.addEventListener('astro:page-load', stop);

// The document is going away — or coming back from bfcache, where a bar frozen
// mid-creep would be restored along with everything else. Public HTML is
// CDN-cached rather than `no-store`, so unlike the Observatory this restore
// really can happen.
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', stop);

// ⚠ THIS LINE IS LOAD-BEARING AND LOOKS LIKE DEAD CODE. TypeScript treats a
// file with no top-level import or export as a global SCRIPT, not a module — so
// `BAR`, `SAFETY_MS`, `timer`, `start` and `stop` would all be declared in the
// global scope. `nav-progress.ts` next door is such a file and names four of
// the same five, which `astro check` reports as eight redeclaration errors
// across both files the moment this one exists. Nothing at runtime cares (Vite
// gives each its own module scope either way); the type-checker is the one that
// has to be told, and this is how it is told.
export {};
