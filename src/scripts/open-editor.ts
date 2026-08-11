// The row → editor seam. A row says WHICH FRAGMENT it wants opened and WHICH
// TAB it wants opened on; it never names a surface. That distinction is the
// whole point of this file: quotes and songs open the FragmentSheet, writing
// opens the workshop, and a row must not have to know which — every host had
// its own copy of that `if (row.dataset.writing)` branch, and the tab hint
// would have made a fourth copy of it.
//
// It is also what keeps the surface swappable. If the membership tab ever
// becomes a small popover anchored to the cell instead of a whole sheet, the
// rows don't change at all — only the listener on the other end of this event.
//
// ⚠ THE STRING FORM OF `detail` IS STILL LIVE. /admin/constellations/[id]
// dispatches both events with a bare string, and both listeners accept either
// shape. Don't "tidy" that away without changing the composer too.

export interface EditIntent {
  /** A `[data-tabpanel]` key — 'constellations' from the membership cell. */
  tab?: string;
}

/**
 * Ask for `el`'s fragment to be opened in its editor. `el` is any element
 * carrying the row's data attributes (`data-writing` or `data-fragment`).
 * Returns false when it carries neither, which is a row nobody can edit.
 */
export function openEditorFor(el: HTMLElement, tab?: string): boolean {
  if (el.dataset.writing) {
    document.dispatchEvent(new CustomEvent('writing:edit', { detail: { id: el.dataset.writing, tab } }));
    return true;
  }
  // ⚠ A SONG IS AN ID, NOT A PAYLOAD (ADR 0031), and it is the third surface
  // this seam was written to make swappable. `SongSheet` needs the album, the
  // year, both notes and the paired essays; carrying all of that on every row
  // would put every private note in the corpus into the manager's HTML in order
  // to open one of them. So the row says WHICH song and the sheet does one read
  // — which is also why this branch looks like `writing` above rather than like
  // `fragment` below.
  if (el.dataset.song) {
    document.dispatchEvent(new CustomEvent('song:edit', { detail: { id: el.dataset.song, tab } }));
    return true;
  }
  if (el.dataset.fragment) {
    document.dispatchEvent(new CustomEvent('fragment:edit', { detail: { data: el.dataset.fragment, tab } }));
    return true;
  }
  return false;
}

/** Read either shape of a sheet-open event's `detail`. */
export function readIntent<K extends string>(detail: unknown, key: K): { value: string; tab?: string } | null {
  if (typeof detail === 'string') return detail ? { value: detail } : null;
  if (detail && typeof detail === 'object') {
    const v = (detail as Record<string, unknown>)[key];
    if (typeof v === 'string' && v) {
      const tab = (detail as EditIntent).tab;
      return { value: v, tab: typeof tab === 'string' ? tab : undefined };
    }
  }
  return null;
}
