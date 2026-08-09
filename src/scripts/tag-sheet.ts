// Client logic for TagSheet.astro (13 · Piece 3).
//
// The row carries its own subject and its current guest list as data
// attributes, the same arrangement TaskSheet and EventSheet use — a day panel
// holds several rows and a dialog per row would be absurd.
//
// ⚠ THE SUBJECT IS A SERIES ID, NEVER AN INSTANCE ID. The page resolves that
// server-side (`external_events.series_id`), so the browser never sees the
// distinction and cannot get it wrong — the same trick the tasks room plays
// with RRULEs, where the client only ever handles a preset.
import { actions } from 'astro:actions';
import { submitAction } from './action-error';

const sheet = document.querySelector<HTMLDialogElement>('#tag-sheet');
const form = document.querySelector<HTMLFormElement>('#tag-form');

if (sheet && form) {
  const errorEl = document.querySelector<HTMLElement>('#tag-sheet-error');
  const titleEl = form.querySelector<HTMLElement>('[data-tag-title]')!;
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const checks = () => Array.from(form.querySelectorAll<HTMLInputElement>('.tag-check'));

  let subject: string | null = null;

  const showError = (message: string | null) => {
    if (!errorEl) return;
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
  };

  // Delegated: the day panel is server-rendered per request, so a listener per
  // row would need rebinding on every navigation.
  document.addEventListener('click', (e) => {
    const trigger = (e.target as Element).closest<HTMLElement>('[data-tag]');
    if (!trigger) return;
    subject = trigger.dataset.tag ?? null;
    if (!subject) return;

    showError(null);
    titleEl.textContent = trigger.dataset.tagTitle ?? '';
    const on = new Set((trigger.dataset.tagPeople ?? '').split(',').filter(Boolean));
    checks().forEach((c) => (c.checked = on.has(c.value)));
    sheet.showModal();
  });

  form.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => sheet.close()));

  form.querySelector<HTMLInputElement>('.sby-filter')?.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
    form.querySelectorAll<HTMLElement>('.sby__row').forEach((row) => {
      row.hidden = !!q && !(row.dataset.search ?? '').includes(q);
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!subject) return;
    showError(null);
    const externalId = subject; // captured: `subject` is a `let`, so the guard
    // above does not narrow it inside the callback below.
    // The disable/await/format/restore lifecycle is `submitAction` now
    // (docs/plans/25 · §2). NO `busy` LABEL HERE, deliberately: this is the one
    // Save in the set that holds an `<Icon>` beside its word, and `busy` writes
    // `textContent`, which would delete the glyph and never bring it back. The
    // disabled state carries the whole message instead.
    const res = await submitAction(
      () =>
        actions.events.tag({
          externalId,
          personIds: checks()
            .filter((c) => c.checked)
            .map((c) => c.value),
        }),
      { button: submitBtn, onError: showError },
    );
    if (!res.ok) return;
    // Reload rather than patching: tagging somebody changes the day panel,
    // the People zone's brief, and the drift guard — three surfaces, one of
    // which is on another page.
    location.reload();
  });
}
