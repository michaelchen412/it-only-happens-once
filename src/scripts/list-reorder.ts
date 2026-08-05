// Reordering a list of rows by hand — drag, Alt+↑/↓, and the touch nudges.
//
// WHY THIS IS A SHARED MODULE (docs/plans/16 · Piece 3). The constellation
// composer solved reordering properly — a ⋮⋮ grip, HTML5 drag, and an Alt+↑/↓
// keyboard path — and the constellations INDEX, which orders the sky itself,
// had only two always-visible arrow buttons: no grip, no drag, no keyboard
// path. The fix is the composer's own solution, and copying ~35 lines into a
// second page is how two implementations start drifting. The SECOND consumer
// is what justifies the extraction; the first one never did.
//
// Three paths, and each one exists because the other two are missing somewhere:
//
//  · DRAG is the pointer path, and the only one that is direct manipulation.
//  · ALT+↑/↓ is the keyboard path. Plain ↑/↓ is not available — it is how you
//    move BETWEEN rows — so the modifier is doing real work, not decoration.
//  · THE NUDGE BUTTONS are the touch path, and only the touch path. `.row-nudge`
//    in app.css deletes them outright on a hovering device, and that reasoning
//    is restated here because it currently lives in a CSS comment that nobody
//    reading the JS will ever find: on a desktop they would only reserve row
//    width for a duplicate of drag. They are NOT redundant — on a touchscreen
//    drag does not exist, and they are the only way to reorder anything.
//
// The caller owns persistence: `onCommit` fires after any gesture that actually
// moved a row, and is where the reorder action goes.

export interface ListReorderOpts {
  /** Selector for one row, matched with `closest()` from the event target. */
  rowSelector: string;
  /** Fired after a gesture that changed the order. Persist here. */
  onCommit: () => void | Promise<void>;
}

export function wireListReorder(list: HTMLElement, { rowSelector, onCommit }: ListReorderOpts): void {
  const rowFrom = (t: EventTarget | null) => (t as Element | null)?.closest<HTMLElement>(rowSelector) ?? null;

  /** Step `row` one place; false if it's already at that end. */
  const step = (row: HTMLElement, up: boolean): boolean => {
    const sib = up ? row.previousElementSibling : row.nextElementSibling;
    if (!sib) return false;
    up ? sib.before(row) : sib.after(row);
    return true;
  };

  // ── touch: the ↑/↓ buttons ────────────────────────────────────────────────
  list.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-move]');
    const row = rowFrom(e.target);
    if (!btn || !row) return;
    if (!step(row, btn.dataset.move === 'up')) return;
    btn.focus(); // keep the keyboard where the row went
    void onCommit();
  });

  // ── keyboard: Alt+↑/↓ on the focused row ─────────────────────────────────
  list.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const row = rowFrom(e.target);
    if (!row || !step(row, e.key === 'ArrowUp')) return;
    e.preventDefault();
    // Focus stays on the element you pressed the key on, which has travelled
    // with the row. Without this the row moves out from under you and focus
    // falls back to <body> — you'd have to find your place again every nudge.
    (e.target as HTMLElement).focus();
    void onCommit();
  });

  // ── pointer: HTML5 drag ──────────────────────────────────────────────────
  let dragged: HTMLElement | null = null;
  list.addEventListener('dragstart', (e) => {
    dragged = rowFrom(e.target);
    if (!dragged) return;
    dragged.classList.add('is-dragging');
    // The payload is never read — the drop handler works off `dragged`. It is
    // set because Firefox refuses to begin a drag at all unless dragstart puts
    // something on the DataTransfer.
    e.dataTransfer?.setData('text/plain', 'row');
  });
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const over = rowFrom(e.target);
    if (!over || !dragged || over === dragged) return;
    // Above the midpoint means "before", below means "after" — so the row you
    // are carrying settles where the pointer actually is, not where it entered.
    const r = over.getBoundingClientRect();
    e.clientY < r.top + r.height / 2 ? over.before(dragged) : over.after(dragged);
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    dragged?.classList.remove('is-dragging');
    if (dragged) void onCommit();
    dragged = null;
  });
  list.addEventListener('dragend', () => {
    dragged?.classList.remove('is-dragging');
    dragged = null;
  });
}
