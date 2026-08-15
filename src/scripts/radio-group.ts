// The keyboard half of a segmented control that is a CHOICE rather than a row
// of switches.
//
// ⚠ THE ROLE WITHOUT THIS FILE WOULD BE A LIE, which is why the two shipped
// together (plan 38 · §6.3). `role="radiogroup"` is a promise about behaviour as
// much as about semantics: a screen-reader user who hears "radio group, 2 of 3"
// then reaches for the arrow keys, because that is how every radio group they
// have ever met works. Adding the role and leaving Tab-through-each-option in
// place would announce a pattern the control does not implement — worse than the
// `role="group"` it replaces, which at least described what was there.
//
// What was there: `role="group"` with `aria-pressed` on each button, i.e. three
// independent toggles that happen to look like one control. It announced no
// position ("2 of 3"), no set size, and no relationship between the options.
//
// ⚠ THE PRECEDENT WAS ALREADY IN THE TREE. `FragmentListPanel`'s `.seg` has been
// `role="radiogroup"` + `aria-checked` since it was written; the HQ half's
// `.pseg` never adopted it. So this is an alignment finding before it is an
// accessibility one — the same shape as plan 19's Library note.

/** The options, in DOM order. */
const radios = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[role="radio"]')];

/**
 * Roving tabindex + arrow keys over an existing `role="radiogroup"`.
 *
 * ⚠ IT SELECTS BY CLICKING, NOT BY SETTING THE ATTRIBUTE, and that is what keeps
 * it out of every sheet's business. Each control already has a click handler
 * that knows what its value MEANS — which field it writes, whether it also
 * reveals a row, what to do when the sheet is mid-save. Re-implementing any of
 * that here would be a second source of truth for nine different controls.
 *
 * ⚠ ARROW KEYS MOVE *AND* SELECT, which is the ARIA pattern and is deliberate
 * even though plan 38 · §1.2 has just removed a control that fired on arrow-key.
 * The difference is the whole of that finding: the merge `<select>` fired an
 * irreversible ACTION — reassign every link, hard-delete the loser. This sets a
 * value in a form you have not saved yet, and moving one more step puts it back.
 */
export function wireRadioGroup(root: HTMLElement): void {
  const sync = () => {
    const opts = radios(root);
    const checked = opts.find((o) => o.getAttribute('aria-checked') === 'true');
    // Exactly one stop for the whole group: Tab reaches the CHOICE, not each
    // option in turn. With nothing chosen yet the first option takes it, so the
    // group is still reachable.
    for (const o of opts) o.tabIndex = o === (checked ?? opts[0]) ? 0 : -1;
  };

  root.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key;
    const opts = radios(root);
    const here = opts.indexOf(document.activeElement as HTMLElement);
    if (here < 0 || opts.length === 0) return;

    let next = -1;
    if (key === 'ArrowRight' || key === 'ArrowDown') next = (here + 1) % opts.length;
    else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (here - 1 + opts.length) % opts.length;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = opts.length - 1;
    if (next < 0) return;

    // Or the sheet scrolls under the arrow key, and on a horizontal control
    // ArrowDown would leave the group entirely.
    e.preventDefault();
    opts[next].focus();
    opts[next].click();
  });

  // The owning script sets `aria-checked`; this only follows it. A
  // MutationObserver rather than a hook, so no consumer has to remember to call
  // anything after it changes the value — the failure mode that produced
  // `action-error.ts` (a convention that fails at 15% of its sites is not a
  // convention).
  new MutationObserver(sync).observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-checked'],
  });
  sync();
}

/** Wire every radiogroup under `root`. */
export function wireRadioGroups(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[role="radiogroup"]').forEach(wireRadioGroup);
}

// ── reading and writing a segmented control's value ─────────────────────────
//
// The three below were a verbatim triad at the top of `goal-sheet.ts` and
// `task-sheet.ts` — both of which already imported `wireRadioGroups` from here,
// which is what made two copies of "what is this control set to?" worth
// removing. They live beside the wiring that owns the `aria-checked` contract,
// because they are the other half of it.
//
// ⚠ THEY TAKE THE ATTRIBUTE SUFFIX AS IT IS WRITTEN IN THE MARKUP — `effort`,
// `prio`, `goal-status` — AND NEVER TOUCH `dataset`. THAT IS THE WHOLE POINT OF
// MOVING THEM, and it is not a stylistic preference: the copies did
// `querySelectorAll('[data-' + attr + ']')` and `el.dataset[attr]`, which need
// the name in TWO different spellings. `data-goal-status` is `dataset.goalStatus`
// — kebab in one, camel in the other — so a single `attr` string cannot be
// right for both, and `goal-sheet.ts` had been passing the camel one to both
// since it was written. In an HTML document `[data-goalStatus]` is matched
// case-insensitively as `data-goalstatus`, which is not an attribute that
// exists anywhere in this codebase, so that group silently selected NOTHING.
// See the commit that moved these for what it cost. `getAttribute` needs only
// the one spelling and cannot drift from it.

/** The options in a segmented control, in DOM order. */
export const options = (root: ParentNode, attr: string): HTMLButtonElement[] =>
  Array.from(root.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`));

/** Check exactly the option whose value is `value`, and uncheck the rest. */
export const pick = (root: ParentNode, attr: string, value: string): void =>
  options(root, attr).forEach((b) => b.setAttribute('aria-checked', String(b.getAttribute(`data-${attr}`) === value)));

/**
 * What the control is set to, or `fallback` if nothing is.
 *
 * ⚠ THE FALLBACK IS LOAD-BEARING AND IT IS ALSO THE FAILURE MODE. A group that
 * selects nothing — a typo'd attribute, a control that did not render — is
 * indistinguishable here from a group nobody has touched, and both answer
 * `fallback`. That is right for the second case and silent for the first, which
 * is exactly how the `goal-status` bug reached production: the sheet showed the
 * status the server had rendered while this returned `'active'` to the save.
 */
export const picked = (root: ParentNode, attr: string, fallback: string): string =>
  options(root, attr)
    .find((b) => b.getAttribute('aria-checked') === 'true')
    ?.getAttribute(`data-${attr}`) ?? fallback;
