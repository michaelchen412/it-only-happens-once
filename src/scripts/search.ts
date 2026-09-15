/*
  search — the Observatory's ⌕ (docs/search.md §8).

  Opens on either header-strip trigger or on ⌘K, fetches `/admin/search-panel`
  on a debounce, and swaps the list in. Same shape as `fragment-panel.ts`: one
  fetch, one swap, one gate.

  ⚠ MOUNTED FROM `AdminLayout`, LIKE THE ✚, because a search over the whole
  building belongs to the building rather than to a room (10-hq §10c). A room
  that had to opt in would be the room that forgot.
*/
import { MIN_SEARCH } from '../lib/search-highlight';
import { closeWithExit, openDialog } from './dialog-close';
import { wireSheetDismiss } from './sheet-dismiss';
import { unlockScroll } from './scroll-lock';

const PARTIAL = '/admin/search-panel';

const sheet = document.getElementById('search-sheet') as HTMLDialogElement | null;
const input = document.querySelector<HTMLInputElement>('[data-search-input]');
const results = document.querySelector<HTMLElement>('[data-search-results]');

/* ── the fetch ──────────────────────────────────────────────────────────── */

/**
 * ⚠ THE TOKEN GUARD, WHICH IS NOT OPTIONAL HERE. Twelve queries stand behind
 * every request, so responses genuinely can land out of order — a short broad
 * term fired first can return AFTER the longer one that replaced it, leaving
 * results for a word you had already finished deleting. `blog-feed.ts` carries
 * the same guard for the same reason.
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
    // A dead network leaves the previous list standing rather than blanking it
    // — the same thing the Fragment Manager does, and for the same reason: the
    // last good answer is more use than an empty box.
  }
}

/* ── the gate, and the debounce ─────────────────────────────────────────── */

/* The comparison every shipped client makes (docs/search.md §3): below
   MIN_SEARCH the term is dropped entirely, so typing or clearing a single
   letter costs no request at all. One constant, four enforcement sites. */
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

/* ── opening and closing ────────────────────────────────────────────────── */

function open() {
  if (!sheet) return;
  openDialog(sheet);
  // Caret to the end, not to 0 — reopening onto a live term must not make you
  // retype it.
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

/**
 * ⚠ `closeWithExit`, NEVER `sheet.close()` — and a unit test enforces it.
 * `close()` drops a dialog out of the top layer in the same frame, and the
 * `overlay` property that would defer that is Chromium-only; on every iOS
 * browser the 0.28s slide would never render at all. The helper keeps the sheet
 * genuinely open for the length of its transition instead.
 *
 * ⚠ Dismissing costs NOTHING here, which is the answer ADR 0032 demands of every
 * sheet: this surface holds nothing unsaved — the results are a cache of a
 * query. So there is no guard, and closing is unconditional.
 */
async function close() {
  if (sheet?.open) await closeWithExit(sheet);
}

if (sheet) {
  /* ⚠ THE `close` EVENT RATHER THAN OUR OWN EXIT PATH, for the reason
     dialog-close.ts writes out at length: Chromium's close watcher can shut a
     dialog past every handler we installed, and a lock released only on our own
     path leaks — leaving a page that will not scroll and no dialog to close. */
  sheet.addEventListener('close', () => unlockScroll(sheet));
  /* All three ways out through one call (ADR 0032): the ✕, Escape, and a press
     on the backdrop. ⚠ Escape has to be INTERCEPTED rather than observed, which
     is the half a hand-rolled listener always misses — `wireSheetDismiss` owns
     it. */
  wireSheetDismiss(sheet, close);
}

document.querySelectorAll('[data-search-open]').forEach((b) => b.addEventListener('click', open));

/*
  ⚠ ESCAPE HAS TO BE TAKEN OFF THE FIELD, AND `capture.ts` ALREADY HIT THIS WITH
  A DIFFERENT SWALLOWER. Its comment: *"A `<dialog>` turns Escape into a close
  request only if the keydown's default survives"* — there ProseMirror
  preventDefaults keyCode 27; here it is the browser itself. Chromium's
  `<input type="search">` treats the first Escape as CLEAR THE FIELD and stops
  there, so `cancel` never fires on the dialog.

  That is invisible until you use it the way a person does. The ✕ worked, the
  backdrop worked, and Escape worked whenever focus happened to be anywhere else
  — but `open()` focuses this field, so in real use the FIRST Escape did nothing
  at all.

  ⚠ ESCAPE CLOSES RATHER THAN CLEARING, EVEN WITH A TERM IN THE BOX. Spotlight
  clears first and closes on the second press; ADR 0032 says Escape is one of the
  three ways out of a sheet, and this sheet's answer to *what does dismissing
  cost* is "nothing". One key, one meaning.

  `preventDefault` for `capture.ts`'s stated reason as well: it keeps the two
  paths mutually exclusive, so the native `cancel` does not run a second close on
  top of this one.
*/
input?.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  void close();
});

/*
  ⌘K / Ctrl-K. ⚠ The shortcut is the DESKTOP affordance's other half, not its
  replacement: a 20px glyph cannot carry a hint, so the sidebar trigger's
  `title` says so and this makes it true. A phone has neither, which is why the
  top bar's ⌕ is the one that must always be visible.
*/
addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k' || e.altKey) return;
  e.preventDefault();
  sheet?.open ? void close() : open();
});
