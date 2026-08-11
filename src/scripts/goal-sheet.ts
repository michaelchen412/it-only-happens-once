// Client logic for GoalSheet.astro, and the status control on the goal page
// (docs/plans/13-agenda.md §4a).
//
// Two things live here, because they are two ways of doing the same thing: the
// sheet (where a goal is written down or edited) and the four-way segmented
// control in the goal page's header (where its standing changes with one tap).
//
// ⚠ THE CAP ARRIVES AS A SENTENCE, NOT A DISABLED BUTTON. Five active goals is
// enforced in the action, and the sixth is refused with a line you can read.
// Greying out `Active` would say "no" without saying why, on a control whose
// whole point is that letting go is a visible, dignified move.
import { actions } from 'astro:actions';
import { callAction, formatActionError, submitAction } from './action-error';
import { confirmDiscard, dirtyTracker, wireSheetDismiss } from './sheet-dismiss';

const sheet = document.querySelector<HTMLDialogElement>('#goal-sheet');
const form = document.querySelector<HTMLFormElement>('#goal-form');

/** The page-level alert, shared with the status control below. */
const pageError = document.querySelector<HTMLElement>('[data-goal-error]');
const showPageError = (msg: string | null) => {
  if (!pageError) return;
  pageError.textContent = msg ?? '';
  pageError.hidden = !msg;
};

if (sheet && form) {
  /** Every gesture that leaves this sheet routes through `requestClose` below. */
  const dirty = dirtyTracker(sheet);

  const errorEl = document.querySelector<HTMLElement>('#goal-sheet-error');
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]')!;
  const whyInput = form.querySelector<HTMLTextAreaElement>('textarea[name="why"]')!;
  const notesInput = form.querySelector<HTMLTextAreaElement>('textarea[name="notes"]')!;

  const showError = (message: string | null) => {
    if (!errorEl) return;
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
  };

  const group = (attr: string) => Array.from(form.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`));
  const pick = (attr: string, value: string) =>
    group(attr).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  const picked = (attr: string, fallback: string) =>
    group(attr).find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset[attr] ?? fallback;

  group('horizon').forEach((b) => b.addEventListener('click', () => pick('horizon', b.dataset.horizon!)));
  group('goalStatus').forEach((b) => b.addEventListener('click', () => pick('goalStatus', b.dataset.goalStatus!)));

  document.querySelectorAll<HTMLElement>('[data-open-goal-sheet], [data-edit-goal]').forEach((btn) =>
    btn.addEventListener('click', () => {
      showError(null);
      dirty.reset(); // populating is not editing — see dirtyTracker
      sheet.showModal();
      nameInput.focus();
    }),
  );
  /*
    ⚠ THE ✕, ESCAPE AND THE BACKDROP ALL MEAN "I WANT OUT" (ADR 0032). This
    sheet answered only the first for its whole life — clicking away did
    nothing at all, which reads as stuck and sends the reader to the browser's
    Back button, where far more is lost than the sheet would have cost.
  
    It GUARDS because it has something to lose: an explicit-save form holds
    everything typed into it until the button is pressed. The confirm cannot
    fire on a sheet nobody edited — the tracker is reset after every populate —
    so this costs nothing on the common path.
  */
  async function requestClose() {
    if (dirty.get() && !(await confirmDiscard('This goal'))) return;
    dirty.reset();
    // `!` because a hoisted `async function` cannot inherit the narrowing
    // from the `if (sheet && …)` around it — the same reason this file already
    // writes `sheet!` at its other exits.
    sheet!.close();
  }
  wireSheetDismiss(sheet, requestClose);

  // The lifecycle — disable, label, format ANY failure, restore — is
  // `submitAction` now (scripts/action-error.ts, docs/plans/25 · §2). Eight
  // sheets hand-rolled the identical block, nine other files missed it
  // entirely, and a convention that fails at 15% of its sites is not a
  // convention. ⚠ Note what the hand-rolled version got wrong beyond the
  // duplication: it did `throw new Error(error.message)` and then formatted the
  // rethrow, so a validation failure lost its field-level sentences one line
  // before `formatActionError` was called to join them.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(null);
    const res = await submitAction(
      () =>
        actions.goals.save({
          id: form.dataset.id || undefined,
          name: nameInput.value.trim(),
          why: whyInput.value.trim(),
          notes: notesInput.value.trim(),
          horizon: picked('horizon', 'this_year') as 'this_season' | 'this_year' | 'next_few_years',
          status: picked('goalStatus', 'active') as 'active' | 'paused' | 'achieved' | 'let_go',
        }),
      { button: submitBtn, busy: 'Saving…', onError: showError },
    );
    if (!res.ok) return;
    // A new goal goes to its own page; an edit reloads the one you are on.
    // Both re-derive the observation line rather than patching it, since it
    // is a function of rows this form did not touch.
    //
    // The button stays on "Saving…" through the navigation on purpose — see
    // `SubmitOptions.reusable` for why not restoring is the default.
    if (!form.dataset.id && res.data) location.href = `/admin/agenda/goals/${res.data.slug}`;
    else location.reload();
  });

  const deleteBtn = form.querySelector<HTMLButtonElement>('[data-delete-goal]');
  deleteBtn?.addEventListener('click', async () => {
    const id = form.dataset.id;
    if (!id) return;
    const { confirmDialog } = await import('./confirm-dialog');
    // A real confirm, unlike letting go: this one cannot be undone. The
    // sentence names what survives, because that is the actual question.
    const ok = await confirmDialog({
      title: 'Delete this goal?',
      message: 'The tasks filed under it stay, and what you did toward it stays done.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    // No `busy` label: this button is a trash glyph and one word, and swapping
    // it for "Deleting…" reflows the row for the length of a request that ends
    // in a navigation anyway. The disabled state is the whole signal — and it
    // is one this button did not have before, so a double-tap on a slow
    // connection can no longer send the delete twice.
    const res = await submitAction(() => actions.goals.remove({ id }), {
      button: deleteBtn,
      onError: showError,
    });
    if (!res.ok) return;
    location.href = '/admin/agenda/goals';
  });
}

// ── the status control in the goal page header ──────────────────────────────
// One tap, no dialog, and NO CONFIRM ON "Let go": it is reversible and destroys
// nothing, so a confirm would charge a click for nothing and dress a dignified
// decision as a dangerous one.
const header = document.querySelector<HTMLElement>('[data-goal]');
if (header) {
  const goalId = header.dataset.goal!;
  const buttons = Array.from(header.querySelectorAll<HTMLButtonElement>('[data-status]'));

  buttons.forEach((btn) =>
    btn.addEventListener('click', async () => {
      const status = btn.dataset.status as 'active' | 'paused' | 'achieved' | 'let_go';
      if (btn.getAttribute('aria-pressed') === 'true') return;
      showPageError(null);

      const previous = buttons.find((b) => b.getAttribute('aria-pressed') === 'true');
      buttons.forEach((b) => (b.disabled = true));
      // Move first: the whole point of a segmented control is that it answers
      // instantly. It goes back if the server refuses.
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));

      // ⚠ NOT `submitAction`: the control here is a GROUP of four buttons that
      // go down and come back together, and the state being restored is
      // `aria-pressed` rather than a label. `callAction` is the half that
      // transfers — it puts a thrown dead network and a returned refusal on the
      // same line, so the cap's sentence and "you're offline" arrive the same
      // way.
      const { error } = await callAction(actions.goals.setStatus({ id: goalId, status }));
      buttons.forEach((b) => (b.disabled = false));
      if (error) {
        buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === previous)));
        showPageError(formatActionError(error));
      }
    }),
  );

  // ── the pin, beside it ────────────────────────────────────────────────────
  // Same shape as the status control and for the same reason: one tap, moves
  // first, goes back if the server refuses. No confirm — pinning destroys
  // nothing, and unpinning is the same button again.
  //
  // ⚠ IT DOES NOT RELOAD, though pinning a second goal silently unpins another
  // one somewhere else. Reloading to show that would cost the whole page to
  // report a change to a row that is not on it, and the honest place for that
  // fact is the goals room, which already draws the pin on whichever card holds
  // it. What this page owes you is that ITS button is right, which it is.
  const pin = header.querySelector<HTMLButtonElement>('[data-pin]');
  pin?.addEventListener('click', async () => {
    const next = pin.getAttribute('aria-pressed') !== 'true';
    showPageError(null);
    pin.disabled = true;
    pin.setAttribute('aria-pressed', String(next));

    const { error } = await callAction(actions.goals.setPinned({ id: goalId, pinned: next }));
    pin.disabled = false;
    if (error) {
      pin.setAttribute('aria-pressed', String(!next));
      showPageError(formatActionError(error));
      return;
    }
    const label = next ? 'Take this off the Morning card' : 'Keep this on the Morning card';
    pin.setAttribute('aria-label', label);
    pin.title = label;
  });
}
