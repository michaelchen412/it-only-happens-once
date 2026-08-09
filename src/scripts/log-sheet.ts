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
import { onBackdropDismiss } from './backdrop-close';

const root = document.querySelector<HTMLElement>('[data-log-sheet]');
const sheet = document.getElementById('log-sheet') as HTMLDialogElement | null;

if (root && sheet) {
  const today = root.dataset.today!;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const $$ = <T extends HTMLElement>(sel: string) => Array.from(root.querySelectorAll<T>(sel));

  const body = $<HTMLTextAreaElement>('[data-log-body]')!;
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
    saveBtn.disabled = meta.people().length === 0 || !body.value.trim();
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

  body.addEventListener('input', syncSave);

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
    body.value = detail.text;
    syncSave(); // the words arrived after `reset` ran; Save depends on them
    sheet!.showModal();
    // NOT focusing the textarea: the words are already there, and the thing
    // still missing is who it was about.
    $<HTMLElement>('[data-who-open]')?.focus();
  });

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => sheet.close()));
  // The press must both start and end on the backdrop: this sheet opens with a
  // dump's words already in the textarea and expects you to edit them, so a
  // selection released past the edge was closing it over a half-made
  // correction. `backdrop-close.ts` (docs/plans/25 · §3).
  onBackdropDismiss(sheet, () => sheet.close());

  // ── saving ────────────────────────────────────────────────────────────────
  saveBtn.addEventListener('click', async () => {
    const [personId, ...withIds] = meta.people();
    if (!personId || !body.value.trim() || !noteId) return;
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
          body: body.value.trim(),
        }),
      { button: saveBtn, busy: 'Saving…', onError: showError, reusable: true },
    );
    if (!res.ok) return;
    if (!res.data) return showError('Couldn’t save that.');

    sheet!.close();
    document.dispatchEvent(
      new CustomEvent('hq:note-filed', {
        detail: { noteId: filing, what: 'a log entry', href: null, undo: { kind: 'interaction', id: res.data.id } },
      }),
    );
    noteId = null;
  });
}
