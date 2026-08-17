// Freezing the page behind whatever is on top of it — one implementation, for
// the same reason `sheet-dismiss.ts` exists: this was solved once, correctly,
// inside `Reader.astro`, and then not applied anywhere else. Every admin dialog
// leaned on `showModal()` instead, and the assumption underneath that — a modal
// dialog blocks the document from scrolling — is one the spec does not make and
// iOS Safari does not keep. Michael, 2026-08-17, on a phone: *"in the ad hoc
// notes popover/dialog thing, I can scroll the background."*
//
// ⚠ OWNERS, NOT A COUNTER. Dialogs stack — the writing sheet opens the publish
// dialog, which opens a confirm — so releasing on the first close would unfreeze
// the page with two sheets still over it. A counter would do that too, and would
// additionally drift: `lock()` twice for one dialog and it never reaches zero,
// leaving the page permanently unscrollable with nothing on screen to explain
// why. A Set keyed on the element is idempotent in both directions, which is the
// property that matters when the callers are event handlers.
const owners = new Set<Element>();

/**
 * Freeze the document behind `owner`. Safe to call twice for the same owner.
 *
 * The scrollbar it hides is measured and paid back as padding, because taking a
 * 15px-wide strip out of the layout reflows the whole page sideways at the exact
 * moment something slides over it. (`scrollbar-gutter` would be the declarative
 * way and was unreliable across browsers when this was written in Reader.astro.)
 *
 * ⚠ MEASURED ONLY ON THE FIRST LOCK. Once `overflow: hidden` is on, the
 * scrollbar is already gone and `innerWidth - clientWidth` is 0 — so a second
 * measurement would overwrite the real figure with nothing and let the page jump
 * after all, on the second dialog rather than the first.
 */
export function lockScroll(owner: Element): void {
  if (owners.has(owner)) return;
  const wasEmpty = owners.size === 0;
  owners.add(owner);
  if (!wasEmpty) return;
  const sbw = window.innerWidth - document.documentElement.clientWidth;
  document.documentElement.style.setProperty('--scrollbar-w', `${sbw}px`);
  document.documentElement.classList.add('scroll-locked');
}

/**
 * Release `owner`'s hold. The freeze lifts only when the last owner lets go.
 *
 * Called with no argument it drops every hold at once — which is for one case
 * only: `<html>` survives a view transition, so an unreleased lock would follow
 * the reader to the next page and strand them on a document that will not
 * scroll, with no dialog anywhere to close.
 */
export function unlockScroll(owner?: Element): void {
  if (owner) owners.delete(owner);
  else owners.clear();
  if (owners.size) return;
  document.documentElement.classList.remove('scroll-locked');
  document.documentElement.style.removeProperty('--scrollbar-w');
}
