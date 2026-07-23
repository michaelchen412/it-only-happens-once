// Wiring for a FragmentListPanel instance (toolbar + table), scoped to its
// root element so the Fragment Manager page and the composer's browser sheet
// can each run one without colliding. Handles: filter/search/sort with an
// in-place fetch + swap against /admin/fragments-panel, whole-row click →
// onOpen, per-row action buttons (restore/purge/place) → onAction, and
// checkbox selection (with shift-range) → onSelectionChange.
import { MIN_SEARCH } from '../lib/search-highlight';

const PARTIAL = '/admin/fragments-panel';

export interface PanelOpts {
  /** Params pinned to every fetch (e.g. { mode: 'pick', constellation: id }). */
  extraParams?: Record<string, string>;
  /** Mirror the filter state onto this URL via replaceState ('/admin'); null = don't. */
  historyBase?: string | null;
  /** Whole-row / title click (never fires in trash view or on [data-noedit]). */
  onOpen?: (row: HTMLElement, e: MouseEvent) => void;
  /** A [data-act] button: 'restore' | 'purge' | 'place'. */
  onAction?: (act: string, id: string, row: HTMLElement) => void;
  onSelectionChange?: (ids: string[]) => void;
  /** After each fetch+swap — the parsed partial doc, for host-side syncing. */
  onSwap?: (doc: Document) => void;
}

export interface PanelHandle {
  root: HTMLElement;
  refresh: () => Promise<void>;
  getSelected: () => string[];
  clearSelection: () => void;
}

export function wireFragmentPanel(root: HTMLElement, opts: PanelOpts = {}): PanelHandle {
  const filters = root.querySelector('.fpanel-filters') as HTMLFormElement;
  const listWrap = root.querySelector('.fpanel-list') as HTMLElement;
  const sortInput = root.querySelector('.fpanel-sort') as HTMLInputElement;
  const typeInput = root.querySelector('.fpanel-type') as HTMLInputElement;
  const qInput = filters.elements.namedItem('q') as HTMLInputElement;

  const checkList = () => Array.from(listWrap.querySelectorAll<HTMLInputElement>('.row-check:not(:disabled)'));

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(filters) as unknown as Iterable<[string, string]>) if (v) params.set(k, v);
    if (params.get('sort') === 'edited_desc') params.delete('sort'); // keep the default URL clean
    if ((params.get('q')?.trim().length ?? 0) < MIN_SEARCH) params.delete('q'); // ignore too-short terms
    return params;
  }

  // Type-badge counts live in the toolbar (outside the swapped region) — copy
  // the fresh numbers from the fetched partial.
  function syncCounts(doc: Document) {
    doc.querySelectorAll<HTMLElement>('.type-badge').forEach((src) => {
      const dst = root.querySelector<HTMLElement>(`.type-badge[data-type-filter="${src.dataset.typeFilter ?? ''}"] .type-badge__n`);
      const val = src.querySelector('.type-badge__n')?.textContent;
      if (dst && val != null) dst.textContent = val;
    });
  }

  // --- fetch + swap (keeps focus; no navigation) ----------------------------
  let fetchToken = 0;
  async function applyFilters() {
    const params = buildParams();
    const historyUrl = opts.historyBase ? opts.historyBase + (params.toString() ? `?${params}` : '') : null;
    for (const [k, v] of Object.entries(opts.extraParams ?? {})) params.set(k, v);
    // remember a focused sort header so keyboard focus survives the swap
    const focusField = (document.activeElement as HTMLElement)?.closest?.('.sort-header')?.getAttribute('data-field');
    const token = ++fetchToken;
    listWrap.classList.add('list-loading');
    try {
      const res = await fetch(`${PARTIAL}?${params}`, { headers: { 'X-Requested-With': 'fetch' } });
      if (!res.ok) throw new Error('bad status');
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const next = doc.querySelector('.fpanel-list');
      if (!next) throw new Error('no list');
      if (token !== fetchToken) return;
      listWrap.innerHTML = next.innerHTML;
      syncCounts(doc);
      if (historyUrl) history.replaceState({}, '', historyUrl);
      lastIndex = -1;
      refreshSelection();
      if (focusField) listWrap.querySelector<HTMLElement>(`.sort-header[data-field="${focusField}"]`)?.focus();
      opts.onSwap?.(doc);
    } catch {
      // Manager context: fall back to a full navigation (server renders the
      // same state). Sheet context: stay put — the previous list still stands.
      if (historyUrl) location.assign(historyUrl);
    } finally {
      if (token === fetchToken) listWrap.classList.remove('list-loading');
    }
  }

  filters.addEventListener('submit', (e) => e.preventDefault());
  filters.querySelectorAll('select').forEach((s) => s.addEventListener('change', applyFilters));
  filters.addEventListener('filter:change', () => applyFilters()); // subject combobox

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

  // --- type badges = filters ------------------------------------------------
  const badges = Array.from(root.querySelectorAll<HTMLButtonElement>('.type-badge'));
  const paintBadges = () =>
    badges.forEach((x) => {
      const on = (x.dataset.typeFilter || '') === typeInput.value;
      x.classList.toggle('is-active', on);
      x.setAttribute('aria-checked', String(on));
    });
  badges.forEach((b) =>
    b.addEventListener('click', () => {
      typeInput.value = b.dataset.typeFilter || '';
      paintBadges();
      applyFilters();
    }),
  );

  // --- clear: back to the unfiltered view ------------------------------------
  filters.querySelector('[data-clear]')?.addEventListener('click', () => {
    typeInput.value = '';
    qInput.value = '';
    lastSearch = '';
    filters.querySelectorAll('select').forEach((s) => ((s as HTMLSelectElement).value = ''));
    (filters.querySelector('subject-filter') as HTMLElement & { clear?: () => void })?.clear?.();
    paintBadges();
    applyFilters();
  });

  // --- sort headers + row delegation (they live inside the swapped table) ---
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

    const actBtn = el.closest<HTMLElement>('[data-act]');
    if (actBtn) {
      const row = actBtn.closest<HTMLElement>('tr.fragment-row');
      if (row) opts.onAction?.(actBtn.dataset.act!, actBtn.dataset.id ?? row.dataset.id!, row);
      return;
    }

    const check = el.closest<HTMLInputElement>('.row-check');
    if (check) return void onCheckClick(e as MouseEvent, check);

    if (el.closest('.select-all') || el.closest('[data-noedit]')) return;

    const row = el.closest<HTMLElement>('tr.fragment-row');
    if (row && root.dataset.view !== 'trash') opts.onOpen?.(row, e as MouseEvent);
  });

  // select-all (change fires once)
  listWrap.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('select-all')) {
      const on = (t as HTMLInputElement).checked;
      checkList().forEach((c) => (c.checked = on));
      refreshSelection();
    }
  });

  // --- selection + shift-range ----------------------------------------------
  let lastIndex = -1;
  function onCheckClick(e: MouseEvent, check: HTMLInputElement) {
    const boxes = checkList();
    const idx = boxes.indexOf(check);
    if (e.shiftKey && lastIndex !== -1) {
      const [a, b] = [lastIndex, idx].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) boxes[i].checked = check.checked;
    }
    lastIndex = idx;
    refreshSelection();
  }
  function refreshSelection() {
    const boxes = checkList();
    const selected = boxes.filter((c) => c.checked);
    const all = listWrap.querySelector<HTMLInputElement>('.select-all');
    if (all) {
      all.checked = selected.length > 0 && selected.length === boxes.length;
      all.indeterminate = selected.length > 0 && selected.length < boxes.length;
    }
    opts.onSelectionChange?.(selected.map((c) => c.value));
  }

  return {
    root,
    refresh: applyFilters,
    getSelected: () => checkList().filter((c) => c.checked).map((c) => c.value),
    clearSelection: () => {
      checkList().forEach((c) => (c.checked = false));
      refreshSelection();
    },
  };
}

/** The Add ▾ dropdown (manager header + browser sheet header share the shape). */
export function wireAddMenu(btn: HTMLElement, menu: HTMLElement) {
  const items = () => Array.from(menu.querySelectorAll<HTMLElement>('.add-item'));
  const openMenu = () => {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    items()[0]?.focus();
  };
  const closeMenu = (focusBtn = false) => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focusBtn) btn.focus();
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? openMenu() : closeMenu();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== btn) closeMenu();
  });
  menu.addEventListener('keydown', (e) => {
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
  // creating something closes the menu (the sheet takes over)
  items().forEach((el) => el.addEventListener('click', () => closeMenu()));
}
