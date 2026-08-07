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
// ⚠ AND IT IS DELIBERATELY NOT A ROUTER. Turning on `<ClientRouter />` would
// make the swap client-side, which sounds like the same fix and is not: a
// `<script>` module runs ONCE per document, and a view-transition swap replaces
// the DOM without re-running it — so every listener bound directly to a page
// element dies after the first navigation. Counted 2026-08-07: **40 files and
// ~250 element-bound listener sites** in the admin have no `astro:page-load`
// re-init. That is a migration (24 · §9), and it buys the chrome not repainting.
// It does NOT buy this: acknowledging the click is forty lines and no risk, and
// it is the half Michael actually described. The two are separate jobs.
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
document.addEventListener('click', (e) => {
  const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!link || !navigates(e, link)) return;
  start(link);
});

// The document is going away — or coming back from bfcache, where a bar frozen
// mid-creep would be restored along with everything else. (Admin HTML is
// `no-store`, so that restore does not currently happen; this costs one line and
// stops being a latent bug the day that header is revisited.)
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', stop);

// Inert today: no admin page mounts `<ClientRouter />`. Here so that the day
// 24 · §9 lands, the bar clears itself on arrival instead of needing to be found.
document.addEventListener('astro:page-load', stop);
