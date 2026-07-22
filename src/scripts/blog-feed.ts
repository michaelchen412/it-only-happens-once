// Client behaviour for the blog feed (/blog): live search + infinite scroll.
// Both operate on #blog-feed and are coordinated here so they never fight:
//
//   · Search  — a debounced fetch-and-swap of #blog-feed (input lives in the rail,
//     outside the swap, so it keeps focus). Mirrors the admin + docs/search.md:
//     MIN_SEARCH gating, effective-query comparison, URL hygiene, clear reverts.
//     After a swap it re-arms the infinite-scroll observer on the fresh sentinel.
//   · Infinite scroll — an IntersectionObserver on #feed-sentinel appends the next
//     page (fetched via X-Requested-With, so the server honours ?page) into
//     #feed-list. The sentinel carries data-next-url; the manual "Load older" link
//     inside it is the no-JS fallback and also works as a click-to-load.
import { MIN_SEARCH } from '../lib/search-highlight';

let io: IntersectionObserver | null = null;
let loadingMore = false;

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

/** Bind the rail search input to a debounced fetch-and-swap of the feed. */
function setupSearch() {
  const form = document.getElementById('blog-filters') as HTMLFormElement | null;
  const feed = document.getElementById('blog-feed');
  const qInput = form?.elements.namedItem('q') as HTMLInputElement | null;
  if (!form || !feed || !qInput) return;

  const effective = () => {
    const raw = qInput.value.trim();
    return raw.length >= MIN_SEARCH ? raw : '';
  };
  let lastSearch = effective();
  let timer: number;
  let token = 0;

  async function apply() {
    const params = new URLSearchParams();
    const currentView = (form!.elements.namedItem('view') as HTMLInputElement | null)?.value.trim();
    if (currentView) params.set('view', currentView); // keep Quotes/Songs on their own view
    const subject = (form!.elements.namedItem('subject') as HTMLInputElement | null)?.value.trim();
    if (subject) params.set('subject', subject);
    const eff = effective();
    if (eff) params.set('q', eff); // below MIN_SEARCH → omitted (URL stays clean)
    const target = '/blog' + (params.toString() ? `?${params}` : '');

    const mine = ++token;
    feed!.classList.add('list-loading');
    try {
      const res = await fetch(target, { headers: { 'X-Requested-With': 'fetch' } });
      if (!res.ok) throw new Error('bad status');
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const next = doc.getElementById('blog-feed');
      if (!next) throw new Error('no feed');
      if (mine !== token) return; // a newer keystroke already won
      feed!.innerHTML = next.innerHTML;
      history.replaceState({}, '', target);
      observeSentinel(); // the swap brought a fresh sentinel (or none)
    } catch {
      form!.submit(); // hard fallback: let the form navigate
      return;
    } finally {
      if (mine === token) feed!.classList.remove('list-loading');
    }
  }

  function maybeApply() {
    const eff = effective();
    if (eff === lastSearch) return; // effective query unchanged → skip
    lastSearch = eff;
    apply();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    lastSearch = effective();
    apply();
  });
  qInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(maybeApply, 250);
  });
  qInput.addEventListener('search', () => {
    // Native clear (✕) / Enter in a type=search field.
    clearTimeout(timer);
    maybeApply();
  });
}

// Manual "Load older" click → load in place instead of navigating (delegated,
// bound once; survives feed swaps and view-transition navigation).
document.addEventListener('click', (e) => {
  const more = (e.target as Element)?.closest?.('[data-feed-more]');
  if (more) {
    e.preventDefault();
    loadMore();
  }
});

// Subjects rail (mobile): reveal the long tail behind "Show all" / "Show fewer".
// The rail lives outside #blog-feed, so this is delegated on document (survives
// search swaps and view-transition navigation) rather than bound per-render.
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
