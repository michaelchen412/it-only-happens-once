// Client behaviour for the blog feed (/blog): live search, subject filters,
// infinite scroll, and the reader's place. All operate on #blog-feed and the
// rail, coordinated here so they never fight:
//
//   · Search  — debounced, and a ROUTER NAVIGATION with a swap of our own (see
//     "A SEARCH IS A NAVIGATION" below). Mirrors the admin + docs/search.md:
//     MIN_SEARCH gating, effective-query comparison, URL hygiene, clear reverts.
//   · Subjects — the rail's tags are plain links whose href the server already
//     builds to the post-toggle selection (AND semantics). The ClientRouter
//     navigates them like any link; this file only carries the rail's scroll
//     and its "Show all" state across that swap.
//   · Infinite scroll — an IntersectionObserver on #feed-sentinel appends the next
//     page (fetched via X-Requested-With so the server honours ?page) into
//     #feed-list. Re-armed on every page-load, on the fresh sentinel.
//   · Its place — `feed-return.ts` records how deep the reader is and where,
//     and the page-load handler below restores it (Back, Forward, reload, and
//     the way back from a piece's own page).
import { navigate } from 'astro:transitions/client';
import { MIN_SEARCH } from '../lib/search-highlight';
import { NAV_FEED_SEARCH } from '../lib/nav-info';
import { initFeedReturn, markSettled, savedSpot, scrollToSpot, stamp, takeIntent } from './feed-return';

initFeedReturn();

let io: IntersectionObserver | null = null;
let loadingMore = false;

// Search state at module scope: the debounce timer outlives the navigation it
// starts, and must find the same field when it fires.
let qInput: HTMLInputElement | null = null;
let searchTimer = 0;
let lastEffective = '';

/** The query the server would actually act on (below MIN_SEARCH ⇒ none). */
function effective(): string {
  const raw = qInput?.value.trim() ?? '';
  return raw.length >= MIN_SEARCH ? raw : '';
}

/** (Re)arm the observer on the current sentinel — call after any feed swap. */
function observeSentinel() {
  io?.disconnect();
  const sentinel = document.getElementById('feed-sentinel');
  if (!sentinel) return;
  io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    },
    { rootMargin: '600px 0px' },
  );
  io.observe(sentinel);
}

type Page = { nodes: Element[]; next: string | null };

/** One page of the feed, as a partial (the server honours `?page` only for this). */
async function fetchPage(url: string, signal?: AbortSignal): Promise<Page> {
  const res = await fetch(url, { headers: { 'X-Requested-With': 'fetch' }, signal });
  if (!res.ok) throw new Error('bad status');
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  return {
    nodes: Array.from(doc.getElementById('feed-list')?.children ?? []),
    next: doc.getElementById('feed-sentinel')?.getAttribute('data-next-url') ?? null,
  };
}

const slugOf = (card: Element) => card.querySelector<HTMLElement>('[data-read]')?.dataset.read;

/**
 * Append a page's cards — skipping any already on the list. Pages are cut by
 * position, so a piece published or retracted between two fetches shifts every
 * later page by one, and the seam would otherwise show the same card twice. It
 * matters most for a restore, which re-fetches pages minutes after the first.
 */
function appendPage(list: HTMLElement, page: Page) {
  const seen = new Set(Array.from(list.children, slugOf));
  for (const node of page.nodes) {
    const slug = slugOf(node);
    if (slug && seen.has(slug)) continue;
    list.append(node.cloneNode(true));
  }
}

/** Point the sentinel at the next page, or retire it at the end of the feed. */
function advanceSentinel(next: string | null) {
  const sentinel = document.getElementById('feed-sentinel');
  if (!sentinel) return;
  if (next) {
    sentinel.dataset.nextUrl = next;
  } else {
    io?.disconnect();
    sentinel.remove(); // reached the end
  }
}

/** Fetch the next page and append its items; advance or retire the sentinel. */
async function loadMore(): Promise<void> {
  const sentinel = document.getElementById('feed-sentinel') as HTMLElement | null;
  const list = document.getElementById('feed-list');
  if (!sentinel || !list || loadingMore) return;
  const url = sentinel.dataset.nextUrl;
  if (!url) return;

  loadingMore = true;
  sentinel.classList.add('is-loading');
  try {
    const page = await fetchPage(url);
    appendPage(list, page);
    advanceSentinel(page.next);
    stamp(); // the entry learns the new depth now, not only on the way out
  } catch {
    // Leave the manual link in place so the reader can retry by clicking it.
  } finally {
    loadingMore = false;
    document.getElementById('feed-sentinel')?.classList.remove('is-loading');
  }

  // Tall screen / short page: if the sentinel is still within the prefetch band,
  // keep pulling pages until it's pushed down or we run out.
  const s = document.getElementById('feed-sentinel') as HTMLElement | null;
  if (s?.dataset.nextUrl && s.getBoundingClientRect().top < window.innerHeight + 600) {
    requestAnimationFrame(() => loadMore());
  }
}

/*
  The deepest a restore will reach. The whole corpus is nine pages of writing
  and four of quotes; this only stops a corrupt or hand-edited entry asking for
  a thousand fetches.
*/
const MAX_RESTORE_PAGES = 30;

/**
 * Put the feed back the way the reader left it: as many pages as they had,
 * scrolled so the card that was at the top is at the top again.
 *
 * The pages come in PARALLEL and are appended IN ORDER. They are the same URLs
 * the reader loaded the first time, so the browser's ten-minute cache
 * (lib/http-cache.ts, `Vary: X-Requested-With`) usually answers every one of
 * them without a request reaching the network.
 *
 * ⚠ IT RUNS BEFORE THE SENTINEL IS OBSERVED (see the page-load handler), and
 * that order is the fix for a race, not tidiness. On Back the router has
 * already scrolled to its saved position over page 1 alone, which leaves the
 * reader at the bottom of that page — sentinel in view. Arming the observer
 * first is what produced the measured "14 cards": it fetched page 2 while the
 * restore would be fetching it too, and the seam doubled.
 */
async function restoreFeed(signal: AbortSignal): Promise<void> {
  // Taken before anything can return, so the watcher armed at the swap is
  // always released — see `takeIntent`.
  const intent = takeIntent();
  try {
    const spot = savedSpot();
    const list = document.getElementById('feed-list');
    if (!spot || !list) return;
    const size = Number(list.dataset.pageSize) || 1;
    const have = Math.ceil(list.children.length / size);
    const want = Math.min(spot.feedPages, MAX_RESTORE_PAGES);
    const next = document.getElementById('feed-sentinel')?.dataset.nextUrl;
    if (want > have && next) {
      const feed = document.getElementById('blog-feed');
      feed?.classList.add('list-loading');
      try {
        const urls: string[] = [];
        for (let k = have + 1; k <= want; k++) {
          const u = new URL(next, location.href);
          u.searchParams.set('page', String(k));
          urls.push(u.pathname + u.search);
        }
        const pages = await Promise.allSettled(urls.map((u) => fetchPage(u, signal)));
        if (signal.aborted || !list.isConnected) return;
        for (const page of pages) {
          // A failed page stops the restore there, and the sentinel already
          // points at it — scrolling down simply tries it again.
          if (page.status === 'rejected') break;
          appendPage(list, page.value);
          advanceSentinel(page.value.next);
          if (!page.value.next) break;
        }
      } finally {
        feed?.classList.remove('list-loading');
      }
    }
    if (signal.aborted) return;
    // The reader's own scroll since arriving outranks where they used to be.
    if (spot.feedAnchor && !intent()) scrollToSpot(spot.feedAnchor);
  } finally {
    intent();
  }
}

/*
  ⚠ A SEARCH IS A NAVIGATION (2026-11-09), AND THE SWAP IS OURS.

  Until this date a search fetched the page itself, wrote the feed and rail in
  place, and moved the URL with `history.replaceState` — behind the
  ClientRouter's back. The router keeps its own idea of where the page is, and
  only learns it from navigations it performs, so after any search it still
  believed it was on the PRE-search URL. The next thing that asked it to move —
  the Reader opening a sheet with `navigate('#read=…')` — looked to it like a
  hop to a different page, and it refetched and re-rendered the whole list:
  measured, 14 cards at y≈2,973 became 7 at the top the moment a result was
  opened. It also meant the reader's place could not be kept on a searched list
  at all (scripts/feed-return.ts).

  So the router performs the navigation now — it owns the URL, aborts a search
  overtaken by the next keystroke, and falls back to a full load if the fetch
  fails — and only the SWAP is replaced (`astro:before-swap` below).

  ⚠ WHY A CUSTOM SWAP, AND NOT THE ROUTER'S OWN WITH THE FIELD PERSISTED. The
  obvious version is `transition:persist` on the search field and the default
  whole-body swap. It loses on a phone: Astro moves a persisted element out and
  back in, and where `moveBefore()` does not exist (Safari, so every iPhone
  browser) that detaches the focused field — the keyboard closes at every pause
  in typing, and a programmatic re-focus outside a tap cannot reopen it. The
  field must never move, so the swap replaces exactly the three regions a query
  changes — `[data-rail-filters]`, `#blog-feed`, `[data-reader-sheets]` (see
  blog/index.astro) — and leaves everything else, the field included, alone.

  ⚠ THE PRICE: `astro:page-load` FIRES OVER A DOCUMENT THAT WAS NOT REPLACED.
  Every page-load binder that touches long-lived elements must therefore be
  idempotent — `setupSearch` below and `site-search.ts`'s `wire()` were not,
  and both now are. A new binder on the public site has to be too.
*/
function runSearch(): void {
  lastEffective = effective();
  const url = new URL(location.href);
  if (lastEffective) url.searchParams.set('q', lastEffective);
  else url.searchParams.delete('q'); // below MIN_SEARCH → omitted (URL stays clean)
  url.searchParams.delete('page'); // a changed query restarts at page 1
  url.hash = '';
  // `replace`: a search is a refinement of where you are, not somewhere new —
  // each keystroke pause as a Back step would make Back useless.
  void navigate(url.pathname + url.search, { history: 'replace', info: NAV_FEED_SEARCH });
}

/** What the page on screen was rendered for — the URL's query, as the server reads it. */
function shownQuery(): string {
  const q = (new URL(location.href).searchParams.get('q') ?? '').trim();
  return q.length >= MIN_SEARCH ? q : '';
}

/** Run a search only if the server would answer differently from the page shown. */
function maybeRun() {
  if (effective() !== lastEffective) runSearch();
}

/** Bind the rail search to a debounced navigation. Idempotent — see above. */
function setupSearch() {
  const form = document.getElementById('blog-filters') as HTMLFormElement | null;
  qInput = (form?.elements.namedItem('q') as HTMLInputElement | null) ?? null;
  if (!form || !qInput) return;
  // ⚠ THE BASELINE IS THE URL, NOT THE FIELD. After a search lands the field
  // may already hold more than was searched — the reader kept typing while it
  // was in flight — and taking the field as the baseline would make the timer
  // for those extra letters find "nothing changed" and never run.
  lastEffective = shownQuery();
  if (form.dataset.searchBound) return; // same form, same field: already wired
  form.dataset.searchBound = '1';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    // The Search key on a phone keyboard means "I'm done typing, show me" — but
    // a prevented submit leaves the field focused, so the results arrive behind
    // a keyboard that covers half of them. Blur where the keyboard is real. On
    // a desktop Enter, focus stays: the field is not in the reader's way there,
    // and taking focus off it mid-search would be the surprising thing.
    // (The zoom this used to leave behind on iOS is prevented upstream now —
    //  see app.css, THE 16px FLOOR. This is about the keyboard, not the zoom.)
    if (window.matchMedia('(pointer: coarse)').matches) qInput?.blur();
    runSearch();
  });
  qInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(maybeRun, 250);
  });
  qInput.addEventListener('search', () => {
    // Native clear (✕) / Enter in a type=search field.
    clearTimeout(searchTimer);
    maybeRun();
  });
}

// The feed dims while a search is in flight — the only feedback it gets, since
// it opts out of the progress bar (lib/nav-info.ts). The swap replaces the
// dimmed element, so nothing has to un-dim it; a search overtaken by the next
// one is simply dimmed again.
document.addEventListener('astro:before-preparation', (e) => {
  if (e.info === NAV_FEED_SEARCH) document.getElementById('blog-feed')?.classList.add('list-loading');
});

/** Replace the regions a query changes, from the fetched page. See above. */
function swapSearchRegions(next: Document) {
  for (const sel of ['[data-rail-filters]', '#blog-feed', '[data-reader-sheets]']) {
    const now = document.querySelector(sel);
    const then = next.querySelector(sel);
    if (now && then) now.replaceWith(document.adoptNode(then));
  }
}

// Manual "Load older" click → load in place instead of navigating.
document.addEventListener('click', (e) => {
  const more = (e.target as Element)?.closest?.('[data-feed-more]');
  if (more) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // allow new-tab
    e.preventDefault();
    loadMore();
  }
});

// Subjects rail (mobile): reveal the long tail behind "Show all" / "Show fewer".
document.addEventListener('click', (e) => {
  const btn = (e.target as Element)?.closest?.('[data-subjects-toggle]') as HTMLElement | null;
  const wrap = btn?.closest('[data-subjects]');
  if (!btn || !wrap) return;
  const expanded = wrap.classList.toggle('is-expanded');
  btn.textContent = expanded ? 'Show fewer' : btn.dataset.labelCollapsed || 'Show all';
  btn.setAttribute('aria-expanded', String(expanded));
});

// ⚠ THE RAIL KEEPS ITS PLACE ACROSS A TAG CLICK. `<ClientRouter />` navigates
// that click and replaces the whole document, so the rail's own scroller (see
// the <aside> in blog/index.astro) comes back at 0 — and on a short window the
// tag just selected, and every tag next to it, is out of sight. Subjects stack,
// so choosing two from the bottom of the list would mean scrolling back down
// between them. Same-page only: a different room owes this list nothing, and
// `transition:persist` is not the answer because it would keep the old counts,
// which are the reason the rail re-renders at all.
//
// The mobile "Show all" rides along for the same reason, written into the
// INCOMING page before it is swapped in so it never paints collapsed. A search
// used to keep it by never replacing the wrapper; now that the search swap
// replaces the rail's filters too, this one rule covers tags and searches alike.
let railScroll = 0;
document.addEventListener('astro:before-swap', (e) => {
  const samePage = e.from.pathname === e.to.pathname;
  railScroll = samePage ? (document.querySelector('[data-blog-rail]')?.scrollTop ?? 0) : 0;

  if (samePage && document.querySelector('[data-subjects]')?.classList.contains('is-expanded')) {
    const wrap = e.newDocument.querySelector('[data-subjects]');
    const btn = wrap?.querySelector('[data-subjects-toggle]');
    wrap?.classList.add('is-expanded');
    if (btn) {
      btn.textContent = 'Show fewer';
      btn.setAttribute('aria-expanded', 'true');
    }
  }

  if (e.info === NAV_FEED_SEARCH) {
    // No cross-fade: the page is not changing, a list is. A frozen frame while
    // someone is typing reads as the field dropping letters.
    // `skipTransition()` rejects `ready` with an AbortError rather than
    // throwing; caught first, as Astro's own router does, or every search
    // logs an unhandled rejection.
    e.viewTransition.ready.catch(() => {});
    e.viewTransition.skipTransition();
    e.swap = () => swapSearchRegions(e.newDocument);
  }
});
document.addEventListener('astro:after-swap', () => {
  document.querySelector('[data-blog-rail]')?.scrollTo(0, railScroll);
});

// Every arrival, first load included — and after a search, which arrives over
// the same document (see "A SEARCH IS A NAVIGATION"), so each step is idempotent.
//
// ⚠ RESTORE, THEN OBSERVE — see `restoreFeed`. `loadingMore` is held for the
// duration so a "Load older" click cannot append the page being restored.
let restoring: AbortController | null = null;
document.addEventListener('astro:before-preparation', () => restoring?.abort());
document.addEventListener('astro:page-load', async () => {
  setupSearch();
  const ctl = (restoring = new AbortController());
  loadingMore = true;
  try {
    await restoreFeed(ctl.signal);
  } catch {
    // An aborted or failed restore leaves page 1 — the feed as it always was.
  } finally {
    if (restoring === ctl) restoring = null;
    // Aborted means this page is being left: the next page-load owns the flags.
    if (!ctl.signal.aborted) {
      loadingMore = false;
      observeSentinel();
      markSettled();
    }
  }
});
