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
import { submitAction } from './action-error';
import { confirmDiscard, dirtyTracker, wireSheetDismiss } from './sheet-dismiss';
import { sheetError } from './sheet-error';
import { mountKindBar, showFrom, timeValue, type FilingDetail } from './kind-bar';

const sheet = document.querySelector<HTMLDialogElement>('#event-sheet');
const form = document.querySelector<HTMLFormElement>('#event-form');

if (sheet && form) {
  /** Every gesture that leaves this sheet routes through `requestClose` below. */
  const dirty = dirtyTracker(sheet);

  // BY ROLE, NOT BY THE NAME SOMEBODY GAVE IT (plan 29 · §6 + plan 38 · §3).
  // Twenty distinct element ids existed for this one job across the admin, which
  // is the reason there were 35 copies of the markup — every new sheet had to
  // mint a twenty-first. `SheetError.astro` owns the markup and this finds it
  // without needing to know what it is called.
  const errorEl = sheetError(sheet);
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
    const names = checks()
      .filter((c) => c.checked)
      .map((c) => c.dataset.name!);
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

  /**
   * The brain dump this event is being made out of (14 · Piece 3). Null
   * everywhere else, which leaves the Agenda room's behaviour — save, then
   * reload — exactly as 13 · Piece 4 shipped it.
   */
  let filingNote: string | null = null;

  /** Says which row this is, and offers the other one. See KindBar.astro. */
  // ⚠ CLOSE FIRST, THEN ANNOUNCE — see `mountKindBar`'s note. The pile answers
  // the switch by opening the task sheet, and a second `showModal()` stacks
  // instead of replacing: without this line "make it a task instead" left this
  // sheet sitting underneath, still holding the same sentence.
  const setKindBar = mountKindBar(form, (detail, to) => {
    sheet.close();
    document.dispatchEvent(new CustomEvent('hq:kind-switch', { detail: { ...detail, to } }));
  });

  const open = (row?: EventRow, on?: string) => {
    showError(null);
    if (row) fill(row);
    else {
      reset();
      // The day you are looking at, not today: pressing New while reading
      // August means an event in August.
      dateInput.value = on || (form.dataset.today ?? '');
    }
    dirty.reset(); // populating is not editing — see dirtyTracker
    sheet.showModal();
    titleInput.focus();
  };

  document
    .querySelectorAll<HTMLElement>('[data-open-event-sheet]')
    .forEach((btn) => btn.addEventListener('click', () => open(undefined, btn.dataset.openEventSheet)));

  /**
   * Opened from the notes room, with a dump already read into fields.
   *
   * ⚠ WHAT AN EVENT CANNOT HOLD IS DROPPED BEFORE IT GETS HERE: `parse-task.ts`
   * forces the kind back to `task` whenever a repeat or a lead is present,
   * because `events` has neither column. So this handler never has to decide
   * what to do with a recurrence — it cannot receive one.
   */
  document.addEventListener('hq:event-open', (e) => {
    const detail = (e as CustomEvent<FilingDetail>).detail;
    open();
    filingNote = detail.noteId;
    heading.textContent = 'Make an event';

    const p = detail.parsed;
    const [first, ...rest] = detail.text.split('\n');
    titleInput.value = (p?.title ?? first.trim()).slice(0, 200);
    notesInput.value = (p?.notes ?? rest.join('\n')).trim();
    if (p) {
      dateInput.value = p.due_on?.value ?? form.dataset.today ?? '';
      startInput.value = timeValue(p.due_time);
      showFrom(form, 'due_on', p.due_on);
      showFrom(form, 'due_time', p.due_time);
      syncAllDay();
    }
    setKindBar(detail);
    titleInput.select();
  });

  // Delegated: the day panel is server-rendered per request, so a listener per
  // row would need rebinding on every navigation.
  document.addEventListener('click', (e) => {
    const trigger = (e.target as Element).closest<HTMLElement>('[data-edit-event]');
    if (!trigger) return;
    const raw = trigger.closest<HTMLElement>('[data-event]')?.dataset.event;
    if (raw) open(JSON.parse(raw) as EventRow);
  });

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
    if (dirty.get() && !(await confirmDiscard('This event'))) return;
    dirty.reset();
    // `!` because a hoisted `async function` cannot inherit the narrowing
    // from the `if (sheet && …)` around it — the same reason this file already
    // writes `sheet!` at its other exits.
    sheet!.close();
  }
  wireSheetDismiss(sheet, requestClose);
  // Abandoning the sheet forgets the dump it was opened for — otherwise saving
  // an unrelated event later would consume a thought nobody filed.
  sheet.addEventListener('close', () => {
    filingNote = null;
    setKindBar(null);
  });
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
    // The disable/label/format/restore lifecycle is `submitAction` now
    // (docs/plans/25 · §2). `reusable`, because the notes-room ending below
    // CLOSES this sheet rather than replacing the page — and it is reopened for
    // the next dump, with the same button.
    const res = await submitAction(
      () =>
        actions.events.save({
          id: editing ?? undefined,
          title: titleInput.value.trim(),
          startsOn: dateInput.value,
          startsAt: startInput.value,
          endsAt: endInput.value,
          location: locationInput.value.trim(),
          notes: notesInput.value.trim(),
          personIds: checks()
            .filter((c) => c.checked)
            .map((c) => c.value),
        }),
      { button: submitBtn, busy: 'Saving…', onError: showError, reusable: true },
    );
    if (!res.ok) return;

    // ⚠ TWO ENDINGS, as the task sheet has. In the Agenda room: reload, since
    // which CELL a row lands in, the legend and the day panel are all
    // functions of the row that changed. In the notes room: don't — a reload
    // would throw away the pile's undo strip at the moment it has something
    // to offer, and nothing on that page is derived from this event.
    if (filingNote) {
      const noteId = filingNote;
      filingNote = null;
      sheet.close();
      document.dispatchEvent(
        new CustomEvent('hq:note-filed', {
          detail: { noteId, what: 'an event', href: '/admin/agenda', undo: { kind: 'event', id: res.data?.id } },
        }),
      );
      return;
    }
    location.reload();
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
    const id = editing; // captured: `editing` is a `let`, so the guard above
    // does not narrow it inside the callback below.
    const res = await submitAction(() => actions.events.remove({ id }), {
      button: deleteBtn,
      // The sheet is about to close on success, so a failure has to be visible
      // where the eye already is — and echoed on the page behind it, in case
      // the sheet goes anyway.
      onError: (m) => {
        showError(m);
        if (pageError) {
          pageError.textContent = 'Couldn’t delete that event.';
          pageError.hidden = false;
        }
      },
    });
    if (!res.ok) return;
    location.reload();
  });
}
