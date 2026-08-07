import { actions } from 'astro:actions';
import { wireFragmentPanel, wireAddMenu, type PanelHandle } from './fragment-panel';
import { formatActionError } from './action-error';
import './subject-filter'; // the fetched partial's <subject-filter> needs the definition
import { starMarkHtml } from '../lib/star-mark';
import { openEditorFor } from './open-editor';
import { onSkyChange } from './sky-changed';
import { notifyFragmentsChanged, onFragmentsChanged } from './fragments-changed';

const browser = document.getElementById('fbrowser') as HTMLDialogElement;
const cid = browser.dataset.constellation!;
// `let`, not `const`: the constellation's name is edited in the form BEHIND
// this drawer, and a chip added live has to match what was just saved rather
// than what the server rendered when the page loaded.
//
// ⚠ COLOUR NO LONGER ARRIVES THIS WAY, and the absence is deliberate
// (docs/plans/16 · Piece 3): the composer stopped asking for a colour, so on
// this page the rendered value can't go stale — it is correct by
// construction. `ccolor` stays a `let` and the guard below stays, because the
// event still carries an optional colour and a future surface may send one.
// If an editing control ever returns to the composer, this is one of three
// places that cached its answer, which is the argument for it not returning.
let cname = browser.dataset.constellationName ?? '';
let ccolor = browser.dataset.constellationColor ?? '';

onSkyChange((c) => {
  if (c.id !== cid) return;
  cname = c.name;
  if (c.color) ccolor = c.color;
  document.getElementById('fb-cname')!.textContent = c.name;
  const desc = document.getElementById('fb-cdesc')!;
  desc.textContent = c.description ?? '';
  desc.title = c.description ?? '';
  desc.hidden = !c.description;
});
const panelHost = document.getElementById('fb-panel')!;
const errBox = document.getElementById('fb-error') as HTMLParagraphElement;
const bulkbar = document.getElementById('fb-bulkbar') as HTMLElement;
const bulkcount = document.getElementById('fb-bulkcount') as HTMLElement;
const placeSelectedBtn = document.getElementById('fb-place-selected') as HTMLButtonElement;

const showError = (m: string) => ((errBox.textContent = m), (errBox.hidden = false));
const clearError = () => (errBox.hidden = true);

let panel: PanelHandle | null = null;
let placedAny = false;

async function place(id: string): Promise<boolean> {
  const fd = new FormData();
  fd.set('constellation_id', cid);
  fd.set('fragment_id', id);
  const { error } = await actions.constellations.place(fd);
  if (error) {
    showError(formatActionError(error));
    return false;
  }
  placedAny = true;
  return true;
}

/** Re-derive the membership cell's names from the chips now in it. The cell
 *  is a button, so its accessible name is an `aria-label` — which means it
 *  does NOT follow the chips we just changed unless something says so, and a
 *  label that still says "in no constellations" over a filled chip is worse
 *  than no label at all. */
function relabelCnCell(row: HTMLElement) {
  const btn = row.querySelector<HTMLElement>('.cn-cell');
  if (!btn) return;
  const names = [...row.querySelectorAll('.cn-cell__chips .admin-chip--in')].map((c) => c.textContent!.trim());
  btn.title = names.join(' · ');
  btn.setAttribute(
    'aria-label',
    names.length ? `In ${names.join(', ')} — change constellations` : 'In no constellations — assign one',
  );
}

/** Flip a row to its placed state in place — no refetch, the sheet stays open. */
function markPlaced(row: HTMLElement) {
  row.classList.add('opacity-45');
  row.classList.remove('hover:bg-base-200/40');
  row.dataset.placed = '';
  const check = row.querySelector<HTMLInputElement>('.row-check');
  if (check) {
    check.checked = false;
    check.disabled = true;
    // The cart is a Set of ids, not a reading of the checkboxes, so
    // disabling one does NOT take it out — and a placed fragment left in the
    // cart would be re-placed on the next bulk press (harmless, `place` is
    // idempotent) and would keep inflating the count (not harmless).
    panel?.deselect(check.value);
  }
  const cell = row.querySelector('[data-act="place"]')?.closest('td');
  if (cell)
    cell.innerHTML = `<span class="font-sans text-[0.65rem] tracking-wide text-primary/70 uppercase">${starMarkHtml()} placed</span>`;

  // Keep the membership column honest without a refetch: drop the "none"
  // chip if this was an orphan, and add this constellation's own chip.
  //
  // It used to find that cell by `td.lg\:table-cell` and build the chip list
  // if it was missing — both of which stopped being true when the column
  // became a control (FragmentRow.astro). The wrapper is now always there,
  // and `.cn-cell__chips` names it rather than describing where it sits.
  const list = row.querySelector('.cn-cell__chips');
  if (list) {
    list.querySelector('.admin-chip--none')?.remove();
    const chip = document.createElement('span');
    chip.className = `admin-chip admin-chip--in max-w-[11rem] truncate${ccolor ? ` cn-${ccolor}` : ''}`;
    chip.innerHTML = starMarkHtml('mr-1');
    chip.append(cname);
    list.appendChild(chip);
    relabelCnCell(row);
  }
  const ids = new Set((row.dataset.constellations || '').split(',').filter(Boolean));
  ids.add(cid);
  row.dataset.constellations = [...ids].join(',');
}

async function loadPanel() {
  const res = await fetch(`/admin/fragments-panel?mode=pick&constellation=${cid}`, {
    headers: { 'X-Requested-With': 'fetch' },
  });
  if (!res.ok) {
    panelHost.innerHTML =
      '<p class="font-sans text-sm text-error">Couldn’t load the fragments — close and try again.</p>';
    return;
  }
  panelHost.innerHTML = await res.text();
  const root = panelHost.querySelector('.fpanel') as HTMLElement;
  panel = wireFragmentPanel(root, {
    extraParams: { mode: 'pick', constellation: cid },
    historyBase: null,
    onOpen(row) {
      clearError();
      openEditorFor(row);
    },
    async onAction(act, id, row) {
      clearError();
      // The membership cell works in here too, and it can tick THIS
      // constellation — the same placement the ＋ beside it makes. Nothing
      // needs to reconcile the two: the sheet announces `fragments:changed`
      // on its way out, this drawer refreshes its rows, and the row comes
      // back from the server already marked placed.
      if (act === 'constellations') return void openEditorFor(row, 'constellations');
      if (act !== 'place') return;
      if (await place(id)) markPlaced(row); // which also takes it out of the cart
    },
    onSelectionChange(ids, shown) {
      // Shows on the CART being non-empty, not on the visible selection —
      // and there is deliberately no `onSwap` hide any more. Hiding the bar
      // on a filter change was belt-and-braces on a loss that no longer
      // happens; keeping it would now hide a cart that still has things in
      // it, which is the confusing half of this feature rather than the
      // useful half.
      bulkbar.hidden = ids.length === 0;
      // "· n shown here" is the honesty mechanism, not decoration: once the
      // cart outlives the filter, the count can exceed what you can see, and
      // a number that doesn't match what's on screen has to be explained or
      // it reads as a bug.
      bulkcount.textContent =
        shown === ids.length ? `${ids.length} selected` : `${ids.length} selected · ${shown} shown here`;
      placeSelectedBtn.textContent = `Place ${ids.length === 1 ? 'it' : `all ${ids.length}`} in constellation`;
    },
  });
}

document.getElementById('fb-clear-selected')?.addEventListener('click', () => panel?.clearSelection());

placeSelectedBtn.addEventListener('click', async () => {
  if (!panel) return;
  const ids = panel.getSelected();
  if (!ids.length) return;
  clearError();
  placeSelectedBtn.disabled = true;
  // Sequential — each placement appends position = max+1, so the cart's
  // insertion order becomes the suite's order. That is why getSelected()
  // returns a Set's iteration order and not a DOM read.
  for (const id of ids) {
    const ok = await place(id);
    if (!ok) break; // the rest stay in the cart, so a failure is retryable
    const row = panel.root.querySelector<HTMLElement>(`tr.fragment-row[data-id="${id}"]`);
    if (row)
      markPlaced(row); // which deselects it
    else panel.deselect(id); // carted under a filter that no longer shows it
  }
  placeSelectedBtn.disabled = false;
});

// --- open / close -----------------------------------------------------------
const setHash = (h: string) => history.replaceState(null, '', location.pathname + location.search + h);

function openBrowser() {
  clearError();
  setHash('#browse');
  browser.showModal();
  if (!panel) void loadPanel();
}
function closeBrowser() {
  setHash('');
  browser.close();
  // The suite underneath is stale the moment something was placed. It used to
  // be a `location.reload()` in this same tick, which cut the drawer's own
  // slide-out short; now the composer refreshes the suite in place and the
  // drawer gets to finish closing.
  if (placedAny) {
    placedAny = false;
    notifyFragmentsChanged(browser);
  }
}

document
  .querySelectorAll<HTMLElement>('[data-browse]')
  .forEach((btn) => btn.addEventListener('click', () => openBrowser()));
browser.querySelector('[data-fb-close]')?.addEventListener('click', () => closeBrowser());
browser.addEventListener('cancel', (e) => {
  e.preventDefault(); // Escape → still refresh the suite if we placed things
  closeBrowser();
});
let pressedOnBackdrop = false;
browser.addEventListener('pointerdown', (e) => (pressedOnBackdrop = e.target === browser));
browser.addEventListener('click', (e) => {
  if (e.target === browser && pressedOnBackdrop) closeBrowser();
});

wireAddMenu(document.getElementById('fb-add-btn')!, document.getElementById('fb-add-menu')!);

// A fragment created from this drawer's own Add ▾, or edited in a sheet on
// top of it, should appear in these rows. Only while the drawer is open —
// refetching a list nobody is looking at is work for nothing, and the load
// on next open is fresh anyway.
onFragmentsChanged(({ settled }) => {
  if (!browser.open) return false; // not handled — let the host underneath answer
  void settled.then(() => panel?.refresh());
  return true;
});

// The #browse hash trick is no longer LOAD-BEARING: the drawer never closes
// for a save any more, so there is no navigation to land back inside. Left in
// place because it still covers a genuine hard refresh (and Back, though
// Piece 3's `no-store` means that is now a real request rather than bfcache).
if (location.hash === '#browse') openBrowser();
