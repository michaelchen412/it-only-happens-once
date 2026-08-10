import { actions } from 'astro:actions';
import { confirmDialog } from './confirm-dialog';
import { callAction, formatActionError } from './action-error';
import { suiteHints } from '../lib/suite-shape';
// ⚠ THE LIST, NOT A SIXTH COPY OF IT (plans/29 · §3, which counted four and
// missed this one and the composer page's). Iterating `FRAGMENT_TYPES` also
// retires the `as FragmentType` this loop used to need — the cast existed only
// because the local array was typed `string`.
import { FRAGMENT_TYPES, typeCountLabel } from '../lib/fragments-display';
import { announceSkyChange } from './sky-changed';
import { onFragmentsChanged } from './fragments-changed';
import { wireListReorder } from './list-reorder';

const root = document.getElementById('ccomposer')!;
const cid = root.dataset.id!;
// anything the editor sheets save on this page joins this suite
document.body.dataset.placeIn = cid;

const errBox = document.getElementById('cc-error') as HTMLParagraphElement;
const show = (m: string) => ((errBox.textContent = m), (errBox.hidden = false));

/**
 * ⚠ `astro:actions` THROWS on a dead network instead of returning `{ error }`.
 * The safe-call form catches what the SERVER answers; a fetch that never
 * reaches a server rejects, and the rejection walks straight out of the click
 * handler. Nothing is caught, nothing is said, and the button looks like it
 * did nothing — which is the worst possible reading of "you are offline".
 *
 * This is the same defect the HQ save paths shipped with (fixed 2026-08-04),
 * arrived at from the other direction: there the catch existed and tested
 * `err instanceof Error`, here there is no catch at all. `formatActionError`
 * already knows how to say both, so everything on this page goes through here.
 *
 * Found by a spec, not by use — offline is never the state you are testing in.
 */
const call = callAction; // it moved to action-error.ts — /admin/constellations needs it too

// ── the constellation form: save is armed only by an actual edit ───
const form = document.getElementById('cc-form') as HTMLFormElement;
const saveBtn = document.getElementById('cc-save') as HTMLButtonElement;
const savedFlash = document.getElementById('cc-saved')!;
let dirty = false;
const setDirty = () => {
  dirty = true;
  saveBtn.disabled = false;
  savedFlash.hidden = true;
};
form.addEventListener('input', setDirty);
form.addEventListener('change', setDirty);
window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    // `preventDefault()` alone triggers the prompt; the legacy `returnValue`
    // spelling (Chrome/Edge < 119) is deprecated. See writing-sheet.ts.
    e.preventDefault();
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  saveBtn.disabled = true;
  const { data, error } = await call(actions.constellations.save(new FormData(form)));
  if (error) {
    saveBtn.disabled = false;
    return show(formatActionError(error));
  }
  errBox.hidden = true;
  dirty = false;
  if (data?.slug) {
    root.dataset.slug = data.slug;
    (document.getElementById('cc-slug') as HTMLInputElement).value = data.slug;
    (document.getElementById('cc-preview') as HTMLAnchorElement).href = `/${data.slug}`;
  }
  // The Add drawer's header says "Add to <name>" and its live-added chips
  // wear this colour — both were captured when the page rendered, so
  // renaming or recolouring here left the drawer describing a constellation
  // that no longer exists under that name until a reload.
  announceSkyChange({
    id: cid,
    name: (form.elements.namedItem('name') as HTMLInputElement).value.trim(),
    slug: data?.slug ?? root.dataset.slug!,
    // No `color` — this form stopped asking for one (docs/plans/16 · Piece 3),
    // so it has nothing to announce about it. `SkyConstellation.color` is
    // optional precisely for this: listeners repaint colour only when told.
    description: (form.elements.namedItem('description') as HTMLTextAreaElement).value.trim() || null,
  });
  savedFlash.hidden = false;
  setTimeout(() => (savedFlash.hidden = true), 1600);
});

document.getElementById('cc-delete')?.addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Delete constellation',
    message: 'Delete this constellation? Its composition is lost; the fragments themselves are untouched.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const fd = new FormData();
  fd.set('id', cid);
  const { error } = await call(actions.constellations.remove(fd));
  if (error) return show(formatActionError(error));
  dirty = false; // don't fight the unload guard on the way out
  location.href = '/admin/constellations';
});

// ── the suite: reorder / unplace / open ────────────────────────────
// Every one of these containers is now rendered unconditionally (see the
// markup above), so none of them can be null and none of them is ever
// REPLACED — only its contents are. Element identity is what keeps the
// delegated click / keydown / drag listeners below alive across a refresh.
const rows = document.getElementById('suite-rows')!;
const readList = document.getElementById('suite-read-list')!;
const emptyBlock = document.getElementById('suite-empty')!;
const viewSeg = document.getElementById('suite-viewseg')!;
const statsBar = document.getElementById('suite-stats')!;
const spreadStat = document.getElementById('suite-spread')!;
const placedStat = document.getElementById('suite-placed')!;
const hintLine = document.getElementById('suite-hints')!;

const suiteRows = () => [...rows.querySelectorAll<HTMLElement>('li[data-fid]')];

async function persistOrder() {
  const ids = suiteRows()
    .map((l) => l.dataset.fid)
    .join(',');
  if (!ids) return;
  const fd = new FormData();
  fd.set('constellation_id', cid);
  fd.set('fragment_ids', ids);
  const { error } = await call(actions.constellations.reorderPlacements(fd));
  if (error) show(formatActionError(error));
  else syncOrder();
}

/** Carry a reorder across to the Read view and renumber both — otherwise
 *  switching views after a drag would show yesterday's sequence. */
function syncOrder() {
  // re-appending each stanza in composed order re-sorts the list in place
  for (const li of suiteRows()) {
    const stanza = readList.querySelector(`[data-fid="${CSS.escape(li.dataset.fid!)}"]`);
    if (stanza) readList.appendChild(stanza);
  }
  for (const el of [rows, readList]) {
    el.querySelectorAll<HTMLElement>('[data-num]').forEach((n, i) => (n.textContent = String(i + 1)));
  }
}

/**
 * Re-read the suite's shape from the DOM and repaint the badges, the hint
 * line and the empty state.
 *
 * The DOM is the source of truth here rather than the server, and that is a
 * deliberate trade: an unplace changes nothing the client can't already see
 * — a row leaves, the remaining rows are untouched — so asking the server to
 * re-render the page to learn that five became four is the whole cost this
 * piece exists to remove. Each row carries its own `data-type` and
 * `data-subjects` precisely so this arithmetic is possible without a round
 * trip. (Piece 5's refresh re-syncs from the server anyway, so a drift can't
 * outlive the next add.)
 */
function refreshSuiteStats() {
  const items = suiteRows();
  const placed = items.length;

  const mix: Record<string, number> = { writing: 0, quote: 0, song: 0 };
  const subjects = new Set<string>();
  for (const li of items) {
    mix[li.dataset.type ?? ''] = (mix[li.dataset.type ?? ''] ?? 0) + 1;
    for (const s of (li.dataset.subjects ?? '').split('|').filter(Boolean)) subjects.add(s);
  }

  for (const t of FRAGMENT_TYPES) {
    const badge = statsBar.querySelector<HTMLElement>(`[data-type-count="${t}"]`);
    if (!badge) continue;
    badge.querySelector('.admin-stat__n')!.textContent = String(mix[t]);
    badge.querySelector('.admin-stat__label')!.textContent = typeCountLabel(t, mix[t]);
    badge.classList.toggle('opacity-50', mix[t] === 0);
  }

  spreadStat.querySelector('.admin-stat__n')!.textContent = String(subjects.size);
  spreadStat.querySelector('.admin-stat__label')!.textContent = subjects.size === 1 ? 'subject' : 'subjects';
  placedStat.querySelector('.admin-stat__n')!.textContent = String(placed);

  const { size, spread } = suiteHints(placed, subjects.size);
  spreadStat.title = spread;
  placedStat.title = size;
  hintLine.textContent = [size, spread].filter(Boolean).join(' · ');
  hintLine.hidden = !(size || spread);

  // An empty suite has no sequence to look at, so the Compose/Read toggle
  // goes with it rather than sitting there offering two views of nothing.
  emptyBlock.hidden = placed > 0;
  viewSeg.hidden = placed === 0;
  paintView();
}

rows.addEventListener('click', async (e) => {
  const li = (e.target as Element).closest('li[data-fid]') as HTMLElement | null;
  if (!li) return;
  const btn = (e.target as Element).closest('button');

  // (the ↑/↓ nudges are handled by wireListReorder below, with drag and Alt+↑/↓)
  if (btn?.hasAttribute('data-unplace')) {
    // ── the ✕ removes a row, and NOTHING ELSE ────────────────────────
    // It unplaces; it never deletes. The fragment keeps existing, keeps its
    // other constellations, and can be re-added from Add. That is why there
    // is no undo here and no confirm: nothing is lost to undo, and a confirm
    // on a reversible act just makes removing five things cost ten clicks.
    // (An undo was considered and rejected — "an edge case solution, it
    // doesn't really help me do anything but adds complexity". It would also
    // have had to lie: re-placing appends to the END, so an honest undo would
    // need to restore the position too, for a gesture nobody wanted.)
    //
    // The row leaves the DOM rather than the page reloading, because an
    // unplace needs no new markup from the server — a row goes, the rest are
    // unchanged. The reload it replaces re-ran seven queries (the biggest of
    // them pulling every placed fragment's full body), re-rendered both views
    // and every Reader template, and threw away your scroll position. Five
    // removals meant five of those.
    //
    // We AWAIT the action before touching the DOM instead of removing
    // optimistically: it is a single DELETE, so the wait is imperceptible,
    // and it keeps the failure honest — if the server refuses, the row is
    // still there and #cc-error says why, rather than a row vanishing from a
    // suite it is still in.
    const fd = new FormData();
    fd.set('constellation_id', cid);
    fd.set('fragment_id', li.dataset.fid!);
    const { error } = await call(actions.constellations.unplace(fd));
    if (error) return show(formatActionError(error));

    // Where the keyboard goes next. Without this, focus falls to <body> and
    // removing a run of rows means re-finding your place after every one —
    // the same care the nudge buttons already take.
    const siblings = suiteRows();
    const at = siblings.indexOf(li);
    const nextFocus =
      (siblings[at + 1] ?? siblings[at - 1])?.querySelector<HTMLElement>('[data-unplace]') ??
      document.querySelector<HTMLElement>('[data-browse]');

    li.remove();
    readList.querySelector(`[data-fid="${CSS.escape(li.dataset.fid!)}"]`)?.remove();
    // The removed writing's <template data-reader-content> stays in the DOM.
    // It is inert — the Reader only looks a slug up when something clicks a
    // [data-read] link, and the stanza that held one is gone. Removing it
    // would mean threading the slug onto the row for no behavioural gain.
    syncOrder();
    refreshSuiteStats();
    nextFocus?.focus();
    return;
  }
  if (btn?.hasAttribute('data-open')) {
    if (li.dataset.writing)
      return void document.dispatchEvent(new CustomEvent('writing:edit', { detail: li.dataset.writing }));
    if (li.dataset.fragment) document.dispatchEvent(new CustomEvent('fragment:edit', { detail: li.dataset.fragment }));
  }
});

// ── refreshing the suite without a navigation ──────────────────────────
// An unplace can be done purely in the DOM (a row leaves, nothing else
// changes). Everything else — placing from the browser, saving a fragment in
// a sheet, trashing one — ADDS or CHANGES content, so it needs markup this
// page doesn't have. This is how it gets that markup without a navigation.
//
// ⚠ SWAP `innerHTML`, NEVER THE ELEMENTS THEMSELVES. Every listener above is
// delegated onto the captured `rows` / `readList` / `readPanel` elements.
// Replacing a node with the fetched one would look completely correct and
// would silently kill drag-to-reorder, Alt+↑/↓, the ✕ and row-opening — the
// kind of breakage that gets reported later as "reordering stopped working,
// unrelated". Keeping element identity keeps every listener.
//
// It costs the same server work as the reload it replaces. What it buys is
// everything the reload threw away: scroll position, the Compose/Read mode,
// unsaved edits in the constellation form above, and any dialog still open. A
// dedicated partial route would trim the payload and can be added later if it
// ever matters; for a single-user workshop it plainly doesn't yet.
async function refreshSuite(settled: Promise<void>) {
  // The fetch starts NOW — the network is off the main thread, so there is
  // nothing to gain by making the sheet's exit animation wait for it.
  const res = await fetch(location.href, { headers: { 'X-Requested-With': 'fetch' } });
  if (!res.ok) return; // leave what's on screen; the next action can try again
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');

  // …and the SWAP waits for the dialog to finish closing. A page-sized
  // innerHTML replacement landing mid-slide janks the exit animation Piece 6
  // exists to recover. `settled` carries its own timeout, so a transitionend
  // that never arrives can't strand this refresh forever.
  await settled;

  const freshRows = doc.getElementById('suite-rows');
  const freshRead = doc.getElementById('suite-read-list');
  if (!freshRows || !freshRead) return;
  rows.innerHTML = freshRows.innerHTML;
  readList.innerHTML = freshRead.innerHTML;

  // Take the server's colour class outright. An earlier draft of this had to
  // guard against clobbering an unsaved colour preview — but the composer
  // form saves before anything gets here, so the server's value is the
  // authoritative one and a plain copy is correct.
  const freshPanel = doc.getElementById('suite-read');
  if (freshPanel) readPanel.className = freshPanel.className;

  // Reader templates for writings that have just joined the suite. Appended
  // rather than replaced: the templates for pieces still on the page are
  // identical, and a <template> the Reader may be mid-lookup on is not worth
  // swapping for a copy of itself.
  for (const tpl of doc.querySelectorAll<HTMLTemplateElement>('template[data-reader-content]')) {
    const slug = tpl.dataset.readerContent!;
    if (!document.querySelector(`template[data-reader-content="${CSS.escape(slug)}"]`)) {
      document.body.appendChild(tpl.cloneNode(true));
    }
  }

  refreshSuiteStats();
}

onFragmentsChanged(({ settled }) => {
  void refreshSuite(settled);
  return true;
});

// Drag, Alt+↑/↓ and the touch nudges — all three now live in one module
// (docs/plans/16 · Piece 3), because /admin/constellations needed the same
// thing and had none of it. This page is where the behaviour was invented;
// it is now its first CONSUMER rather than its owner.
wireListReorder(rows, { rowSelector: 'li[data-fid]', onCommit: persistOrder });

// ── Compose ⇄ Read ─────────────────────────────────────────────────
// Two ways of looking at one suite: the dense rows to build it, the real
// stanzas to judge it. The choice sticks, because it's a mode you're in.
const readPanel = document.getElementById('suite-read')!;
const viewBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-view]')];
const VIEW_KEY = 'cc-suite-view';
let view = 'compose';

/** Show whichever view is current — and NEITHER when the suite is empty, so
 *  the empty state isn't sharing the page with an empty list. Split out from
 *  setView so refreshSuiteStats can repaint without re-persisting the mode. */
function paintView() {
  const empty = suiteRows().length === 0;
  rows.hidden = empty || view === 'read';
  readPanel.hidden = empty || view !== 'read';
  for (const b of viewBtns) {
    const on = b.dataset.view === view;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

function setView(v: string, persist = true) {
  view = v;
  paintView();
  if (persist)
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
}
for (const b of viewBtns) b.addEventListener('click', () => setView(b.dataset.view!));
try {
  if (localStorage.getItem(VIEW_KEY) === 'read') setView('read', false);
} catch {}

// The pencil in the stanza's margin — writing still READS on click (the
// Reader owns `data-read`), so editing needs its own target.
readPanel.addEventListener('click', (e) => {
  if (!(e.target as Element).closest('button[data-open]')) return;
  const art = (e.target as Element).closest('[data-fid]') as HTMLElement | null;
  if (art?.dataset.writing)
    return void document.dispatchEvent(new CustomEvent('writing:edit', { detail: art.dataset.writing }));
  if (art?.dataset.fragment) document.dispatchEvent(new CustomEvent('fragment:edit', { detail: art.dataset.fragment }));
});
