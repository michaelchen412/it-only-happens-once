// Wiring for a FragmentListPanel instance (toolbar + table), scoped to its
// root element so the Fragment Manager page and the composer's browser sheet
// can each run one without colliding. Handles: filter/search/sort with an
// in-place fetch + swap against /admin/fragments-panel, whole-row click →
// onOpen, per-row action buttons (restore/purge/place) → onAction, and
// checkbox selection (with shift-range) → onSelectionChange.
import { MIN_SEARCH } from '../lib/search-highlight';
import { wireRadioGroups } from './radio-group';
import { onSkyChange } from './sky-changed';

const PARTIAL = '/admin/fragments-panel';

export interface PanelOpts {
  /** Params pinned to every fetch (e.g. { mode: 'pick', constellation: id }). */
  extraParams?: Record<string, string>;
  /** Mirror the filter state onto this URL via replaceState ('/admin/fragments'); null = don't. */
  historyBase?: string | null;
  /** Whole-row / title click (never fires in trash view or on [data-noedit]). */
  onOpen?: (row: HTMLElement, e: MouseEvent) => void;
  /** A [data-act] button: 'restore' | 'purge' | 'place'. */
  onAction?: (act: string, id: string, row: HTMLElement) => void;
  /**
   * The cart changed. `ids` is every fragment in it, in the order they were
   * added; `shown` is how many of those are on screen under the current
   * filter. They differ whenever the cart outlives the filter that filled it,
   * which is the whole point of Piece 4 — and the host has to SAY so.
   */
  onSelectionChange?: (ids: string[], shown: number) => void;
  /** After each fetch+swap — the parsed partial doc, for host-side syncing. */
  onSwap?: (doc: Document) => void;
}

export interface RefreshOpts {
  /**
   * A background catch-up: something changed elsewhere (a sheet saved), and the
   * rows on screen are still very nearly right. They stay at full strength and
   * keep taking clicks while the new ones are fetched, and are swapped without
   * ceremony when they arrive. The note above `DIM_AFTER_MS` says why this is
   * right for everything except a filter YOU just changed.
   */
  quiet?: boolean;
  /** Fetch now, but hold the swap until this resolves — a sheet's exit, so the
   *  page-sized `innerHTML` does not land mid-slide. */
  swapAfter?: Promise<void>;
}

export interface PanelHandle {
  root: HTMLElement;
  refresh: (o?: RefreshOpts) => Promise<void>;
  getSelected: () => string[];
  clearSelection: () => void;
  /** Take one fragment out of the cart without touching the rest. The browser
   *  calls this after a per-row ＋: `markPlaced` disables the checkbox, but a
   *  disabled box is invisible to the cart, so its id would otherwise ride
   *  along into the next bulk place. */
  deselect: (id: string) => void;
}

export function wireFragmentPanel(root: HTMLElement, opts: PanelOpts = {}): PanelHandle {
  const filters = root.querySelector('.fpanel-filters') as HTMLFormElement;
  const listWrap = root.querySelector('.fpanel-list') as HTMLElement;
  const sortInput = root.querySelector('.fpanel-sort') as HTMLInputElement;
  const typeInput = root.querySelector('.fpanel-type') as HTMLInputElement;
  const qInput = filters.elements.namedItem('q') as HTMLInputElement;

  const checkList = () => Array.from(listWrap.querySelectorAll<HTMLInputElement>('.row-check:not(:disabled)'));

  /**
   * ── THE CART ──────────────────────────────────────────────────────────
   * The selection is a Set that OUTLIVES the filter, not a reading of which
   * checkboxes happen to be ticked right now.
   *
   * Before this there was no selection model at all — `getSelected()` read
   * `.row-check:checked` off the DOM, and every filter change replaced
   * `listWrap.innerHTML`, which destroyed those checkboxes and rebuilt them
   * unticked from the partial. So selecting three things and then narrowing
   * the search silently threw all three away. Nothing was broken in the
   * selection logic; there was simply nothing for it to be logic about.
   *
   * A Set (not an array, not a NodeList) because two properties matter:
   * membership is the question asked on every re-tick after a swap, and
   * INSERTION ORDER is what the browser's bulk place turns into suite order —
   * each placement takes `position = max + 1`, so the order you added things
   * to the cart becomes the order they read in. That is a quiet improvement
   * over what happened before, which was whatever order the current filter
   * happened to render.
   */
  const cart = new Set<string>();

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(filters) as unknown as Iterable<[string, string]>) if (v) params.set(k, v);
    if (params.get('sort') === 'edited_desc') params.delete('sort'); // keep the default URL clean
    if ((params.get('q')?.trim().length ?? 0) < MIN_SEARCH) params.delete('q'); // ignore too-short terms
    return params;
  }

  // The toolbar sits OUTSIDE `.fpanel-list`, so the swap below never touches
  // it — but every partial we fetch contains a fresh copy of it. Copying the
  // parts that go stale out of a response we're already receiving costs no
  // request at all, and it makes the toolbar self-healing: any filter change,
  // any refresh(), any fragments:changed re-syncs it.
  //
  // This is the PULL half of Piece 3. It is the only half that can see a
  // constellation made in ANOTHER TAB, or one made on /admin/constellations
  // before you navigated here — the `sky:changed` push is blind to both, since
  // a CustomEvent cannot cross a document.
  function syncToolbar(doc: Document) {
    // type-badge counts
    doc.querySelectorAll<HTMLElement>('.type-badge').forEach((src) => {
      const dst = root.querySelector<HTMLElement>(
        `.type-badge[data-type-filter="${src.dataset.typeFilter ?? ''}"] .type-badge__n`,
      );
      const val = src.querySelector('.type-badge__n')?.textContent;
      if (dst && val != null) dst.textContent = val;
    });

    // "Filter by constellation" — the sharp one. Before this, every filter
    // change fetched a partial containing a fresh option list and threw it
    // away, so the select was stale from the moment the page rendered and
    // stayed stale no matter what you did short of a hard reload.
    const freshIn = doc.querySelector<HTMLSelectElement>('select[name="in"]');
    const liveIn = root.querySelector<HTMLSelectElement>('select[name="in"]');
    if (freshIn && liveIn && freshIn.innerHTML !== liveIn.innerHTML) {
      const keep = liveIn.value; // the selection is the user's, not the server's
      liveIn.innerHTML = freshIn.innerHTML;
      liveIn.value = keep;
      // A filter pointing at a constellation that has since been deleted can't
      // be honoured; fall back to "any" rather than showing a blank select.
      if (liveIn.selectedIndex === -1) liveIn.value = '';
    }
  }

  /** Add one `<option>` to the constellation filter, if it isn't there yet.
   *  Appended, because `save` gives a new constellation sort = max+1 and the
   *  server renders this list in `sort` order. */
  function addConstellationOption(c: { slug: string; name: string }) {
    const sel = root.querySelector<HTMLSelectElement>('select[name="in"]');
    if (!sel || sel.querySelector(`option[value="${CSS.escape(c.slug)}"]`)) return;
    const opt = document.createElement('option');
    opt.value = c.slug;
    opt.textContent = c.name; // textContent, not innerHTML — it's a typed name
    sel.appendChild(opt);
  }
  onSkyChange(addConstellationOption);

  /*
    ── THE DIM SAYS "WHAT YOU SEE IS NOT WHAT YOU ASKED FOR", AND NOTHING ELSE ──
    (2026-11-13.) `.list-loading` fades the table and takes it away from the
    pointer, and it used to go on for EVERY fetch — including the refresh after
    a sheet closed, when the rows on screen were 99% right and the one that
    changed was the one you had just been looking at. So closing a sheet greyed
    out the whole list and made it unclickable for as long as the round trip
    took. Michael: *"it takes more than a second for that fragment browser to
    reload, and it's disabled the whole time."*

    Now it is two cases:
      · A filter, sort or search you just changed: the rows on screen ARE wrong
        — they answer a question you have stopped asking — so they dim. But only
        after DIM_AFTER_MS: a response faster than that never flashes the table
        at all, and a dim that blinks on and off reads as flicker, not progress.
      · A background catch-up (`quiet`): nothing dims and nothing is blocked.
        The new rows replace the old ones when they arrive, focus stays on the
        same row, and in the common case you never see a refresh happen.

    The alternative that lost: a spinner or skeleton for the quiet case. It
    would announce work the reader has no reason to wait for — the save has
    already succeeded, and the table only needs to catch up with it.
  */
  const DIM_AFTER_MS = 200;
  let dimTimer = 0;
  function armDim() {
    if (dimTimer || listWrap.classList.contains('list-loading')) return;
    dimTimer = window.setTimeout(() => {
      dimTimer = 0;
      listWrap.classList.add('list-loading');
    }, DIM_AFTER_MS);
  }
  function clearDim() {
    clearTimeout(dimTimer);
    dimTimer = 0;
    listWrap.classList.remove('list-loading');
  }

  /*
    ── FOCUS IS SAID IN TERMS THAT SURVIVE A SWAP ─────────────────────────
    `innerHTML` throws every row away, and with them whatever had focus — the
    row you returned to from a sheet drops focus to <body>, and a keyboard user
    loses their place in a list of 168 things. So focus is recorded as "the nth
    control in row <id>" (or "the sort header for <field>"), and put back on the
    same control in the new markup.

    ⚠ THE SHEET'S OPENER IS THE CASE THAT NEEDS TWO HALVES. A live refresh swaps
    the table while a sheet is open over it, so the element the browser means to
    return focus to on close is already gone when the sheet shuts, and the
    browser lands on <body>. We can't change the dialog's own target, so we
    remember the opener's spot at open time and, when a dialog closes onto
    <body> after one of those swaps, finish the job ourselves.
  */
  type FocusSpot = { header: string } | { row: string; index: number };
  const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  function spotOf(el: Element | null): FocusSpot | null {
    if (!el || !listWrap.contains(el)) return null;
    const header = el.closest<HTMLElement>('.sort-header');
    if (header?.dataset.field) return { header: header.dataset.field };
    const row = el.closest<HTMLElement>('tr.fragment-row');
    if (!row?.dataset.id) return null;
    return { row: row.dataset.id, index: Array.from(row.querySelectorAll(FOCUSABLE)).indexOf(el) };
  }
  function elementAt(spot: FocusSpot): HTMLElement | null {
    if ('header' in spot)
      return listWrap.querySelector<HTMLElement>(`.sort-header[data-field="${CSS.escape(spot.header)}"]`);
    const row = listWrap.querySelector<HTMLElement>(`tr.fragment-row[data-id="${CSS.escape(spot.row)}"]`);
    if (!row) return null;
    return row.querySelectorAll<HTMLElement>(FOCUSABLE)[spot.index] ?? null;
  }

  let openerSpot: FocusSpot | null = null; // set on every row open
  let openerSwapped = false; // the opener's element was replaced while a sheet was up
  const onDialogClose = () => {
    if (!root.isConnected) return void document.removeEventListener('close', onDialogClose, true);
    // A confirm closing back into its sheet lands focus INSIDE the sheet, not
    // on <body> — that is not our close, so stay armed for the sheet's own.
    if (!openerSwapped || !openerSpot || (document.activeElement && document.activeElement !== document.body)) return;
    openerSwapped = false;
    elementAt(openerSpot)?.focus({ preventScroll: true });
  };
  // Capture: `close` does not bubble. By the time it fires the browser has
  // already tried (and, after a swap, failed) to restore focus.
  document.addEventListener('close', onDialogClose, true);

  // --- fetch + swap (keeps focus; no navigation) ----------------------------
  let fetchToken = 0;
  async function applyFilters(o: RefreshOpts = {}) {
    const params = buildParams();
    const historyUrl = opts.historyBase ? opts.historyBase + (params.toString() ? `?${params}` : '') : null;
    for (const [k, v] of Object.entries(opts.extraParams ?? {})) params.set(k, v);
    const token = ++fetchToken;
    // A quiet fetch leaves an ARMED dim alone: if it supersedes a filter change
    // still in flight, what is on screen is still the wrong answer until it lands.
    if (!o.quiet) armDim();
    try {
      const res = await fetch(`${PARTIAL}?${params}`, { headers: { 'X-Requested-With': 'fetch' } });
      if (!res.ok) throw new Error('bad status');
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const next = doc.querySelector('.fpanel-list');
      if (!next) throw new Error('no list');
      if (o.swapAfter) await o.swapAfter;
      if (token !== fetchToken) return;
      // Read focus at SWAP time, not at click time: if you moved on while the
      // fetch was out, the swap has no business pulling you back.
      const focusSpot = spotOf(document.activeElement);
      const underSheet = !!document.querySelector('dialog[open]');
      listWrap.innerHTML = next.innerHTML;
      syncToolbar(doc);
      if (historyUrl) history.replaceState({}, '', historyUrl);
      lastIndex = -1;
      // The rows arrived unticked. Re-tick from the cart BEFORE reporting, so
      // a fragment carted three searches ago shows ticked the moment a later
      // filter brings it back on screen.
      restoreTicks();
      refreshSelection();
      if (focusSpot) elementAt(focusSpot)?.focus({ preventScroll: true });
      if (underSheet && openerSpot) openerSwapped = true;
      opts.onSwap?.(doc);
    } catch {
      // Manager context: fall back to a full navigation (server renders the
      // same state). Sheet context: stay put — the previous list still stands.
      //
      // ⚠ NEVER WITH A SHEET OPEN. A live refresh runs while you are typing in
      // one, and navigating away from that to recover a TABLE would be trading
      // the thing you are writing for the thing behind it. Stale rows are the
      // honest failure there; the next refresh corrects them.
      if (o.swapAfter) await o.swapAfter;
      if (historyUrl && !document.querySelector('dialog[open]')) location.assign(historyUrl);
    } finally {
      if (token === fetchToken) clearDim();
    }
  }

  filters.addEventListener('submit', (e) => e.preventDefault());
  filters.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => applyFilters()));
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
      openerSpot = spotOf(document.activeElement); // the membership cell opens a sheet too
      openerSwapped = false;
      const row = actBtn.closest<HTMLElement>('tr.fragment-row');
      if (row) opts.onAction?.(actBtn.dataset.act!, actBtn.dataset.id ?? row.dataset.id!, row);
      return;
    }

    const check = el.closest<HTMLInputElement>('.row-check');
    if (check) return void onCheckClick(e as MouseEvent, check);

    if (el.closest('.select-all') || el.closest('[data-noedit]')) return;

    const row = el.closest<HTMLElement>('tr.fragment-row');
    if (row && root.dataset.view !== 'trash') {
      openerSpot = spotOf(document.activeElement); // what the browser will try to return to
      openerSwapped = false;
      opts.onOpen?.(row, e as MouseEvent);
    }
  });

  // select-all (change fires once). It keeps meaning "everything currently
  // VISIBLE": it adds the rows on screen to the cart or takes them out of it,
  // and never touches what's in the cart from another filter. Making it mean
  // "the whole cart" would give the one control on the page that can empty a
  // cart you can't see — which is what the explicit Clear button is for.
  listWrap.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('select-all')) {
      const on = (t as HTMLInputElement).checked;
      checkList().forEach((c) => {
        c.checked = on;
        setInCart(c.value, on);
      });
      refreshSelection();
    }
  });

  // --- selection + shift-range ----------------------------------------------
  let lastIndex = -1;

  function setInCart(id: string, on: boolean) {
    // Delete-then-add on a re-tick would move the id to the END of the
    // insertion order, quietly reshuffling a suite you were about to place.
    // Ticking something already carted is a no-op; only untick removes.
    if (on) cart.add(id);
    else cart.delete(id);
  }

  /** Point the visible checkboxes at the cart. Runs after every swap. */
  function restoreTicks() {
    checkList().forEach((c) => (c.checked = cart.has(c.value)));
  }

  function onCheckClick(e: MouseEvent, check: HTMLInputElement) {
    const boxes = checkList();
    const idx = boxes.indexOf(check);
    if (e.shiftKey && lastIndex !== -1) {
      const [a, b] = [lastIndex, idx].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) {
        boxes[i].checked = check.checked;
        setInCart(boxes[i].value, check.checked);
      }
    } else {
      setInCart(check.value, check.checked);
    }
    lastIndex = idx;
    refreshSelection();
  }

  function refreshSelection() {
    const boxes = checkList();
    const visible = boxes.filter((c) => cart.has(c.value));
    const all = listWrap.querySelector<HTMLInputElement>('.select-all');
    if (all) {
      // Scoped to what's VISIBLE, matching what select-all does. A tick-all
      // box that reads the whole cart would sit indeterminate forever the
      // moment the cart held something off-screen.
      all.checked = visible.length > 0 && visible.length === boxes.length;
      all.indeterminate = visible.length > 0 && visible.length < boxes.length;
    }
    opts.onSelectionChange?.([...cart], visible.length);
  }

  // Everything in this table is INERT until this line: the rows are markup, and
  // every click on one — the title, the ＋, the membership cell — is delivered
  // by the delegated listeners above. Saying so out loud costs one attribute
  // and buys a signal nothing else in the DOM provides. The e2e harness needs
  // it (a spec that clicks before this is testing the dev server's compile
  // time), and it names the real gap a slow connection can show a person.
  root.dataset.wired = '';

  return {
    root,
    refresh: applyFilters,
    getSelected: () => [...cart],
    clearSelection: () => {
      cart.clear();
      restoreTicks();
      refreshSelection();
    },
    deselect: (id: string) => {
      cart.delete(id);
      refreshSelection();
    },
  };
}

/** The Add ▾ dropdown (manager header + browser sheet header share the shape). */
export function wireAddMenu(btn: HTMLElement, menu: HTMLElement) {
  // `:not([hidden])` because the writing sheet's ⋯ menu (docs/plans/16 · Piece
  // 1) shows a different set per publish state — Discard only exists while
  // you're dirty. Arrow-keying onto a hidden item would silently do nothing and
  // strand the index. The Add menus have no hidden items, so this is a no-op
  // for them.
  const items = () => Array.from(menu.querySelectorAll<HTMLElement>('.add-item:not([hidden])'));
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
  // Choosing something closes the menu (whatever it opened takes over).
  // Delegated rather than bound per item at wire time: the set of items is no
  // longer fixed, so a listener attached once would miss anything hidden then.
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.add-item')) closeMenu();
  });

  // Returned so a caller that hides the button can also shut the menu behind it
  // — an open menu whose trigger has vanished is unclosable by outside-click.
  return { close: closeMenu };
}

// ⚠ THE ONE CONTROL THAT ALREADY HAD THE ROLE AND STILL DID NOT KEEP ITS
// PROMISE. `.seg` here has been `role="radiogroup"` + `aria-checked` since it
// was written — it is the precedent plan 38 · §6.3 cites for converting the HQ
// half — and it had four tab stops and no arrow keys, because the role was
// added as a LABEL rather than as a contract. Found by the ratchet written for
// the nine controls being converted, on the one that was supposedly already
// right. Same wiring as the rest now.
wireRadioGroups();
