// Finding a sheet's error line WITHOUT knowing what somebody called it.
//
// ⚠ THIS IS THE HALF THAT STOPS THE DRIFT COMING BACK (plan 38 · §3). Putting
// the error line in `SheetError.astro` makes 35 copies of the markup into one;
// it does nothing about the reason there were 35, which is that every script
// reached for a different invented id and so every new sheet had to invent a
// twenty-first. The component and this function are one change in two files:
// the markup has an owner, and the lookup no longer needs a name.
//
// The ids that existed when this was written, all for one job: `sheet-error`,
// `person-error`, `task-error`, `goal-sheet-error`, `event-sheet-error`,
// `tag-sheet-error`, `link-error`, `lst-error`, `lib-error`, `cc-error`,
// `cl-error`, `sng-error`, `about-error`, `bulk-error`, `dialog-error`,
// `fb-error`, `push-error`, `ws-error`, `ws-music-error`, `ws-ver-error`.

/**
 * The error line inside `root`, by role rather than by id.
 *
 * ⚠ PASS THE SHEET, NOT `document`. An id was globally unique; a role is not,
 * so the scope has to come from the caller. A profile page holds three of these
 * elements, and `document` returns whichever renders first — which is how the
 * first draft of `link-sheet.ts` wrote every failure into a hidden element
 * belonging to `PersonSheet` and showed the user nothing.
 *
 * ⚠ IT RETURNS THE ELEMENT, AND THE FIRST VERSION RETURNED A `show`/`hide` PAIR
 * ON A GUESS THAT DID NOT SURVIVE ITS CONSUMERS. The guess was that everyone
 * hand-rolls the same set-text-and-unhide; in fact eight of nine call sites
 * already have their own `show(el, msg)` — several with a second target, a
 * scroll, or a page-level twin — and wanted only the lookup. `hide()` was never
 * called once. Returning the element is the smaller surface and the honest one.
 */
export function sheetError(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-sheet-error]');
}
