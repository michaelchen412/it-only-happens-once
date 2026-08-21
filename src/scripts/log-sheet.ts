// Client logic for LogSheet.astro — a brain dump becoming a log entry
// (14 · Piece 2).
//
// THE DOM IS THE STATE, as in the profile's log box: the kind lives in the
// chip's `is-on` row, the date in its label, the people in the picker's ticks.
// There is no JavaScript copy of the entry beside the entry.
//
// ⚠ IT ANNOUNCES RATHER THAN TIDIES. On a successful save this dispatches
// `hq:note-filed` and stops. Removing the card, consuming the note and offering
// the way back all belong to the pile (`notes.ts`), which owns those things for
// every motion — so there is exactly one implementation of "a dump left the
// pile" rather than one per destination.
import { actions } from 'astro:actions';
import { submitAction } from './action-error';
import { wireEntryMeta } from './entry-meta';
// Static, for the reason task-sheet.ts states at its own copy of this import.
import { mountMiniEditor } from './rich-editor';
import { closeWithExit, openDialog } from './dialog-close';
import { wireSheetDismiss } from './sheet-dismiss';

const root = document.querySelector<HTMLElement>('[data-log-sheet]');
const sheet = document.getElementById('log-sheet') as HTMLDialogElement | null;

if (root && sheet) {
  const today = root.dataset.today!;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);

  /**
   * The box — a mini editor since plan 43, matching the profile's timeline box
   * exactly, including `breaks: false` to agree with `.tl__body`'s renderer.
   *
   * ⚠ THE DUMP ARRIVES AS MARKDOWN AND IS PARSED, NOT PASTED AS CHARACTERS.
   * `hq:log-open` hands over the note's own text, which the pile stores as
   * Markdown — so `setContent` renders whatever marks it already carried rather
   * than showing you its asterisks, which is the entire point of the change.
   */
  const box = mountMiniEditor({
    editorEl: $<HTMLElement>('[data-log-body]')!,
    // The sheet root: the `.tt-btn`s are down in the foot, not over the box.
    toolbarRoot: root,
    placeholder: 'What happened?',
    ariaLabel: 'What happened?',
    docClass: 'f-prose',
    breaks: false,
    onChange: () => syncSave(),
  });
  const saveBtn = $<HTMLButtonElement>('[data-log-save]')!;
  const errorEl = $<HTMLElement>('[data-log-error]')!;

  /** The dump being filed. Null when the sheet is not open for one. */
  let noteId: string | null = null;

  function showError(msg: string | null) {
    errorEl.textContent = msg ?? '';
    errorEl.hidden = !msg;
  }

  /**
   * The one required field, enforced by the control rather than by a sentence.
   *
   * ⚠ It is the reason `wireEntryMeta` takes an `onPeopleChange` at all: the
   * profile's log box has no such rule (a profile already knows whose entry
   * this is), so the gate belongs to this host rather than to the shared
   * wiring. The body has to re-run it too — Save depends on both.
   */
  const syncSave = () => {
    // `getText().trim()` rather than `isEmpty`: a paragraph of spaces is a real
    // node, so `isEmpty` is false for a box holding nothing you meant. See the
    // fuller note at the same line in `log-box.ts`.
    saveBtn.disabled = meta.people().length === 0 || box.editor.getText().trim().length === 0;
  };

  // Kind, date and who are `entry-meta.ts` now — the same wiring the profile's
  // log box runs (docs/plans/25 · §3). The picker here is "who" and it leads,
  // because a dump has no subject at all until you name one; on a profile the
  // same control says "with" and only adds others.
  const meta = wireEntryMeta(root, {
    today,
    peopleAttr: 'who',
    peopleLabel: (names) =>
      names.length === 0 ? 'Who?' : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`,
    onPeopleChange: syncSave,
  });

  // ── opening ───────────────────────────────────────────────────────────────
  function reset() {
    meta.reset(); // which ends in `syncSave`, via onPeopleChange
    showError(null);
  }

  /** Opened by the pile's chooser, with the dump's words already in the box. */
  document.addEventListener('hq:log-open', (e) => {
    const detail = (e as CustomEvent<{ noteId: string; text: string }>).detail;
    noteId = detail.noteId;
    reset();
    // `emitUpdate: false` — `syncSave` runs explicitly on the next line, and
    // letting `setContent` fire `onChange` too would just run it twice.
    box.editor.commands.setContent(detail.text, { emitUpdate: false });
    syncSave(); // the words arrived after `reset` ran; Save depends on them
    openDialog(sheet!);
    // NOT focusing the box: the words are already there, and the thing
    // still missing is who it was about.
    $<HTMLElement>('[data-who-open]')?.focus();
  });

  // The press must both start and end on the backdrop: this sheet opens with a
  // dump's words already in the textarea and expects you to edit them, so a
  // selection released past the edge was closing it over a half-made
  // correction. `backdrop-close.ts` (docs/plans/25 · §3).
  // ✕, Escape and the backdrop, in one call (ADR 0032).
  //
  // ⚠ NO GUARD, and it is worth saying why rather than leaving it to look like
  // an oversight: this sheet is opened FROM a captured note and files it. The
  // body it holds is the note's own text, which already exists in the pile and
  // survives dismissal — so there is nothing here that only lives on screen.
  wireSheetDismiss(sheet, () => void closeWithExit(sheet));

  // ── saving ────────────────────────────────────────────────────────────────
  saveBtn.addEventListener('click', async () => {
    const [personId, ...withIds] = meta.people();
    if (!personId || !box.getMarkdown().trim() || !noteId) return;
    const filing = noteId;
    showError(null);

    // The disable/label/format/restore lifecycle is `submitAction` now
    // (docs/plans/25 · §2). `reusable`, because this sheet is closed and
    // reopened for the next dump rather than replaced by a navigation.
    const res = await submitAction(
      () =>
        // `personId` is "whose profile this was logged from" — from the pile
        // there is no profile, so the first person picked stands in. The action
        // makes every id a participant either way, so which one leads changes
        // nothing about the row.
        actions.interactions.save({
          personId,
          withIds,
          occurredOn: meta.occurredOn(),
          kind: (meta.kind() ?? 'hangout') as 'hangout',
          body: box.getMarkdown().trim(),
        }),
      { button: saveBtn, busy: 'Saving…', onError: showError, reusable: true },
    );
    if (!res.ok) return;
    if (!res.data) return showError('Couldn’t save that.');

    void closeWithExit(sheet!);
    document.dispatchEvent(
      new CustomEvent('hq:note-filed', {
        detail: { noteId: filing, what: 'a log entry', href: null, undo: { kind: 'interaction', id: res.data.id } },
      }),
    );
    noteId = null;
  });
}
