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
