// The composer's publish / details dialog (docs/plans/06) — the preflight, the
// AI subject suggester, and the one confirm button that serves both modes.
//
// Split out of writing-sheet.ts on 2026-08-07 (quality audit). It is a separate
// SURFACE, not merely a separate section: a modal over the drawer, with its own
// error line, its own subjects field and its own idea of what "confirm" means.
// Everything here was already confined to it — `dialog`, `renderPreflight`,
// `subjectList` and `openDialog` had no readers anywhere else in that file.
//
// ⚠ EVERY NUMBER HERE IS AN INSTRUMENT AND NONE OF THEM IS A GATE. Nothing
// disables Publish, nothing turns red, and the judgement is confined to a
// single hint line — the same contract the constellation composer's gauges
// keep. A preflight that blocks is a preflight people learn to route around.
//
// It looks up its OWN dom (everything under `#publish-dialog`, plus the four
// fields it reads) so the interface below can stay behavioural: what the drawer
// lends it is the ability to measure, to read and write the document, to save,
// and to say which tab to show. Seven functions, no shared mutable state —
// `currentStatus` is a getter for exactly that reason, because `savedStatus`
// changes underneath this dialog while it is open.
import { nowTime } from './action-error';
import { wireSubjectSuggest } from './subject-suggest';
import { onBackdropDismiss } from './backdrop-close';

export interface PublishDialogDeps {
  /** The form the subjects field is associated with. */
  form: HTMLFormElement;
  /** Live word/minute count of the document. */
  measure: () => { words: number; minutes: number };
  /** The document, as Markdown. */
  getMarkdown: () => string;
  /** Write the subjects chips (TagInput's own setter). */
  setSubjects: (v: string) => void;
  /** Save at a status. Resolves false when the save did not land. */
  save: (status: string) => Promise<boolean>;
  /** Announce a save in the drawer's status line. */
  setSaved: (msg?: string) => void;
  /** ⚠ A GETTER, NOT A VALUE. `savedStatus` moves while this dialog is open —
      a "Save details" on a published piece must write the status the row has
      NOW, not the one it had when the dialog was built. */
  currentStatus: () => string;
  /** Show one of the drawer's tabs (the preflight links to constellations). */
  selectTab: (key: string) => void;
}

export function wirePublishDialog(deps: PublishDialogDeps): void {
  const { form, measure, getMarkdown, setSubjects, save, setSaved, currentStatus, selectTab } = deps;

  const titleField = form.elements.namedItem('title') as HTMLInputElement;
  const bodyField = document.getElementById('ws-body-field') as HTMLInputElement;
  const excerptField = document.getElementById('excerpt-field') as HTMLTextAreaElement;
  const jsError = document.getElementById('ws-error') as HTMLParagraphElement;
  const cnPanel = document.getElementById('ws-panel-cn') as HTMLElement;

  // ---- publish / details dialog ----
  const dialog = document.getElementById('publish-dialog') as HTMLDialogElement;
  const dialogTitle = document.getElementById('dialog-title')!;
  const dialogSub = document.getElementById('dialog-sub')!;
  const dialogConfirm = document.getElementById('dialog-confirm') as HTMLButtonElement;
  const dialogError = document.getElementById('dialog-error') as HTMLParagraphElement;

  // ---- publish preflight (docs/plans/06) ----
  // What the piece is missing, said once, where you can act on it. Every one of
  // these is an instrument: none disables Publish, none turns red, and the
  // judgement is confined to a single hint line — the contract the constellation
  // composer's gauges already keep.
  const pfWords = document.getElementById('pf-words')!;
  const pfMins = document.getElementById('pf-mins')!;
  const pfSubjects = document.getElementById('pf-subjects')!;
  const pfCn = document.getElementById('pf-cn')!;
  const pfHint = document.getElementById('pf-hint') as HTMLParagraphElement;
  /** TagInput's hidden field — comma-joined, associated with the form by id.
   *  Looked up on every read, never cached: that input doesn't exist until the
   *  <tag-input> custom element upgrades, and nothing orders that against this
   *  module. Cached at load time it would be null forever, and the preflight
   *  would quietly report "0 subjects" for a piece that has five. */
  const subjectsField = () => form.elements.namedItem('subjects') as HTMLInputElement | null;
  const subjectList = () =>
    (subjectsField()?.value ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const subjectCount = () => subjectList().length;

  function renderPreflight() {
    const { words, minutes } = measure();
    const subjects = subjectCount();
    const constellations = cnPanel.querySelectorAll('.cn-check:checked').length;
    pfWords.textContent = words.toLocaleString();
    pfMins.textContent = String(minutes);
    pfSubjects.textContent = String(subjects);
    pfCn.textContent = String(constellations);

    // Ordered cheapest-to-fix first, and phrased as consequence rather than
    // instruction — "won't appear under any of them", not "add subjects".
    const notes: string[] = [];
    if (!excerptField.value.trim()) notes.push('no excerpt — the card will use the opening of the piece');
    if (subjects === 0) notes.push('no subjects — it won’t appear under any of them in the Index');
    if (constellations === 0) notes.push('not placed in any constellation');
    pfHint.textContent = notes.join(' · ');
    pfHint.hidden = notes.length === 0;
  }

  // TagInput writes its hidden field directly and fires no `input` event, so
  // watching the form isn't enough: a committed chip would go uncounted. keyup
  // catches Enter/Backspace, click catches the ✕. All three are idempotent.
  for (const ev of ['input', 'keyup', 'click']) dialog.addEventListener(ev, renderPreflight);

  document.getElementById('pf-constellations')?.addEventListener('click', () => {
    dialog.close(); // the picker is a tab in the sheet behind this dialog
    selectTab('constellations');
  });

  // ---- AI subject suggestions (docs/plans/02) ----
  // In the publish dialog, because that's where writing subjects are edited —
  // and it puts the fix beside the complaint: the preflight above says "no
  // subjects — it won't appear under any of them", and this is the button that
  // answers it. Explicit press, never automatic: it's a paid call, and this
  // dialog's whole contract is instruments that never act on their own.
  const subjectsSuggest = wireSubjectSuggest({
    root: document.getElementById('ws-subjects')!,
    kind: 'writing',
    gather: () => {
      const title = titleField.value.trim();
      const body = getMarkdown().trim();
      if (!title && !body) return { missing: 'Write something first — there’s nothing to read yet.' };
      // The WHOLE essay, not an opening slice. Measured against the corpus on
      // 2026-07-31: 51 pieces, median 6,107 characters, longest 14,131, none over
      // the action's 20,000 cap. So sending "title + first N words" would truncate
      // the top decile to save nothing. The slice below is a guard, not a budget.
      return { text: `${title}\n\n${body}`.slice(0, 20_000) };
    },
    readTags: subjectList,
    writeTags: (tags) => {
      setSubjects(tags.join(', '));
      // TagInput writes its hidden field directly and fires no `input` event, so
      // without this the chips would still read "0 subjects" and the hint would
      // still be complaining about the subjects now sitting above it.
      renderPreflight();
    },
    onStart: () => (dialogError.hidden = true),
    onError: (m) => {
      dialogError.textContent = m;
      dialogError.hidden = false;
    },
  });

  let dialogMode: 'publish' | 'details' = 'publish';
  function openDialog(mode: 'publish' | 'details') {
    dialogMode = mode;
    dialogError.hidden = true;
    subjectsSuggest.reset(); // a proposal from the last piece must not linger
    dialogTitle.textContent = mode === 'publish' ? 'Publish this piece' : 'Post details';
    dialogSub.textContent =
      mode === 'publish' ? 'A few last details, then it goes live.' : 'Update the metadata for this published piece.';
    dialogConfirm.textContent = mode === 'publish' ? 'Publish now' : 'Save details';
    renderPreflight();
    dialog.showModal();
  }
  document.getElementById('ws-open-publish')?.addEventListener('click', () => openDialog('publish'));
  document.getElementById('ws-open-details')?.addEventListener('click', () => openDialog('details'));
  document.getElementById('dialog-cancel')?.addEventListener('click', () => dialog.close());
  // Backdrop click, guarded — the dialog holds an excerpt field and a subjects
  // input you routinely select across before publishing (`backdrop-close.ts`,
  // docs/plans/25 · §3).
  onBackdropDismiss(dialog, () => dialog.close());

  dialogConfirm.addEventListener('click', async () => {
    dialogError.hidden = true;
    if (dialogMode === 'publish') {
      bodyField.value = getMarkdown();
      if (!titleField.value.trim() || !bodyField.value.trim()) {
        dialogError.textContent = 'Add a title and some words before publishing.';
        dialogError.hidden = false;
        return;
      }
    }
    dialogConfirm.disabled = true;
    const target = dialogMode === 'publish' ? 'published' : currentStatus();
    const ok = await save(target);
    dialogConfirm.disabled = false;
    if (ok) {
      dialog.close();
      if (dialogMode === 'publish') setSaved('Published ' + nowTime());
    } else {
      dialogError.textContent = jsError.textContent || 'Something went wrong.';
      dialogError.hidden = false;
    }
  });
}
