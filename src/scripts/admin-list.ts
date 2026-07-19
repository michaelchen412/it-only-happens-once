// Client logic for the fragment list (src/pages/admin/index.astro):
//  · filter/search WITHOUT a full-page reload (fetch + swap the list region),
//    so the search box keeps focus as you type;
//  · selection + bulk actions via event delegation, so handlers survive the
//    list being swapped out;
//  · a floating bulk bar and the shared confirm dialog for destructive ops.
import { actions } from 'astro:actions';
import { confirmDialog } from './confirm-dialog';

const filters = document.getElementById('filters') as HTMLFormElement;
const listWrap = document.getElementById('fragment-list') as HTMLElement;
const countEl = document.getElementById('fragment-count');
const bulkbar = document.getElementById('bulkbar') as HTMLElement;
const bulkcount = document.getElementById('bulkcount') as HTMLElement;
const bulkError = document.getElementById('bulk-error') as HTMLParagraphElement;
const bulkBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-bulk]'));

// --- client-side filtering (no full nav → no focus steal) -------------------
let fetchToken = 0;

async function applyFilters() {
  const params = new URLSearchParams();
  for (const [k, v] of new FormData(filters) as unknown as Iterable<[string, string]>) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  const target = '/admin' + (qs ? `?${qs}` : '');

  const token = ++fetchToken;
  listWrap.classList.add('list-loading');
  try {
    const res = await fetch(target, { headers: { 'X-Requested-With': 'fetch' } });
    if (!res.ok) throw new Error('bad status');
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const newList = doc.getElementById('fragment-list');
    if (!newList) throw new Error('no list'); // e.g. session redirect → full nav
    if (token !== fetchToken) return; // a newer request superseded this one
    listWrap.innerHTML = newList.innerHTML;
    if (countEl) countEl.textContent = doc.getElementById('fragment-count')?.textContent ?? countEl.textContent;
    history.replaceState({}, '', target);
    refreshBulk();
  } catch {
    filters.submit(); // graceful fallback to a real navigation
    return;
  } finally {
    if (token === fetchToken) listWrap.classList.remove('list-loading');
  }
}

filters.addEventListener('submit', (e) => e.preventDefault());
filters.querySelectorAll('select').forEach((s) => s.addEventListener('change', applyFilters));
let searchTimer: number;
(filters.elements.namedItem('q') as HTMLInputElement).addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(applyFilters, 300);
});

// --- selection + bulk (delegated on the swappable list region) --------------
const checks = () => Array.from(listWrap.querySelectorAll<HTMLInputElement>('.row-check'));

function refreshBulk() {
  const selected = checks().filter((c) => c.checked);
  bulkbar.classList.toggle('is-open', selected.length > 0);
  bulkcount.textContent = `${selected.length} selected`;
  const all = listWrap.querySelector<HTMLInputElement>('#selectall');
  if (all) all.checked = selected.length > 0 && selected.length === checks().length;
}

listWrap.addEventListener('change', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'selectall') {
    const on = (t as HTMLInputElement).checked;
    checks().forEach((c) => (c.checked = on));
    refreshBulk();
  } else if (t.classList.contains('row-check')) {
    refreshBulk();
  }
});

bulkBtns.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const op = btn.dataset.bulk as 'publish' | 'unpublish' | 'delete';
    const ids = checks().filter((c) => c.checked).map((c) => c.value);
    if (!ids.length) return;
    if (
      op === 'delete' &&
      !(await confirmDialog({
        title: 'Delete fragments',
        message: `Delete ${ids.length} fragment${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;

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
    // Refresh the list in place rather than a hard reload.
    await applyFilters();
    bulkBtns.forEach((b) => (b.disabled = false));
  });
});
