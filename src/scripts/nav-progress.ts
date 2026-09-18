// The click lands first (docs/plans/24 · Piece 1).
//
// ⚠ THE PROBLEM THIS SOLVES IS NOT THAT THE OBSERVATORY IS SLOW. It is that a
// click on a sidebar row was answered by NOTHING — no code in the tree ran on a
// nav click, because `AdminLayout` never passed `transitions` and so no
// `<ClientRouter />` was ever mounted. A full document navigation leaves the old
// page painted and hands feedback to the browser's tab spinner, which on a phone
// is behind a collapsed URL bar. Michael, 2026-08-07: *"I have to wait one
// second, and then I get a response after my click… especially if I'm on mobile
// and I can't even see the spinner in the tab."*
//
// ⚠ IT IS NOT A ROUTER, AND IT DID NOT BECOME ONE. This file's original note
// said turning on `<ClientRouter />` "would be a migration (24 · §9)" and that
// acknowledging the click was the separate, smaller job Michael had actually
// described. Both halves of that held: the bar shipped on 2026-08-07 and the
// migration landed on 2026-09-18, six weeks later, as its own piece of work.
//
// The router is now ON for the Observatory, and this bar still earns its place:
// a swap is fast but not instant — it still fetches the next page — so the frame
// between the press and the arrival is exactly as empty as it ever was. What
// changed is only the CLEAR, which now has a real event to listen for; see the
// bottom of this file.
//
// The migration's own account is in `scripts/page.ts`. The number that made it
// look expensive — counted 2026-08-07 as "40 files and ~250 element-bound
// listener sites" — turned out to be the wrong measure: what mattered was the
// 32 scripts the admin actually loads, and of those two needed nothing at all
// (this one, and `keyboard-inset.ts`) because they were already bound only to
// things that survive a swap.
//
// A BAR, NOT A SKELETON, and the loser is named because it will come back. A
// skeleton has to know the shape of the room it stands in — Today's five zones,
// People's circles, the Library's table — so it is seven skeletons, each a
// second copy of a layout that will drift from the real one. A bar knows nothing
// and is therefore never wrong. Skeletons earn themselves when PART of a page
// waits on data the rest doesn't; here the whole document is the unit, because
// the whole document is what is being fetched.

const BAR = 'nav-progress';
/** Give up if the navigation never happens — see `stop()`'s callers. */
const SAFETY_MS = 10_000;

let timer = 0;

function stop() {
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
  document.getElementById(BAR)?.classList.remove('is-active');
  document.getElementById('admin-main')?.removeAttribute('aria-busy');
  document.querySelector('[data-nav-pending]')?.removeAttribute('data-nav-pending');
}

function start(link: HTMLAnchorElement) {
  const bar = document.getElementById(BAR);
  if (!bar) return;

  // Restart the creep from zero on a second click (impatience is a real input).
  bar.classList.remove('is-active');
  void bar.offsetWidth; // reflow, so the animation actually re-runs
  bar.classList.add('is-active');

  document.getElementById('admin-main')?.setAttribute('aria-busy', 'true');

  // THE SIDEBAR ANSWERS BEFORE THE PAGE DOES. The highlight moves to the row you
  // pressed the instant you press it, rather than a second later when the new
  // document paints. Only for rows in the sidebar — `data-nav-row` marks them —
  // because a link in the CONTENT moving a sidebar highlight would be a lie.
  //
  // ⚠ `data-nav-pending`, NOT `aria-current`. Moving `aria-current` would be the
  // tidier-looking change and it would tell a screen reader it is on a page it
  // has not reached yet. The visual state may run ahead of the truth; the
  // accessibility tree may not.
  if (link.hasAttribute('data-nav-row')) {
    document.querySelector('[data-nav-pending]')?.removeAttribute('data-nav-pending');
    link.setAttribute('data-nav-pending', '');
  }

  // ⚠ THE TIMEOUT IS NOT BELT-AND-BRACES, IT IS THE `download` CASE. The Library
  // links to `/admin/export.json` with `download`, and its own comment says the
  // browser "downloads it and never navigates" — no `pagehide`, so without this
  // the bar would creep forever on a page the reader is still sitting on. Same
  // for a 302 the browser declines to follow and for a failed request.
  timer = window.setTimeout(stop, SAFETY_MS);
}

/**
 * Is this click one that will actually replace the document?
 *
 * Every `return false` below is a real link in this tree, not a hypothetical:
 * `download` on the Library's export, `target="_blank"` on five View ↗ controls,
 * and the hash-only links the popovers use.
 */
function navigates(e: MouseEvent, link: HTMLAnchorElement): boolean {
  // Something already claimed this click — a dialog opener, a popover trigger.
  if (e.defaultPrevented) return false;
  // Let the browser's own affordances through untouched: new tab, download, save.
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return false;
  if (link.hasAttribute('download')) return false;
  if (link.target && link.target !== '_self') return false;

  const url = new URL(link.href, location.href);
  // mailto:, tel:, and anything off this origin — the document is not ours to wait for.
  if (url.origin !== location.origin) return false;
  // A bare `#hash` on the page you are already on scrolls; it does not navigate.
  if (url.pathname === location.pathname && url.search === location.search) return false;

  return true;
}

// Delegated on `document` and on the BUBBLE phase, which is what makes the
// `defaultPrevented` check above possible: by the time this runs, anything that
// wanted to claim the click has. (Reader.astro captures for the opposite reason
// and says so — it has to beat the router. Nothing here is racing anyone.)
//
// ⚠ THIS IS NOW THE FULL-LOAD PATH ONLY, and the reason is the whole of what
// `<ClientRouter />` changed here (2026-09-18). The router claims every internal
// link it will handle — `preventDefault()`, on the way past — so `navigates()`
// sees `defaultPrevented` and bows out, and the bar never started. The check is
// still right: it means *somebody else owns what happens next*. What changed is
// that one of those somebodies now owns the exact case this bar exists for.
//
// So the click handler keeps the navigations the ROUTER does not take (a full
// document load, a `download`, a foreign origin) and the router's own signal
// below takes the rest. Loosening `navigates()` to ignore `defaultPrevented`
// was the alternative and is wrong twice over: it would start the bar for a
// dialog opener that claimed a click, and it would start it TWICE for a router
// navigation, once here and once below.
document.addEventListener('click', (e) => {
  const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!link || !navigates(e, link)) return;
  start(link);
});

/*
  ⚠ THE ROUTER'S OWN "I AM FETCHING" EVENT. `astro:before-preparation` fires
  when the router starts loading the next page and before anything is swapped —
  which is the same instant the click handler above used to fire at, for the
  navigations it no longer sees.

  A swap is faster than a document load and is still not instant: it fetches the
  page first. So the frame between the press and the arrival is exactly as empty
  as it ever was, and this bar is still the only thing in it.

  ⚠ THE LINK IS RECOVERED FROM THE DESTINATION, not from the event. The event
  carries `to`, a URL, rather than the element that was pressed — so the sidebar
  row is found by matching its `href`. That keeps the pending-highlight rule
  exactly as it was: only a `[data-nav-row]` may move it, and a link in the
  CONTENT pointing at the same room moves nothing.
*/
document.addEventListener('astro:before-preparation', (e) => {
  const to = (e as Event & { to?: URL }).to;
  if (!to) return;
  const row = document.querySelector<HTMLAnchorElement>(
    `[data-nav-row][href="${CSS.escape(to.pathname)}"], [data-nav-row][href="${CSS.escape(to.pathname + to.search)}"]`,
  );
  // No sidebar row means a link somewhere in the content: the bar still creeps,
  // and `start` simply finds nothing to mark pending.
  start(row ?? document.createElement('a'));
});

// The document is going away — or coming back from bfcache, where a bar frozen
// mid-creep would be restored along with everything else. (Admin HTML is
// `no-store`, so that restore does not currently happen; this costs one line and
// stops being a latent bug the day that header is revisited.)
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', stop);

// ⚠ LIVE SINCE 2026-09-18, and it was written a month and a half early for
// exactly this. The line used to read "inert today: no admin page mounts
// `<ClientRouter />`. Here so that the day 24 · §9 lands, the bar clears itself
// on arrival instead of needing to be found." That day landed, and it did.
document.addEventListener('astro:page-load', stop);
