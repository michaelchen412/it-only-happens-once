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
import { formatActionError } from './action-error';

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
  const errorEl = document.querySelector<HTMLElement>('#goal-sheet-error');
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const submitLabel = submitBtn.textContent ?? 'Save';
  const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]')!;
  const whyInput = form.querySelector<HTMLTextAreaElement>('textarea[name="why"]')!;

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
      sheet.showModal();
      nameInput.focus();
    }),
  );
  form.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => sheet.close()));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(null);
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      const { data, error } = await actions.goals.save({
        id: form.dataset.id || undefined,
        name: nameInput.value.trim(),
        why: whyInput.value.trim(),
        horizon: picked('horizon', 'this_year') as 'this_season' | 'this_year' | 'next_few_years',
        status: picked('goalStatus', 'active') as 'active' | 'paused' | 'achieved' | 'let_go',
      });
      if (error) throw new Error(error.message);
      // A new goal goes to its own page; an edit reloads the one you are on.
      // Both re-derive the observation line rather than patching it, since it
      // is a function of rows this form did not touch.
      if (!form.dataset.id && data) location.href = `/admin/agenda/goals/${data.slug}`;
      else location.reload();
    } catch (err) {
      // ⚠ `astro:actions` THROWS on a dead network rather than returning
      // `{ error }` — without this the button sticks on "Saving…".
      showError(formatActionError(err));
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;
    }
  });

  form.querySelector<HTMLButtonElement>('[data-delete-goal]')?.addEventListener('click', async () => {
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
    try {
      const { error } = await actions.goals.remove({ id });
      if (error) throw new Error(error.message);
      location.href = '/admin/agenda/goals';
    } catch (err) {
      showError(formatActionError(err));
    }
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

      try {
        const { error } = await actions.goals.setStatus({ id: goalId, status });
        if (error) throw new Error(error.message);
      } catch (err) {
        buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === previous)));
        showPageError(formatActionError(err));
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    }),
  );
}
