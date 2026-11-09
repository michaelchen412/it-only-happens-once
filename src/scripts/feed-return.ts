/*
  feed-return — the blog feed keeps its place (2026-11-09).

  Two promises, one mechanism:

   1. **Back, Forward and reload return to the same place in the list.** The
      feed is infinite scroll and the server only ever renders page 1 on a
      navigation, so before this a reader 19,000px deep who opened an essay's
      own page and pressed Back came home to 14 cards at 2,000px — measured.
   2. **A piece's own page, reached FROM the feed, leads back to that place.**
      Its "‹ The blog" / "‹ All quotes" goes to the exact list the reader left —
      same filters, same search, same depth, same card at the same height.

  ⚠ ONLY FROM THE FEED, AND THAT IS THE DESIGN RATHER THAN A LIMIT. Michael:
  *"if they came to the standalone page from the actual blog scrolling, then it
  would be good to save the place, not shoehorn the entire implementation for
  people clicking disparate links, which would indeed make it confusing to land
  in the middle."* A shared link, a constellation, another piece's page — none
  of those has a place in the list to go back to, and landing a stranger in the
  middle of 2023 would be a puzzle, not a courtesy. They keep the plain link to
  the top. "From the feed" means: the navigation started while on `/blog`, in
  this tab — an essay's title in the sheet, or a ⌕ search result opened over
  the list (ruled in: the reader left to look something up, not to leave).

  ⚠ EVERYTHING LIVES ON HISTORY ENTRIES — nothing in the URL, nothing in
  storage. The URL is what gets shared, so a place written there would follow
  a link to a stranger (the very thing ruled out above). Storage outlives the
  visit, so a stale place would answer a later, unrelated arrival at the same
  piece. A history entry is exactly as long-lived as the visit it describes:
  Back, Forward and reload keep it; arriving any other way is a NEW entry,
  which has none. The router keeps its own bookkeeping on the same object —
  `index`, `scrollX/Y` — so every write here MERGES and never replaces.

  ⚠ THE ROUTER'S `scrollY` IS NOT TRUSTED, and `feedAnchor` exists because of
  it. On Back the router scrolls to its saved position while only page 1 has
  been rendered; the browser clamps the scroll to that short page, and the
  router's own scroll-end bookkeeping then writes the CLAMPED value back. So
  the place is held in our own keys and expressed as a card and its offset,
  which also survives a piece being published or retracted in between.

  The DOM work — fetching pages, appending, the sentinel — stays in
  `blog-feed.ts`, which owns the feed. This file owns the state: what the place
  is, where it is written, and when writing is allowed.
*/
import { navigate } from 'astro:transitions/client';

export type FeedAnchor = { slug: string; top: number; y: number };
export type FeedSpot = { feedPages: number; feedAnchor: FeedAnchor | null };
type FeedReturn = FeedSpot & { list: string };

/*
  ⚠ SHARED THROUGH `window`, NOT MODULE SCOPE. This file is imported by two
  pages (`/blog` and `/blog/[slug]`). In a build both resolve to one chunk and
  one instance, but nothing guarantees it — and two instances would mean two
  `settled` flags, one written by the restore and the other read by the stamp,
  which fails silently. One object, wherever the code came from.
*/
type Shared = {
  /** False from the moment a navigation starts until the next feed's restore
   *  has finished. While false nothing is stamped: the DOM is either the page
   *  being left (and the entry may already be the ARRIVING one, on a traverse)
   *  or a half-restored feed whose numbers are not the reader's. */
  settled: boolean;
  /** A place captured as a navigation leaves `/blog` for a piece's page,
   *  waiting for that page's entry to exist so it can be written onto it. */
  pending: (FeedReturn & { to: string }) | null;
  /** The reader's input since the arriving feed was swapped in — see `takeIntent`. */
  intent: (() => boolean) | null;
};
declare global {
  interface Window {
    __feedReturn?: Shared;
  }
}
const shared = (): Shared => (window.__feedReturn ??= { settled: false, pending: null, intent: null });

const isList = (p: string) => p === '/blog' || p === '/blog/';
const isPiece = (p: string) => /^\/blog\/[^/]+\/?$/.test(p);

/** Where the reader is in the feed right now, read from the DOM. */
export function spotNow(): FeedSpot | null {
  const list = document.getElementById('feed-list');
  if (!list) return null;
  const size = Number(list.dataset.pageSize) || 1;
  const cards = Array.from(list.children);
  // The first card whose bottom edge is still on screen. Its top may be
  // negative — that IS the position, and restoring it reproduces the viewport
  // exactly, header and all, with no header arithmetic to drift.
  //
  // Valid behind an open sheet: the scroll lock is `overflow: hidden` on
  // <html>, which freezes the page without moving it (scripts/scroll-lock.ts).
  let feedAnchor: FeedAnchor | null = null;
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    if (r.bottom > 0) {
      const slug = card.querySelector<HTMLElement>('[data-read]')?.dataset.read;
      if (slug) feedAnchor = { slug, top: r.top, y: window.scrollY };
      break;
    }
  }
  return { feedPages: Math.max(1, Math.ceil(cards.length / size)), feedAnchor };
}

/** The place recorded on the current entry, if any. */
export function savedSpot(): FeedSpot | null {
  const s = history.state as Partial<FeedSpot> | null;
  if (!s || typeof s.feedPages !== 'number') return null;
  return { feedPages: s.feedPages, feedAnchor: s.feedAnchor ?? null };
}

function merge(patch: object) {
  // Only an entry the router already owns. It gives every entry a state, the
  // first load included — so a null state means something else wrote here, and
  // inventing one would hand the router an entry with no `index`.
  if (!history.state) return;
  try {
    history.replaceState({ ...history.state, ...patch }, '');
  } catch {
    // Safari throttles replaceState (100 calls / 30s). Losing one stamp costs
    // a slightly older place; throwing would cost the scroll handler.
  }
}

/** Write the current place onto the current entry — on the feed, when settled. */
export function stamp() {
  if (!shared().settled || !isList(location.pathname)) return;
  const spot = spotNow();
  if (spot) merge(spot);
}

/** The restore is done (or there was nothing to restore): stamping may resume. */
export function markSettled() {
  shared().settled = true;
}

/** Scroll so the anchor card sits where it sat. Falls back to the raw offset. */
export function scrollToSpot(anchor: FeedAnchor) {
  const card = Array.from(document.getElementById('feed-list')?.children ?? []).find(
    (c) => c.querySelector<HTMLElement>('[data-read]')?.dataset.read === anchor.slug,
  );
  const top = card ? card.getBoundingClientRect().top + window.scrollY - anchor.top : anchor.y;
  // ⚠ `instant`, ALWAYS. app.css sets `scroll-behavior: smooth` on <html> for
  // the Sky's zoom, and a default scrollTo would animate the reader through
  // every card they had already read on the way back to their place.
  window.scrollTo({ top, behavior: 'instant' });
}

/** The words for a list, so the link names where it actually goes — a ⌕ hop
 *  can carry an essay back to the quotes view, or a quote back to writing. */
function labelFor(list: string): string {
  const p = new URL(list, location.origin).searchParams;
  if (p.get('view') !== 'quotes') return 'The blog';
  return p.has('subject') || p.has('q') || p.has('author') ? 'The quotes' : 'All quotes';
}

function feedReturn(): FeedReturn | null {
  const r = (history.state as { feedReturn?: FeedReturn } | null)?.feedReturn;
  return r && typeof r.list === 'string' ? r : null;
}

/** On a piece's page reached from the feed: point its way back at that place. */
function wireReturnLinks() {
  const r = feedReturn();
  if (!r) return;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-feed-return]')) {
    a.href = r.list;
    const label = a.querySelector('[data-feed-return-label]');
    if (label) label.textContent = labelFor(r.list);
  }
}

/** Bind once per document. <html> survives view transitions, so the flag does. */
export function initFeedReturn() {
  if (document.documentElement.dataset.feedReturnBound) return;
  document.documentElement.dataset.feedReturnBound = '1';

  document.addEventListener('astro:before-preparation', (e) => {
    const s = shared();
    s.pending = null;
    // ⚠ NOT ON A TRAVERSE. Back/Forward has already moved the URL by the time
    // this fires, so `history.state` is the entry being ARRIVED at — stamping
    // now would write this feed's place onto some other page. The scroll stamp
    // below has already recorded it.
    if (e.navigationType !== 'traverse' && isList(location.pathname)) {
      stamp();
      const spot = spotNow();
      // `location`, the address actually on screen — including the search,
      // which is part of the place. (Since 2026-11-09 a search is a router
      // navigation, so `e.from` agrees; it did not before, when the search
      // moved the URL behind the router's back.)
      if (spot && isPiece(e.to.pathname)) {
        s.pending = { ...spot, list: location.pathname + location.search, to: e.to.pathname };
      }
    }
    s.settled = false;
  });

  // ⚠ AFTER-SWAP, NOT PAGE-LOAD: by now the router has pushed the new entry
  // (`moveToLocation` runs just before this), and it fires before any of the
  // arriving page's own page-load listeners — so the link wiring below always
  // finds the place already written.
  document.addEventListener('astro:after-swap', () => {
    const s = shared();
    // ⚠ INTENT IS WATCHED FROM THE SWAP, NOT FROM PAGE-LOAD. The router fires
    // page-load only after the view transition has finished, so a key or a
    // swipe in that gap — exactly when a reader who has just arrived starts
    // moving — was missed, and the restore jumped over it (caught on the phone
    // run of feed-return.anon.spec.ts, 2026-11-09).
    s.intent?.();
    s.intent = isList(location.pathname) ? watchIntent() : null;
    const p = s.pending;
    s.pending = null;
    if (p && location.pathname === p.to) {
      const feedReturn: FeedReturn = { list: p.list, feedPages: p.feedPages, feedAnchor: p.feedAnchor };
      merge({ feedReturn });
    }
  });

  document.addEventListener('astro:page-load', () => {
    if (isPiece(location.pathname)) wireReturnLinks();
  });

  // The link goes back to the list as a NEW entry carrying the place, and the
  // list's restore reads it from there exactly as it reads one left by Back.
  // `history.back()` was the alternative and lost: the entry behind a piece's
  // page is usually `#read=<slug>`, so it would reopen the sheet — and the
  // control says "The blog", not "the sheet".
  //
  // Capture phase + stopPropagation for the reason Reader.astro gives: the
  // ClientRouter's own click listener would otherwise navigate first.
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element)?.closest?.('a[data-feed-return]');
      const r = feedReturn();
      if (!a || !r) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab = plain href
      e.preventDefault();
      e.stopPropagation();
      void navigate(r.list, { state: { feedPages: r.feedPages, feedAnchor: r.feedAnchor } });
    },
    true,
  );

  // Stamp as the reader settles, not only on the way out: a Back or Forward
  // AWAY from the feed gives no chance to write anything (see above), so the
  // entry has to be current already. `scroll` debounced rather than
  // `scrollend`, which Safari does not have — the router polls for the same
  // reason. Scrolling inside an open sheet happens in its own scroller and
  // never reaches `window`.
  let t = 0;
  window.addEventListener(
    'scroll',
    () => {
      clearTimeout(t);
      t = window.setTimeout(stamp, 250);
    },
    { passive: true },
  );
  // Reload and closing the tab: the last chance to write.
  window.addEventListener('pagehide', stamp);
}

/**
 * Starts watching; the function it returns stops watching and says whether the
 * reader scrolled, swiped or pressed a key on the PAGE meanwhile — their intent
 * outranks a jump to where they used to be. Input inside an open dialog does
 * not count: Back to `#read=<slug>` reopens the sheet over the list being
 * restored, and reading it must not cancel the restore beneath.
 */
function watchIntent(): () => boolean {
  let moved = false;
  const on = (e: Event) => {
    if (!(e.target as Element | null)?.closest?.('dialog[open]')) moved = true;
  };
  const kinds = ['wheel', 'touchstart', 'keydown'] as const;
  for (const k of kinds) window.addEventListener(k, on, { capture: true, passive: true });
  return () => {
    for (const k of kinds) window.removeEventListener(k, on, { capture: true });
    return moved;
  };
}

/**
 * The watcher armed when this feed was swapped in, handed over to the restore
 * (or a fresh one on a first load, where nothing precedes page-load). Taken
 * exactly once per arrival, so a watcher is never left listening.
 */
export function takeIntent(): () => boolean {
  const s = shared();
  const w = s.intent ?? watchIntent();
  s.intent = null;
  return w;
}
