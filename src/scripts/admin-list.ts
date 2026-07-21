// Client logic for the Fragment Manager (src/pages/admin/index.astro):
//  · filter/search/sort WITHOUT a full reload (fetch + swap the table);
//  · whole-row click opens the editor; shift-click range-selects;
//  · bulk + per-row Trash actions (soft-delete → restore/purge), via delegation
//    so handlers survive the table being swapped out.
import { actions } from 'astro:actions';
import { confirmDialog } from './confirm-dialog';
import { MIN_SEARCH } from '../lib/search-highlight';

const filters = document.getElementById('filters') as HTMLFormElement;
const sortInput = document.getElementById('sort-input') as HTMLInputElement;
const typeInput = document.getElementById('type-input') as HTMLInputElement;
const listWrap = document.getElementById('fragment-list') as HTMLElement;
const bulkbar = document.getElementById('bulkbar') as HTMLElement;
const bulkcount = document.getElementById('bulkcount') as HTMLElement;
const bulkError = document.getElementById('bulk-error') as HTMLParagraphElement;
const view = listWrap.dataset.view === 'trash' ? 'trash' : 'list';

const checkList = () => Array.from(listWrap.querySelectorAll<HTMLInputElement>('.row-check'));

// Keep the type-badge counts + trash count fresh after an in-place refresh
// (they live outside the swapped table, so copy them from the fetched page).
function syncCounts(doc: Document) {
  doc.querySelectorAll<HTMLElement>('.type-badge').forEach((src) => {
    const dst = document.querySelector<HTMLElement>(`.type-badge[data-type-filter="${src.dataset.typeFilter ?? ''}"] .type-badge__n`);
    const val = src.querySelector('.type-badge__n')?.textContent;
    if (dst && val != null) dst.textContent = val;
  });
  const tc = document.getElementById('trash-count');
  const tcSrc = doc.getElementById('trash-count');
  if (tc && tcSrc) tc.textContent = tcSrc.textContent;
}

// --- fetch + swap (keeps focus; no navigation) ------------------------------
let fetchToken = 0;
async function applyFilters() {
  const params = new URLSearchParams();
  for (const [k, v] of new FormData(filters) as unknown as Iterable<[string, string]>) if (v) params.set(k, v);
  if (params.get('sort') === 'edited_desc') params.delete('sort'); // keep the default URL clean
  if ((params.get('q')?.trim().length ?? 0) < MIN_SEARCH) params.delete('q'); // ignore too-short terms
  const target = '/admin' + (params.toString() ? `?${params}` : '');
  // remember a focused sort header so keyboard focus survives the swap
  const focusField = (document.activeElement as HTMLElement)?.closest?.('.sort-header')?.getAttribute('data-field');
  const token = ++fetchToken;
  listWrap.classList.add('list-loading');
  try {
    const res = await fetch(target, { headers: { 'X-Requested-With': 'fetch' } });
    if (!res.ok) throw new Error('bad status');
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const next = doc.getElementById('fragment-list');
    if (!next) throw new Error('no list');
    if (token !== fetchToken) return;
    listWrap.innerHTML = next.innerHTML;
    syncCounts(doc);
    history.replaceState({}, '', target);
    lastIndex = -1;
    refreshBulk();
    if (focusField) listWrap.querySelector<HTMLElement>(`.sort-header[data-field="${focusField}"]`)?.focus();
    const emptyTrash = document.getElementById('empty-trash') as HTMLButtonElement | null;
    if (emptyTrash) emptyTrash.disabled = !listWrap.querySelector('.row-check');
  } catch {
    filters.submit();
    return;
  } finally {
    if (token === fetchToken) listWrap.classList.remove('list-loading');
  }
}

filters.addEventListener('submit', (e) => e.preventDefault());
filters.querySelectorAll('select').forEach((s) => s.addEventListener('change', applyFilters));
filters.addEventListener('filter:change', applyFilters); // subject combobox
const qInput = filters.elements.namedItem('q') as HTMLInputElement;
let lastSearch = qInput.value.trim().length >= MIN_SEARCH ? qInput.value.trim() : '';
let searchTimer: number;
qInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    const raw = qInput.value.trim();
    const eff = raw.length >= MIN_SEARCH ? raw : '';
    if (eff === lastSearch) return; // effective query unchanged → skip the fetch
    lastSearch = eff;
    applyFilters();
  }, 300);
});

// --- type badges = filters --------------------------------------------------
const badges = Array.from(document.querySelectorAll<HTMLButtonElement>('.type-badge'));
badges.forEach((b) =>
  b.addEventListener('click', () => {
    typeInput.value = b.dataset.typeFilter || '';
    badges.forEach((x) => {
      const on = x === b;
      x.classList.toggle('is-active', on);
      x.setAttribute('aria-checked', String(on));
    });
    applyFilters();
  }),
);

// --- sort headers (delegated; they live inside the swapped table) -----------
listWrap.addEventListener('click', (e) => {
  const el = e.target as HTMLElement;

  const sortBtn = el.closest<HTMLElement>('.sort-header');
  if (sortBtn) {
    const field = sortBtn.dataset.field!;
    const [curField, curDir] = sortInput.value.split('_');
    const dir = curField === field ? (curDir === 'asc' ? 'desc' : 'asc') : field === 'title' ? 'asc' : 'desc';
    sortInput.value = `${field}_${dir}`;
    applyFilters();
    return;
  }

  const restore = el.closest<HTMLElement>('.restore-btn');
  if (restore) return void trashAction('restore', restore.dataset.id!);
  const purge = el.closest<HTMLElement>('.purge-btn');
  if (purge) return void trashAction('purge', purge.dataset.id!);

  const check = el.closest<HTMLInputElement>('.row-check');
  if (check) return void onCheckClick(e as MouseEvent, check);

  if (el.closest('a')) return; // the title link handles its own navigation
  if (el.closest('#selectall') || el.closest('[data-noedit]')) return;

  const row = el.closest<HTMLElement>('tr.fragment-row');
  if (row) openRow(row, e as MouseEvent);
});

// select-all (change fires once)
listWrap.addEventListener('change', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'selectall') {
    const on = (t as HTMLInputElement).checked;
    checkList().forEach((c) => (c.checked = on));
    refreshBulk();
  }
});

function openRow(row: HTMLElement, e?: MouseEvent) {
  const href = row.dataset.href;
  if (href) {
    if (e && (e.metaKey || e.ctrlKey)) window.open(href, '_blank');
    else window.location.href = href;
    return;
  }
  if (row.dataset.fragment) document.dispatchEvent(new CustomEvent('fragment:edit', { detail: row.dataset.fragment }));
}

// --- selection + shift-range ------------------------------------------------
let lastIndex = -1;
function onCheckClick(e: MouseEvent, check: HTMLInputElement) {
  const boxes = checkList();
  const idx = boxes.indexOf(check);
  if (e.shiftKey && lastIndex !== -1) {
    const [a, b] = [lastIndex, idx].sort((x, y) => x - y);
    for (let i = a; i <= b; i++) boxes[i].checked = check.checked;
  }
  lastIndex = idx;
  refreshBulk();
}
function refreshBulk() {
  const boxes = checkList();
  const selected = boxes.filter((c) => c.checked);
  bulkbar.classList.toggle('is-open', selected.length > 0);
  bulkcount.textContent = `${selected.length} selected`;
  const all = listWrap.querySelector<HTMLInputElement>('#selectall');
  if (all) {
    all.checked = selected.length > 0 && selected.length === boxes.length;
    all.indeterminate = selected.length > 0 && selected.length < boxes.length;
  }
}

// --- bulk actions (floating bar; not swapped) -------------------------------
const bulkBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-bulk]'));
bulkBtns.forEach((btn) =>
  btn.addEventListener('click', async () => {
    const op = btn.dataset.bulk as 'publish' | 'unpublish' | 'trash' | 'restore' | 'purge';
    const ids = checkList().filter((c) => c.checked).map((c) => c.value);
    if (!ids.length) return;
    if ((op === 'trash' || op === 'purge') && !(await confirmBulk(op, ids.length))) return;

    bulkBtns.forEach((b) => (b.disabled = true));
    bulkError.hidden = true;
    const fd = new FormData();
    fd.set('ids', ids.join(','));
    fd.set('op', op);
    const { error } = await actions.fragments.bulk(fd);
    if (error) {
      bulkBtns.forEach((b) => (b.disabled = false));
      bulkError.textContent = error.message;
      bulkError.hidden = false;
      return;
    }
    await applyFilters();
    bulkBtns.forEach((b) => (b.disabled = false));
  }),
);

function confirmBulk(op: 'trash' | 'purge', n: number) {
  const noun = `${n} fragment${n === 1 ? '' : 's'}`;
  return op === 'purge'
    ? confirmDialog({ title: 'Delete forever', message: `Permanently delete ${noun}? This cannot be undone.`, confirmLabel: 'Delete forever', danger: true })
    : confirmDialog({ title: 'Move to trash', message: `Move ${noun} to trash?`, confirmLabel: 'Delete', danger: true });
}

// --- per-row trash actions --------------------------------------------------
async function trashAction(op: 'restore' | 'purge', id: string) {
  if (op === 'purge' && !(await confirmDialog({ title: 'Delete forever', message: 'Permanently delete this fragment? This cannot be undone.', confirmLabel: 'Delete forever', danger: true }))) return;
  const fd = new FormData();
  fd.set('id', id);
  const { error } = await (op === 'restore' ? actions.fragments.restore(fd) : actions.fragments.purge(fd));
  if (error) {
    bulkError.textContent = error.message;
    bulkError.hidden = false;
    return;
  }
  await applyFilters();
}

// --- empty trash ------------------------------------------------------------
document.getElementById('empty-trash')?.addEventListener('click', async () => {
  if (!(await confirmDialog({ title: 'Empty trash', message: 'Permanently delete everything in trash? This cannot be undone.', confirmLabel: 'Empty trash', danger: true }))) return;
  const { error } = await actions.fragments.emptyTrash(new FormData());
  if (error) {
    bulkError.textContent = error.message;
    bulkError.hidden = false;
    return;
  }
  await applyFilters();
});

// --- Add ▾ menu -------------------------------------------------------------
const addBtn = document.getElementById('add-btn');
const addMenu = document.getElementById('add-menu');
if (addBtn && addMenu) {
  const items = () => Array.from(addMenu.querySelectorAll<HTMLElement>('.add-item'));
  const openMenu = () => {
    addMenu.hidden = false;
    addBtn.setAttribute('aria-expanded', 'true');
    items()[0]?.focus();
  };
  const closeMenu = (focusBtn = false) => {
    addMenu.hidden = true;
    addBtn.setAttribute('aria-expanded', 'false');
    if (focusBtn) addBtn.focus();
  };
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    addMenu.hidden ? openMenu() : closeMenu();
  });
  document.addEventListener('click', (e) => {
    if (!addMenu.hidden && !addMenu.contains(e.target as Node) && e.target !== addBtn) closeMenu();
  });
  addMenu.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[Math.min(i + 1, list.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[Math.max(i - 1, 0)]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    }
  });
  // the quote/song items are [data-new]; FragmentSheet opens them, then we close
  addMenu.querySelectorAll('[data-new]').forEach((el) => el.addEventListener('click', () => closeMenu()));
}
