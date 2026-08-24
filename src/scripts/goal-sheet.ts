// Client logic for GoalSheet.astro, and the status control on the goal page
// (docs/plans/archive/13-agenda.md §4a).
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
import { options, pick, picked, wireRadioGroups } from './radio-group';
import { callAction, formatActionError, submitAction } from './action-error';
import { wireSheet } from './sheet';
// Static, for the reason task-sheet.ts states at its own copy of this import.
import { mountMiniEditor } from './rich-editor';

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
  /* The tracker, the error line and the three ways out are `wireSheet` now
     (plan 41 · §4). ⚠ Its `showError` is the SHEET's line; `showPageError`
     above is the goal page's own, shared with the status control below, and the
     two must not be confused — a failure written into the wrong one is a
     failure nobody sees. */
  const ui = wireSheet(sheet, { noun: 'This goal' });
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]')!;
  /**
   * The two prose fields, rich since plan 43. Storage is the same Markdown.
   *
   * ⚠ THE TWO TAKE OPPOSITE `breaks`, AND IT IS NOT AN OVERSIGHT. The goal page
   * renders a *why* with no `breaks` and its *notes* with `{ breaks: true }`,
   * on the reasoning written beside those two calls — a why is prose, notes are
   * lines. An editor whose newline behaviour disagreed with its own page would
   * show a break the page then closed up, so each is mounted to match the call
   * that reads it back. See `mountMiniEditor`'s `breaks`.
   *
   * The hidden inputs carry the SERVER value in; nothing reads them on the way
   * out. `wireSheet.open()` deliberately does not re-fill (there is one goal per
   * page and no row to switch between), so seeding once at mount is the whole
   * lifecycle — the same thing the textareas' server-rendered child text did.
   */
  const seed = (sel: string) => form.querySelector<HTMLInputElement>(sel)!.value;
  const why = mountMiniEditor({
    editorEl: document.getElementById('goal-why')!,
    toolbarRoot: document.getElementById('goal-why-wrap')!,
    placeholder: 'Not a number on a scale. Being able to do the Tahoe hike in September without hating it.',
    ariaLabel: 'Why',
    docClass: 'f-prose',
    breaks: false,
    onChange: () => ui.dirty.touch(),
  });
  const notes = mountMiniEditor({
    editorEl: document.getElementById('goal-notes')!,
    toolbarRoot: document.getElementById('goal-notes-wrap')!,
    placeholder:
      'What’s actually in it. Out of bed before the phone. Teeth, water, read the day. Twenty minutes moving — a walk counts.',
    ariaLabel: 'Notes',
    docClass: 'f-prose',
    // `lists: true` here and NOT on `why` above (plan 44). Same split as
    // `breaks`, decided the same way and for the same field: a why is prose, a
    // routine enumerates. Must stay in step with the `lists` prop on this
    // field's <MiniEditor> — the buttons and the nodes are two halves of one
    // decision, and either alone is a control that does nothing.
    lists: true,
    onChange: () => ui.dirty.touch(),
  });
  // `emitUpdate: false` — v3 fires `update` from `setContent`, which would arm
  // the exit guard on a sheet nobody has typed in.
  why.editor.commands.setContent(seed('[data-why-value]'), { emitUpdate: false });
  notes.editor.commands.setContent(seed('[data-notes-value]'), { emitUpdate: false });

  /*
    ⚠ THE SHEET NO LONGER EDITS STATUS AT ALL (plan 41 · §5a). The header's
    four-way control is the only one, and `goals.setStatus` is the only writer —
    so there is nothing here to go stale when a status changes behind the sheet,
    which is what sent Michael to a hard refresh on 2026-08-15.

    The control that used to sit here had never worked: it asked for
    `[data-goalStatus]` while the markup writes `data-goal-status`, so `picked`
    fell through to its fallback and editing a goal's NOTES set it back to
    active (`cdfbced`). Fixing the selector made it work and left the real
    problem — two controls for one fact — standing.
  */
  options(form, 'horizon').forEach((b) =>
    b.addEventListener('click', () => pick(form, 'horizon', b.getAttribute('data-horizon')!)),
  );

  document.querySelectorAll<HTMLElement>('[data-open-goal-sheet], [data-edit-goal]').forEach((btn) =>
    btn.addEventListener('click', () => {
      ui.open(); // clears the error and forgets the fill — see `Sheet.open`
      nameInput.focus();
    }),
  );

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
    ui.showError(null);
    const res = await submitAction(
      () =>
        actions.goals.save({
          id: form.dataset.id || undefined,
          name: nameInput.value.trim(),
          why: why.getMarkdown().trim(),
          notes: notes.getMarkdown().trim(),
          horizon: picked(form, 'horizon', 'this_year') as 'this_season' | 'this_year' | 'next_few_years',
        }),
      { button: submitBtn, busy: 'Saving…', onError: ui.showError },
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
    // A real confirm, unlike letting go: this one cannot be undone.
    //
    // ⚠ AND IT NOW SAYS SO ON SCREEN (plan 42 · §4.A.1). That clause used to
    // live in this comment ALONE while the message carried only the reassuring
    // half — so the fact the reader most needed was the one fact the code knew
    // and the interface withheld. The sentence still names what survives first,
    // because that is the actual question; irreversibility follows it.
    const ok = await confirmDialog({
      title: 'Delete this goal?',
      message: 'The tasks filed under it stay, and what you did toward it stays done. This cannot be undone.',
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
      onError: ui.showError,
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
      if (btn.getAttribute('aria-checked') === 'true') return;
      showPageError(null);

      const previous = buttons.find((b) => b.getAttribute('aria-checked') === 'true');
      buttons.forEach((b) => (b.disabled = true));
      // Move first: the whole point of a segmented control is that it answers
      // instantly. It goes back if the server refuses.
      buttons.forEach((b) => b.setAttribute('aria-checked', String(b === btn)));

      // ⚠ NOT `submitAction`: the control here is a GROUP of four buttons that
      // go down and come back together, and the state being restored is
      // `aria-checked` rather than a label. `callAction` is the half that
      // transfers — it puts a thrown dead network and a returned refusal on the
      // same line, so the cap's sentence and "you're offline" arrive the same
      // way.
      const { error } = await callAction(actions.goals.setStatus({ id: goalId, status }));
      buttons.forEach((b) => (b.disabled = false));
      if (error) {
        buttons.forEach((b) => b.setAttribute('aria-checked', String(b === previous)));
        showPageError(formatActionError(error));
      }
    }),
  );

  // ── the pin, beside it ────────────────────────────────────────────────────
  // ⚠ IT KEEPS `aria-pressed` WHILE THE STATUS GROUP ABOVE MOVED TO
  // `aria-checked` (plan 38 · §6.3), and the difference is the whole distinction
  // that change was about: status is a CHOICE between four exclusive options, and
  // the pin is one switch that is either on or off. Sweeping this to
  // `aria-checked` for symmetry would announce a lone checkbox as a radio with
  // no group.
  //
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

// The role promises arrow keys and one tab stop; this is what keeps it
// (plan 38 · §6.3). Idempotent — every group is wired exactly once.
wireRadioGroups();
