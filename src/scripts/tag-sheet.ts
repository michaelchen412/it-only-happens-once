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
import { wireSheet } from './sheet';
import { wireFilterFields } from './filter-field';

const sheet = document.querySelector<HTMLDialogElement>('#tag-sheet');
const form = document.querySelector<HTMLFormElement>('#tag-form');

if (sheet && form) {
  /*
    The dirty tracker, the error line, the three ways out and the discard
    confirm are all `wireSheet` now (plan 41 · §4). It GUARDS because it has
    something to lose: an explicit-save form holds everything ticked into it
    until the button is pressed, and the confirm cannot fire on a sheet nobody
    edited because `open()` resets the tracker after every populate.
  */
  const ui = wireSheet(sheet, { noun: 'This' });
  const titleEl = form.querySelector<HTMLElement>('[data-tag-title]')!;
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const checks = () => Array.from(form.querySelectorAll<HTMLInputElement>('.tag-check'));

  let subject: string | null = null;

  // Delegated: the day panel is server-rendered per request, so a listener per
  // row would need rebinding on every navigation.
  document.addEventListener('click', (e) => {
    const trigger = (e.target as Element).closest<HTMLElement>('[data-tag]');
    if (!trigger) return;
    subject = trigger.dataset.tag ?? null;
    if (!subject) return;

    titleEl.textContent = trigger.dataset.tagTitle ?? '';
    const on = new Set((trigger.dataset.tagPeople ?? '').split(',').filter(Boolean));
    checks().forEach((c) => (c.checked = on.has(c.value)));
    ui.open(); // populate first — `open` clears the error and forgets the fill
  });

  // The pass is `filter-field.ts` now (plan 42 · §4.B.2) — these six lines
  // existed here, in `event-sheet.ts` and in `tag-sheet.ts`, byte for byte, and
  // all three were missing the no-match line the fourth copy had.
  wireFilterFields(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!subject) return;
    ui.showError(null);
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
      { button: submitBtn, onError: ui.showError },
    );
    if (!res.ok) return;
    // Reload rather than patching: tagging somebody changes the day panel,
    // the People zone's brief, and the drift guard — three surfaces, one of
    // which is on another page.
    location.reload();
  });
}
