// Client logic for EventSheet.astro (docs/plans/13-agenda.md §5).
//
// ONE SHEET, MANY EVENTS — so the row carries its own JSON and this fills the
// form on open, the same arrangement TaskSheet uses and for the same reason: a
// month grid holds dozens of rows and a dialog per row would be absurd. The row
// serialises its COLUMNS rather than what it happens to be displaying, so the
// form and the row cannot disagree.
//
// The DOM is the state: the checked boxes ARE the guest list, and the date input
// is the date. There is no JavaScript copy of the form beside the form.
import { actions } from 'astro:actions';

const sheet = document.querySelector<HTMLDialogElement>('#event-sheet');
const form = document.querySelector<HTMLFormElement>('#event-form');

if (sheet && form) {
  const errorEl = document.querySelector<HTMLElement>('#event-sheet-error');
  const pageError = document.querySelector<HTMLElement>('[data-event-error]');
  const heading = document.querySelector<HTMLElement>('#event-sheet-title')!;
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const deleteBtn = form.querySelector<HTMLButtonElement>('[data-delete-event]')!;
  const titleInput = form.querySelector<HTMLInputElement>('input[name="title"]')!;
  const dateInput = form.querySelector<HTMLInputElement>('[data-starts-on]')!;
  const startInput = form.querySelector<HTMLInputElement>('[data-starts-at]')!;
  const endInput = form.querySelector<HTMLInputElement>('[data-ends-at]')!;
  const locationInput = form.querySelector<HTMLInputElement>('input[name="location"]')!;
  const notesInput = form.querySelector<HTMLTextAreaElement>('textarea[name="notes"]')!;
  const allDay = form.querySelector<HTMLElement>('[data-all-day]')!;
  const whoEl = form.querySelector<HTMLElement>('[data-who]');
  const checks = () => Array.from(form.querySelectorAll<HTMLInputElement>('.ep-check'));

  interface EventRow {
    id: string;
    title: string;
    starts_on: string;
    starts_at: string | null;
    ends_at: string | null;
    location: string | null;
    notes: string | null;
    person_ids: string[];
  }

  let editing: string | null = null;

  const showError = (message: string | null) => {
    if (!errorEl) return;
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
  };

  /** `all day` beside the empty time — one word, in place, never a sentence. */
  const syncAllDay = () => {
    allDay.hidden = !!startInput.value;
    // An end with no beginning is not a time anybody can act on, so the field
    // simply is not offered until there is one.
    endInput.disabled = !startInput.value;
    if (!startInput.value) endInput.value = '';
  };

  /** The summary line, so the closed state still tells you who is coming. */
  const syncWho = () => {
    if (!whoEl) return;
    const names = checks().filter((c) => c.checked).map((c) => c.dataset.name!);
    whoEl.textContent = names.length === 0 ? 'nobody' : names.length <= 3 ? names.join(', ') : `${names.length} people`;
  };

  const reset = () => {
    editing = null;
    form.reset();
    titleInput.value = '';
    startInput.value = '';
    endInput.value = '';
    locationInput.value = '';
    notesInput.value = '';
    checks().forEach((c) => (c.checked = false));
    heading.textContent = 'New event';
    submitBtn.textContent = 'Add event';
    deleteBtn.hidden = true;
    syncAllDay();
    syncWho();
  };

  const fill = (row: EventRow) => {
    reset();
    editing = row.id;
    titleInput.value = row.title;
    dateInput.value = row.starts_on;
    startInput.value = row.starts_at ? row.starts_at.slice(0, 5) : '';
    endInput.value = row.ends_at ? row.ends_at.slice(0, 5) : '';
    locationInput.value = row.location ?? '';
    notesInput.value = row.notes ?? '';
    const on = new Set(row.person_ids);
    checks().forEach((c) => (c.checked = on.has(c.value)));
    heading.textContent = 'Edit event';
    submitBtn.textContent = 'Save';
    deleteBtn.hidden = false;
    syncAllDay();
    syncWho();
  };

  const open = (row?: EventRow, on?: string) => {
    showError(null);
    if (row) fill(row);
    else {
      reset();
      // The day you are looking at, not today: pressing New while reading
      // August means an event in August.
      dateInput.value = on || (form.dataset.today ?? '');
    }
    sheet.showModal();
    titleInput.focus();
  };

  document.querySelectorAll<HTMLElement>('[data-open-event-sheet]').forEach((btn) =>
    btn.addEventListener('click', () => open(undefined, btn.dataset.openEventSheet)),
  );

  // Delegated: the day panel is server-rendered per request, so a listener per
  // row would need rebinding on every navigation.
  document.addEventListener('click', (e) => {
    const trigger = (e.target as Element).closest<HTMLElement>('[data-edit-event]');
    if (!trigger) return;
    const raw = trigger.closest<HTMLElement>('[data-event]')?.dataset.event;
    if (raw) open(JSON.parse(raw) as EventRow);
  });

  form.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => sheet.close()));
  startInput.addEventListener('input', syncAllDay);
  form.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).classList.contains('ep-check')) syncWho();
  });

  // The filter, when the roster is long enough to need one.
  form.querySelector<HTMLInputElement>('.sby-filter')?.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
    form.querySelectorAll<HTMLElement>('.sby__row').forEach((row) => {
      row.hidden = !!q && !(row.dataset.search ?? '').includes(q);
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(null);
    submitBtn.disabled = true;
    const label = submitBtn.textContent;
    submitBtn.textContent = 'Saving…';

    try {
      const { error } = await actions.events.save({
        id: editing ?? undefined,
        title: titleInput.value.trim(),
        startsOn: dateInput.value,
        startsAt: startInput.value,
        endsAt: endInput.value,
        location: locationInput.value.trim(),
        notes: notesInput.value.trim(),
        personIds: checks().filter((c) => c.checked).map((c) => c.value),
      });
      if (error) throw new Error(error.message);
      // Reload rather than patching: which CELL a row lands in, the legend, and
      // the day panel are all functions of the row that just changed.
      location.reload();
    } catch (err) {
      // ⚠ `astro:actions` THROWS on a dead network rather than returning
      // `{ error }` — without this the button sticks on "Saving…".
      showError(err instanceof Error ? err.message : 'Couldn’t save that — check your connection.');
      submitBtn.disabled = false;
      submitBtn.textContent = label;
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!editing) return;
    const { confirmDialog } = await import('./confirm-dialog');
    const ok = await confirmDialog({
      title: 'Delete this event?',
      message: 'Its person tags go with it.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    deleteBtn.disabled = true;
    try {
      const { error } = await actions.events.remove({ id: editing });
      if (error) throw new Error(error.message);
      location.reload();
    } catch (err) {
      // The sheet is about to close on success, so a failure has to be visible
      // where the eye already is.
      showError(err instanceof Error ? err.message : 'Couldn’t delete that — check your connection.');
      if (pageError) {
        pageError.textContent = 'Couldn’t delete that event.';
        pageError.hidden = false;
      }
      deleteBtn.disabled = false;
    }
  });
}
