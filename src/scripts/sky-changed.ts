// `sky:changed` — the page-wide announcement that the set of constellations,
// or one constellation's own name/colour, is not what the server rendered.
//
// WHY THIS EXISTS. Every control built from "all constellations" is
// server-rendered once and never revisited: the two editor sheets' pickers, the
// fragment list's "Filter by constellation" select, the browser's header. That
// was harmless while the only way to make one was on /admin/constellations —
// you arrived at those controls through a fresh page load. Creating one from
// inside a fragment (ConstellationPicker's footer) removes that guarantee, so
// the surface got BIGGER before it got better, and this is the better.
//
// ── Push and pull are both needed, and neither is redundant ──────────────
// This module is the PUSH half: it is instant, and it is the entire point of
// creating a constellation mid-edit — you tick it in the same second you named
// it. But push can only ever see what happened in THIS document. A
// constellation made in another tab, or on /admin/constellations before you
// navigated here, is invisible to it forever.
//
// The PULL half is `syncToolbar()` in fragment-panel.ts, which copies the
// fresh `<option>` list out of every partial the panel already fetches. It
// costs no request and it is self-healing, but it only runs when something
// causes a fetch, so it can't be instant.
//
// Neither one covers the other's case. Deleting either leaves a real hole.

export interface SkyConstellation {
  id: string;
  name: string;
  slug: string;
  /** Present when a whole constellation was saved (the composer's own form),
   *  absent when one was merely created from a picker, which only knows a
   *  name. Listeners that repaint colour or descriptions check for them. */
  color?: string;
  description?: string | null;
}

const EVENT = 'sky:changed';

/** Say that a constellation was created (or renamed / recoloured). */
export function announceSkyChange(c: SkyConstellation): void {
  document.dispatchEvent(new CustomEvent<SkyConstellation>(EVENT, { detail: c }));
}

/** Listen for one. Every listener runs — this is a notification, not a claim. */
export function onSkyChange(fn: (c: SkyConstellation) => void): void {
  document.addEventListener(EVENT, (e) => fn((e as CustomEvent<SkyConstellation>).detail));
}
