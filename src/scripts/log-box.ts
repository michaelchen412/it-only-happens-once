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
import { announceFiled } from './jot-arrival';
import { confirmDialog } from './confirm-dialog';
import { wireEntryMeta } from './entry-meta';
// Static, for the reason task-sheet.ts states at its own copy of this import.
import { mountMiniEditor } from './rich-editor';

const zone = document.querySelector<HTMLElement>('[data-timeline]');

if (zone) {
  const personId = zone.dataset.personId!;
  const today = zone.dataset.today!;

  const $ = <T extends HTMLElement>(sel: string) => zone.querySelector<T>(sel);
  const $$ = <T extends HTMLElement>(sel: string) => Array.from(zone.querySelectorAll<T>(sel));

  /**
   * The box — a mini editor since plan 43, storing the same Markdown.
   *
   * `breaks: false` MATCHES `.tl__body`, which renders entries with a bare
   * `renderMarkdown(e.body)`. Mounting at `true` would have shown a line break
   * the timeline then closed up — and note which way round the improvement
   * falls: the textarea used to display two lines where the row beneath it
   * displayed one, and the editor now agrees with the row.
   */
  const box = mountMiniEditor({
    editorEl: $<HTMLElement>('[data-log-input]')!,
    // The whole zone: the two `.tt-btn`s live down in the foot, not over the
    // box. `mountMiniEditor` takes ELEMENTS precisely so a caller can place its
    // toolbar wherever the surface wants it.
    toolbarRoot: zone,
    placeholder: 'What happened?',
    ariaLabel: `Log an entry about ${zone.dataset.personName ?? 'this person'}`,
    docClass: 'f-prose',
    breaks: false,
    onChange: () => syncControls(),
  });
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

  // `grow()` used to live here — height to `auto`, then back from
  // `scrollHeight`, on every keystroke. A contenteditable is as tall as its
  // content, so the function, its two callers and the `overflow: hidden` that
  // made the measurement possible are all deleted rather than ported.

  function syncControls() {
    // ⚠ `getText().trim()`, NOT `editor.isEmpty` — AND THE SPEC SAYS WHY.
    // "Whitespace alone is not something typed": a paragraph holding four
    // spaces is a real node, so `isEmpty` is FALSE for it and Save would have
    // appeared for a box containing nothing you meant. `.value.trim()` gave
    // this for free on the textarea; the editor has to be asked.
    const has = box.editor.getText().trim().length > 0;
    meta.hidden = !has && !editingId;
    saveBtn.hidden = !has && !editingId;
    cancelBtn.hidden = !editingId;
  }

  // ── writing, and correcting ──────────────────────────────────────────────
  function reset() {
    editingId = null;
    // `emitUpdate: false` — `onChange` calls `syncControls`, which runs on the
    // next line anyway; letting `setContent` fire it too would sync against a
    // half-reset box (`editingId` cleared, meta not yet).
    box.editor.commands.setContent('', { emitUpdate: false });
    entryMeta.reset();
    showError(null);
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
      box.editor.commands.setContent(row.dataset.body ?? '', { emitUpdate: false });
      entryMeta.set(
        row.dataset.entryOn!,
        row.dataset.entryKind!,
        (row.dataset.entryWith ?? '').split(',').filter(Boolean),
      );

      zone.querySelectorAll('.tl').forEach((r) => r.classList.toggle('is-editing', r === row));
      syncControls();
      box.editor.commands.focus('end');
    }),
  );

  saveBtn.addEventListener('click', async () => {
    const body = box.getMarkdown().trim();
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

    /*
      ⚠ THE JOT IS CONSUMED LAST, after the entry exists (plan 45 · Piece 3, on
      14 §10e's ordering). `announceFiled` reloads for us — and it is the same
      call the task and event sheets make, so the one rule about who cleans up
      after a filing has one implementation: the pile claims the event when it
      can do the job, and nothing claims it here, so the jot is trashed.

      Only on a NEW entry: correcting an existing one is not a filing, and
      `editingId` is what tells them apart.
    */
    const jotId = editingId ? null : zone.dataset.seedFrom;
    if (jotId) {
      delete zone.dataset.seedFrom;
      void announceFiled({
        noteId: jotId,
        what: 'an entry',
        href: null,
        undo: { kind: 'interaction', id: res.data?.id },
      });
      return;
    }

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

  /*
    A jot the ✚ sent here (plan 45 · Piece 3). The Log tab named this person and
    navigated; the words arrive with the page and go straight into the box.

    ⚠ NO PARSE, UNLIKE THE AGENDA'S ARRIVAL. There is nothing here for a model
    to read: what an entry needs beyond the words is a kind and a date, and both
    already have honest defaults sitting in the meta row — hangout, today. The
    agenda has to guess a date out of a sentence; this does not.

    ⚠ `from` IS SCRUBBED, or a refresh re-seeds the box from a jot the save has
    already consumed — and this box, unlike a dialog, is on screen the moment
    the page loads.
  */
  const seedBody = zone.dataset.seedBody;
  if (seedBody) {
    delete zone.dataset.seedBody;
    box.editor.commands.setContent(seedBody);
    box.editor.commands.focus('end');
    const url = new URL(window.location.href);
    url.searchParams.delete('from');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  // The initial paint. `grow()` used to lead here, sizing an empty textarea to
  // one line; the editor is already the height of its own content.
  syncControls();
}
