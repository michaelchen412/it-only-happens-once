// Client logic for SetSheet.astro (plan 42 · §4.D.2).
//
// ⚠ ONE SHEET, MANY SETS, so this fills the form on open from the row's own
// JSON — TaskSheet's shape. Every prefill runs through `fill()`, which is also
// what `ui.open()` resets the dirty tracker after: populating a form fires
// `input` like any other write, and a guard that asks about edits nobody made
// is a guard that teaches you to click through it (`sheet-dismiss.ts`, Trap 1).
//
// ⚠ TWO WRITES, NOT ONE, AND THE SPLIT IS THE POINT. `sets.save` no longer
// accepts `status` — `setStatus` is its only writer (plan 41 · §5a, applied to
// this table by plan 42 · §4.D.3) — so a Save that also flipped the switch is
// two action calls. They are sequenced rather than raced: the card first, then
// the standing, because publishing a set whose title failed to save would put
// the old title on the public page.
import { actions } from 'astro:actions';
import { callAction, formatActionError, submitAction } from './action-error';
import { confirmDialog } from './confirm-dialog';
import { mountMiniEditor } from './rich-editor';
import { wireEpigraphBrowser } from './epigraph-browser';
import { wireSheet } from './sheet';

const sheet = document.querySelector<HTMLDialogElement>('#set-sheet');
const form = document.querySelector<HTMLFormElement>('#set-form');

if (sheet && form) {
  const ui = wireSheet(sheet, { noun: 'This set' });
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const deleteBtn = form.querySelector<HTMLButtonElement>('[data-delete]')!;
  const titleEl = form.querySelector<HTMLInputElement>('input[name="title"]')!;
  const urlEl = form.querySelector<HTMLInputElement>('input[name="playlist_url"]')!;
  const slugEl = form.querySelector<HTMLInputElement>('input[name="slug"]')!;
  const quoteId = form.querySelector<HTMLInputElement>('[data-quote-id]')!;
  const quoteNone = form.querySelector<HTMLElement>('[data-quote-none]')!;
  const quoteText = form.querySelector<HTMLElement>('[data-quote-text]')!;
  const quoteCite = form.querySelector<HTMLElement>('[data-quote-cite]')!;
  const quoteClear = form.querySelector<HTMLButtonElement>('[data-quote-clear]')!;
  const descValue = form.querySelector<HTMLInputElement>('[data-desc-value]')!;
  const statusEl = form.querySelector<HTMLInputElement>('[data-status]')!;
  const statusWord = document.getElementById('set-status-word')!;
  const statusHint = form.querySelector<HTMLElement>('[data-status-hint]')!;
  const heading = document.getElementById('set-sheet-title')!;

  /** The set currently open — `null` while creating. */
  let editing: string | null = null;
  /** What the switch said when the sheet opened, so Save knows if it moved. */
  let statusWas = false;

  const desc = mountMiniEditor({
    editorEl: document.getElementById('set-desc')!,
    toolbarRoot: document.getElementById('set-desc-wrap')!,
    placeholder: 'What this listen is — the feeling it isolates, not why the music is good.',
    ariaLabel: 'Description',
    // A contenteditable fires no `input` the form can hear, so the editor owns
    // both jobs on every keystroke: serialize into the field the action reads,
    // and mark the sheet dirty so the exit guard knows there is something here.
    onChange: () => {
      descValue.value = desc.getMarkdown();
      ui.dirty.touch();
    },
  });

  /** The two sentences under the switch, and the word beside it. */
  function paintStatus() {
    const on = statusEl.checked;
    statusWord.textContent = on ? 'Published' : 'Draft';
    statusHint.textContent = on
      ? 'Live on the music page, and public at its own address.'
      : 'Only you can see it. It joins the music page when you press Save.';
  }
  statusEl.addEventListener('change', paintStatus);

  interface SetRow {
    id: string;
    title: string;
    slug: string;
    playlist_url: string;
    quote_fragment_id: string | null;
    /** The cited quote's words and citation, for the sheet's summary. */
    quote_text?: string;
    quote_cite?: string;
    description: string;
    status: string;
  }

  /** The one place the epigraph's three elements are kept in step. */
  function paintQuote(id: string, text: string, cite: string) {
    quoteId.value = id;
    const has = !!id;
    quoteNone.hidden = has;
    quoteText.hidden = !has;
    quoteCite.hidden = !has || !cite;
    quoteClear.hidden = !has;
    quoteText.textContent = text;
    quoteCite.textContent = cite ? `— ${cite}` : '';
  }

  const epigraphs = wireEpigraphBrowser(document.getElementById('epigraph-browser') as HTMLDialogElement, {
    onPicked: (q) => {
      paintQuote(q.id, q.label, q.attribution);
      // A hidden input's value set in script fires no `input` event, so the
      // exit guard would not know this sheet had anything to lose.
      ui.dirty.touch();
    },
  });

  form.querySelector<HTMLButtonElement>('[data-quote-pick]')!.addEventListener('click', () => {
    epigraphs.open({ setName: titleEl.value.trim() });
  });
  quoteClear.addEventListener('click', () => {
    paintQuote('', '', '');
    ui.dirty.touch();
  });

  function fill(row: SetRow | null) {
    editing = row?.id ?? null;
    heading.textContent = row ? 'Edit set' : 'New set';
    submitBtn.textContent = row ? 'Save set' : 'Add set';
    deleteBtn.hidden = !row;

    titleEl.value = row?.title ?? '';
    urlEl.value = row?.playlist_url ?? '';
    slugEl.value = row?.slug ?? '';
    // ⚠ THE SUMMARY IS THE ROW'S OWN WORDS, not a re-query. The list page
    // serialises the quote's text and citation onto each set for exactly this,
    // so reopening a saved set shows the line it cites without a round trip —
    // and an unsaved pick shows what you just pressed, from the same shape.
    paintQuote(row?.quote_fragment_id ?? '', row?.quote_text ?? '', row?.quote_cite ?? '');
    descValue.value = row?.description ?? '';
    // ⚠ `emitUpdate: false` — the trap every editor in this admin names: TipTap
    // v3 fires `update` from `setContent`, which would arm the dirty guard on a
    // sheet nobody has typed into.
    desc.editor.commands.setContent(descValue.value, { emitUpdate: false });

    statusEl.checked = row?.status === 'published';
    statusWas = statusEl.checked;
    paintStatus();
  }

  document.querySelectorAll<HTMLElement>('[data-open-set-sheet]').forEach((btn) =>
    btn.addEventListener('click', () => {
      fill(null);
      ui.open(); // clears the error and forgets the fill — see `Sheet.open`
      titleEl.focus();
    }),
  );

  document.addEventListener('set:edit', (e) => {
    fill((e as CustomEvent<SetRow>).detail);
    ui.open();
    titleEl.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ui.showError(null);

    const fd = new FormData(form);
    if (editing) fd.set('id', editing);
    // The switch is not part of `sets.save`'s schema by design; strip it so a
    // stray `status` key can never ride along on the card write.
    fd.delete('status');

    const res = await submitAction(() => actions.sets.save(fd), {
      button: submitBtn,
      busy: 'Saving…',
      onError: ui.showError,
    });
    if (!res.ok) return;

    // The standing, and only if it moved. A new set is a draft by the column's
    // own default, so this is also how the first publish happens.
    const id = editing ?? (res.data as { id?: string } | undefined)?.id;
    if (id && statusEl.checked !== statusWas) {
      const sfd = new FormData();
      sfd.set('id', id);
      sfd.set('status', statusEl.checked ? 'published' : 'draft');
      const { error } = await callAction(actions.sets.setStatus(sfd));
      // ⚠ THE CARD IS ALREADY SAVED, so this reports rather than rolls back —
      // the same shape SongSheet uses when a queued pairing misses. Reloading
      // anyway would show the new title beside the old chip and read as a bug.
      if (error) return ui.showError(`Saved, but the visibility didn’t change: ${formatActionError(error)}`);
    }

    await ui.close();
    location.reload();
  });

  deleteBtn.addEventListener('click', async () => {
    if (!editing) return;
    const ok = await confirmDialog({
      title: 'Delete this set?',
      // What survives first, then that nothing does — the footer-Delete rule in
      // `sheet.ts`. `sets.remove` is a hard delete and argues why at the action.
      message: 'The playlist on Spotify is untouched, and the quote stays in the corpus. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    const fd = new FormData();
    fd.set('id', editing);
    const res = await submitAction(() => actions.sets.remove(fd), { button: deleteBtn, onError: ui.showError });
    if (!res.ok) return;
    await ui.close();
    location.reload();
  });
}
