/*
  site-search — the public ⌕'s wiring (docs/search.md §9).

  Opens from either trigger or ⌘K, fetches `/search-panel` on a debounce, swaps
  the list in. Same shape as `scripts/search.ts` on the Observatory side; the
  three places they differ are marked ⚠ DIFFERENCE below, and all three come
  from the same root — a reader is not Michael and a public page is not an admin
  one.

  ⚠ MOUNTED FROM `SiteLayout`, so every public room has it. Searching is not
  something a particular page owns.
*/
import { MIN_SEARCH } from '../lib/search-highlight';
import { closeWithExit, openDialog } from './dialog-close';
import { wireSheetDismiss } from './sheet-dismiss';
import { unlockScroll } from './scroll-lock';

const PARTIAL = '/search-panel';

/**
 * ⚠ DIFFERENCE 1 — THE PUBLIC SITE USES `<ClientRouter />`, SO EVERYTHING HERE
 * RE-BINDS PER PAGE. A navigation swaps the whole body, taking the dialog, the
 * triggers and every listener attached to them with it — so a module that wired
 * itself once on first load would work exactly until the reader clicked
 * anything. `nav-progress.ts` counts ~250 element-bound listener sites in the
 * Observatory that need none of this, because every navigation there is a full
 * document load; out here `astro:page-load` is the whole contract.
 *
 * ⚠ The two WINDOW-level listeners are deliberately outside this. They are bound
 * to `window`, which survives a swap, so re-binding them per page would stack a
 * fresh copy on every navigation — the leak `focus-mode.ts` documents.
 */
function wire() {
  const sheet = document.getElementById('site-search') as HTMLDialogElement | null;
  const input = document.querySelector<HTMLInputElement>('[data-ss-input]');
  const results = document.querySelector<HTMLElement>('[data-ss-results]');
  if (!sheet) return;

  /**
   * ⚠ THE TOKEN GUARD. Seven queries stand behind every request, so responses
   * can land out of order — a short broad term fired first can return AFTER the
   * longer one that replaced it, leaving results for a word already deleted.
   * `blog-feed.ts` carries the same guard for the same reason.
   */
  let token = 0;

  async function run(term: string) {
    if (!results) return;
    const mine = ++token;
    try {
      const res = await fetch(`${PARTIAL}?q=${encodeURIComponent(term)}`, {
        headers: { 'X-Requested-With': 'fetch' },
      });
      if (!res.ok || mine !== token) return;
      const html = await res.text();
      if (mine !== token) return; // a newer keystroke won while we awaited the body
      results.innerHTML = html;
    } catch {
      // A dead network leaves the previous list standing rather than blanking
      // it — the last good answer is more use than an empty box.
    }
  }

  /* The comparison every shipped client makes (docs/search.md §3): below
     MIN_SEARCH the term is dropped entirely, so typing or clearing a single
     letter costs no request at all. One constant, every enforcement site. */
  const effective = (raw: string) => (raw.trim().length >= MIN_SEARCH ? raw.trim() : '');

  let last: string | null = null;
  let timer = 0;

  input?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const next = effective(input.value);
      if (next === last) return; // nothing the server would do differently
      last = next;
      run(next);
    }, 260);
  });

  const open = () => {
    openDialog(sheet);
    input?.focus();
    // Caret to the end — reopening onto a live term must not make you retype it.
    input?.setSelectionRange(input.value.length, input.value.length);
  };

  /**
   * ⚠ `closeWithExit`, NEVER `sheet.close()` — a unit test enforces it.
   * `close()` drops a dialog out of the top layer in the same frame, and the
   * `overlay` property that would defer it is Chromium-only, so on every iOS
   * browser the slide would never render. Dismissing costs nothing here — the
   * results are a cache of a query — so there is no guard.
   */
  const close = async () => {
    if (sheet.open) await closeWithExit(sheet);
  };

  /* The `close` event rather than our own exit path: Chromium's close watcher
     can shut a dialog past every handler we installed, and a lock released only
     on our own path leaks a page that will not scroll. */
  sheet.addEventListener('close', () => unlockScroll(sheet));
  /* All three ways out through one call (ADR 0032). ⚠ Escape has to be
     INTERCEPTED rather than observed — `wireSheetDismiss` owns that. */
  wireSheetDismiss(sheet, close);

  /*
    ⚠ DIFFERENCE 2 — THE TRIGGER IS A LINK, SO THE HANDLER MUST CLAIM THE CLICK.
    The public side does not assume JavaScript the way the Observatory does:
    `/blog`'s rail is a real `<form method="get">` precisely so search survives
    without it. So each trigger is an `<a href="/blog#blog-filters">` that we
    upgrade — a reader without JS follows it to the field that already works.

    ⚠ MODIFIED CLICKS ARE LEFT ALONE. ⌘-click, middle-click and the rest must
    keep opening the fallback in a new tab; claiming those would make a real
    href behave like a button, which is the worst of both.
  */
  document.querySelectorAll<HTMLAnchorElement>('[data-site-search]').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      open();
    });
  });

  /*
    ⚠ ESCAPE HAS TO BE TAKEN OFF THE FIELD. Chromium's `<input type="search">`
    treats the first Escape as CLEAR THE FIELD and stops there, so `cancel` never
    fires on the dialog — and since `open()` focuses this field, the FIRST Escape
    would do nothing at all. `capture.ts` hit the same wall with a different
    swallower (ProseMirror preventDefaults keyCode 27); this is its fix.
    `preventDefault` keeps the two paths mutually exclusive.
  */
  input?.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    void close();
  });

  // Handed to the window-level shortcut below, which outlives this page.
  live = { open, close, sheet };
}

/** The current page's handles, replaced on every `astro:page-load`. */
let live: { open: () => void; close: () => Promise<void>; sheet: HTMLDialogElement } | null = null;

/*
  ⚠ DIFFERENCE 3 — ⌘K IS A CONVENIENCE HERE, NOT AN AFFORDANCE. In the
  Observatory it is half the desktop answer, because Michael knows it is there. A
  reader does not, which is exactly why the ⌕ is visible at BOTH breakpoints and
  why nothing on this site advertises the shortcut. It is bound once, to the
  window, and reads through `live` so it always drives the current page's dialog.
*/
addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k' || e.altKey) return;
  if (!live) return;
  e.preventDefault();
  live.sheet.open ? void live.close() : live.open();
});

document.addEventListener('astro:page-load', wire);
