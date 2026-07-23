// Client behaviour for the blog feed (/blog): live search, stackable subject
// filters, and infinite scroll. All three operate on #blog-feed and the rail,
// coordinated here so they never fight:
//
//   · Search  — a debounced fetch-and-swap (input lives in the rail, outside the
//     swap, so it keeps focus). Mirrors the admin + docs/search.md: MIN_SEARCH
//     gating, effective-query comparison, URL hygiene, clear reverts.
//   · Subjects — the rail's tags are toggle links whose href the server already
//     builds to the post-toggle selection (AND semantics). We intercept the click
//     and swap in place instead of navigating. Search and subjects COMPOSE, so a
//     swap re-renders both the feed AND the rail (counts, disabled dead-ends,
//     which tags are selected) — that's why every path funnels through swapTo().
//   · Infinite scroll — an IntersectionObserver on #feed-sentinel appends the next
//     page (fetched via X-Requested-With so the server honours ?page) into
//     #feed-list. Re-armed after every swap on the fresh sentinel.
import { MIN_SEARCH } from '../lib/search-highlight';

let io: IntersectionObserver | null = null;
let loadingMore = false;

// Only the newest swap may write the DOM — a fast typist or a tag tapped
// mid-fetch must not let a stale response clobber a newer one.
let swapToken = 0;

// Search state at module scope so the Clear control can reset the baseline in
// lockstep when it empties the field from outside the search closure.
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
    { rootMargin: '600px 0px' }
  );
  io.observe(sentinel);
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
    const res = await fetch(url, { headers: { 'X-Requested-With': 'fetch' } });
    if (!res.ok) throw new Error('bad status');
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const fetchedList = doc.getElementById('feed-list');
    if (fetchedList) for (const node of Array.from(fetchedList.children)) list.append(node.cloneNode(true));
    const next = doc.getElementById('feed-sentinel')?.getAttribute('data-next-url');
    if (next) {
      sentinel.dataset.nextUrl = next;
    } else {
      io?.disconnect();
      sentinel.remove(); // reached the end
    }
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

/**
 * Fetch a /blog URL as a partial and swap the feed AND the subjects rail in
 * place, keeping the search field (which lives outside both) focused. Returns
 * false if the fetch failed, so the caller can fall back to a full navigation.
 */
async function swapTo(target: string): Promise<boolean> {
  const feed = document.getElementById('blog-feed');
  if (!feed) return false;
  const mine = ++swapToken;
  feed.classList.add('list-loading');
  try {
    const res = await fetch(target, { headers: { 'X-Requested-With': 'fetch' } });
    if (!res.ok) throw new Error('bad status');
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const nextFeed = doc.getElementById('blog-feed');
    if (!nextFeed) throw new Error('no feed');
    if (mine !== swapToken) return true; // a newer swap already won — not an error

    feed.innerHTML = nextFeed.innerHTML;

    // Re-render the subjects block so counts, disabled dead-ends, and selection
    // track the new filter. Only its innards are swapped — the search field is
    // untouched, so caret + focus survive. The wrapper element persists, so its
    // is-expanded (mobile "Show all") state carries over; realign the button.
    const rail = document.querySelector('[data-subjects]');
    const nextRail = doc.querySelector('[data-subjects]');
    if (rail && nextRail) {
      rail.innerHTML = nextRail.innerHTML;
      if (rail.classList.contains('is-expanded')) {
        const btn = rail.querySelector('[data-subjects-toggle]');
        if (btn) {
          btn.textContent = 'Show fewer';
          btn.setAttribute('aria-expanded', 'true');
        }
      }
    } else if (rail && !nextRail) {
      rail.remove(); // filtered into a state with no subjects at all
    }

    history.replaceState({}, '', target);
    observeSentinel(); // the swap brought a fresh sentinel (or none)
    return true;
  } catch {
    return false;
  } finally {
    if (mine === swapToken) feed.classList.remove('list-loading');
  }
}

/** Reflect the current search term into the URL and swap. Hard-fallback to a
 *  real form submit if the fetch fails. */
async function runSearch(form: HTMLFormElement): Promise<void> {
  lastEffective = effective();
  const url = new URL(location.href);
  if (lastEffective) url.searchParams.set('q', lastEffective);
  else url.searchParams.delete('q'); // below MIN_SEARCH → omitted (URL stays clean)
  url.searchParams.delete('page'); // a changed query restarts at page 1
  const ok = await swapTo(url.pathname + url.search);
  if (!ok) form.submit();
}

/** Bind the rail search input to a debounced fetch-and-swap of the feed + rail. */
function setupSearch() {
  const form = document.getElementById('blog-filters') as HTMLFormElement | null;
  qInput = (form?.elements.namedItem('q') as HTMLInputElement | null) ?? null;
  if (!form || !qInput) return;
  lastEffective = effective();

  const maybeRun = () => {
    if (effective() !== lastEffective) runSearch(form);
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    runSearch(form);
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

// Subject tags + Clear (delegated, bound once; survives swaps + view-transition
// navigation). The <a> already encodes the resulting URL — server builds the
// toggle — so we just intercept and swap in place instead of navigating.
document.addEventListener('click', (e) => {
  const link = (e.target as Element)?.closest?.('[data-subject-link], [data-subject-clear]') as HTMLAnchorElement | null;
  if (!link) return;
  e.preventDefault();
  const u = new URL(link.href, location.href);
  const target = u.pathname + u.search;
  // Clear empties the search field too — it lives outside the swapped rail, so
  // reset it AND the baseline so retyping the same term still fires a search.
  if (link.matches('[data-subject-clear]') && qInput) {
    qInput.value = '';
    lastEffective = '';
  }
  swapTo(target).then((ok) => {
    if (!ok) location.href = link.href; // fetch failed → let the browser navigate
  });
});

// Manual "Load older" click → load in place instead of navigating.
document.addEventListener('click', (e) => {
  const more = (e.target as Element)?.closest?.('[data-feed-more]');
  if (more) {
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

// The form + feed are swapped on view-transition navigation, so (re)bind against
// the fresh DOM each time. Fires on first load too.
document.addEventListener('astro:page-load', () => {
  setupSearch();
  observeSentinel();
});
