// Client logic for TimelineZone.astro — the log box (12 · Piece 2).
//
// THE DOM IS THE STATE, as everywhere else in HQ: the kind lives in the chip's
// `is-on` row, the date in its label, the participants in the picker's ticks.
// There is no JavaScript copy of the entry beside the entry.
//
// ONE EDITOR, TWO JOBS. Editing an existing entry loads it back into the same
// box rather than opening a second one. A profile with two places to type is a
// profile where you have to decide which one to use, and the box is meant to
// cost fifteen seconds.
//
// AND SAVING IS EXPLICIT, unlike the check-in. That surface autosaves because it
// is one row per day that you return to; an entry is a discrete thing you
// finish, and a debounce would mean a half-typed sentence became a row every
// time the phone locked.
import { actions } from 'astro:actions';
import { submitAction } from './action-error';
import { confirmDialog } from './confirm-dialog';
import { wireEntryMeta } from './entry-meta';

const zone = document.querySelector<HTMLElement>('[data-timeline]');

if (zone) {
  const personId = zone.dataset.personId!;
  const today = zone.dataset.today!;

  const $ = <T extends HTMLElement>(sel: string) => zone.querySelector<T>(sel);
  const $$ = <T extends HTMLElement>(sel: string) => Array.from(zone.querySelectorAll<T>(sel));

  const input = $<HTMLTextAreaElement>('[data-log-input]')!;
  const meta = $<HTMLElement>('[data-log-meta]')!;
  const saveBtn = $<HTMLButtonElement>('[data-log-save]')!;
  const cancelBtn = $<HTMLButtonElement>('[data-log-cancel]')!;
  const errorEl = $<HTMLElement>('[data-log-error]')!;
  /** The entry being corrected, or null when writing a new one. */
  let editingId: string | null = null;

  // Kind, date and who are `entry-meta.ts` now — the same wiring the notes
  // pile's log sheet runs (docs/plans/25 · §3). The picker here is "with",
  // because a profile already knows whose entry this is and these are the
  // OTHERS; in the pile the same control asks "Who?" and is required. That
  // difference is the whole of what the two hosts still configure.
  //
  // ⚠ It also retires a local `shiftYmd` that used to sit here — five untested
  // lines beside the tested one in `lib/hq/time.ts`, and the drift that made
  // this extraction earn itself.
  const entryMeta = wireEntryMeta(zone, {
    today,
    peopleAttr: 'with',
    peopleLabel: (names) =>
      names.length === 0 ? 'with' : names.length === 1 ? `with ${names[0]}` : `with ${names[0]} +${names.length - 1}`,
  });

  function showError(message: string | null) {
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
  }

  /** One line until there are two. Reset first, or it can only ever grow. */
  function grow() {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }

  function syncControls() {
    const has = input.value.trim().length > 0;
    meta.hidden = !has && !editingId;
    saveBtn.hidden = !has && !editingId;
    cancelBtn.hidden = !editingId;
  }

  input.addEventListener('input', () => {
    grow();
    syncControls();
  });

  // ── writing, and correcting ──────────────────────────────────────────────
  function reset() {
    editingId = null;
    input.value = '';
    entryMeta.reset();
    showError(null);
    grow();
    syncControls();
  }

  cancelBtn.addEventListener('click', () => {
    reset();
    zone.querySelectorAll('.tl').forEach((r) => r.classList.remove('is-editing'));
  });

  $$<HTMLButtonElement>('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const row = btn.closest<HTMLElement>('.tl')!;
      reset();
      editingId = row.dataset.entry!;
      input.value = row.dataset.body ?? '';
      entryMeta.set(
        row.dataset.entryOn!,
        row.dataset.entryKind!,
        (row.dataset.entryWith ?? '').split(',').filter(Boolean),
      );

      zone.querySelectorAll('.tl').forEach((r) => r.classList.toggle('is-editing', r === row));
      grow();
      syncControls();
      input.focus();
    }),
  );

  saveBtn.addEventListener('click', async () => {
    const body = input.value.trim();
    if (!body) return;
    showError(null);
    // The disable/label/format/restore lifecycle is `submitAction` now
    // (docs/plans/25 · §2) — including the trap it was built around: a dead
    // network THROWS rather than returning `{ error }`, which is what once left
    // a button stuck on "Thinking…" for the life of the page.
    const res = await submitAction(
      () =>
        actions.interactions.save({
          id: editingId ?? undefined,
          personId,
          withIds: entryMeta.people(),
          occurredOn: entryMeta.occurredOn(),
          kind: entryMeta.kind() as never,
          body,
        }),
      { button: saveBtn, busy: 'Saving…', onError: showError },
    );
    if (!res.ok) return;
    // Reload rather than patching: the count, the ordering, the last-contact
    // fact in the header and the card on the roster are all functions of the
    // row that just changed, and re-deriving four of them by hand is four
    // chances to disagree with the database.
    location.reload();
  });

  $$<HTMLButtonElement>('[data-delete]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const row = btn.closest<HTMLElement>('.tl')!;
      const ok = await confirmDialog({
        title: 'Delete this entry?',
        message: 'It is removed for good — there is no trash for log entries.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;

      // Was a bare await with `error.message` straight onto the screen — so a
      // dead network both skipped this branch entirely (it throws) and, when it
      // did return, printed `Failed to fetch` at a human.
      const res = await submitAction(() => actions.interactions.remove({ id: row.dataset.entry! }), {
        button: btn,
        onError: showError,
      });
      if (!res.ok) return;
      location.reload();
    }),
  );

  grow();
  syncControls();
}
