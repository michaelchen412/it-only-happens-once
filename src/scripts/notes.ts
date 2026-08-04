// Client logic for /admin/notes — the pile (14 · Piece 1).
//
// THE DOM IS THE STATE, as everywhere else in HQ. A card carries its own id,
// its concurrency token and its slug; there is no JavaScript copy of the pile
// beside the pile.
//
// FOUR MOTIONS, and the whole room is these four:
//   · edit in place        — the words change, nothing else does
//   · make it a piece      — one status flip: same row, no copy (14 §3)
//   · add to a piece       — the one genuine copy, so the dump is consumed
//   · delete               — soft, with a way back
//
// ⚠ READING IS THE DOMINANT MOTION HERE, which is why the text is a `<div>` and
// the pencil is what turns it into a `<textarea>`. The alternative — a pile of
// live textareas, always editable — was better on paper and worse in the hand:
// on a phone, every tap while scrolling past a thought would put a cursor in it
// and throw the keyboard up over the pile you were trying to read.
import { actions } from 'astro:actions';
import { elapsedSince } from '../lib/hq/dates';

const pile = document.getElementById('notes-pile');
const undoBar = document.getElementById('notes-undo');

if (undoBar) {
  const undoText = undoBar.querySelector<HTMLElement>('[data-undo-text]')!;
  const undoBtn = undoBar.querySelector<HTMLButtonElement>('[data-undo-do]')!;

  // How long a one-tap action stays reversible. Long enough to notice a
  // mis-tap, short enough that the strip is not part of the furniture.
  const UNDO_MS = 8000;
  const DEBOUNCE_MS = 700; // the box's rhythm, kept (14 §4)

  let undoTimer: number | undefined;
  /** What the strip's button does right now, and what to tidy when it expires. */
  let pending: { card: HTMLElement; undo: (() => Promise<void>) | null } | null = null;

  /* ── the undo strip ─────────────────────────────────────────────────────── */

  /**
   * A card that has left the pile fades but STAYS until the window closes —
   * a row that vanishes gives no sense of what just happened and no way back
   * from a mis-tap (10-hq §10f, the same rule a ticked task follows).
   */
  function showUndo(text: string, card: HTMLElement, undo: (() => Promise<void>) | null) {
    finish(); // any previous window closes now — one strip, one pending thing
    pending = { card, undo };
    card.classList.add('dump--going');
    undoText.textContent = text;
    undoBtn.hidden = !undo;
    undoBar!.classList.add('is-visible');
    undoTimer = window.setTimeout(finish, UNDO_MS);
  }

  /** Close the window: the card goes for good (from the page, not the database). */
  function finish() {
    window.clearTimeout(undoTimer);
    undoBar!.classList.remove('is-visible');
    if (!pending) return;
    pending.card.remove();
    pending = null;
    // The empty state is server-rendered, so an emptied pile would otherwise
    // sit here as a blank page rather than saying so.
    if (pile && !pile.querySelector('.dump')) window.location.reload();
  }

  undoBtn.addEventListener('click', async () => {
    if (!pending?.undo) return;
    const { card, undo } = pending;
    window.clearTimeout(undoTimer);
    undoBar!.classList.remove('is-visible');
    pending = null;
    try {
      await undo();
      card.classList.remove('dump--going');
    } catch {
      // The server refused to put it back. Leave the card visibly gone rather
      // than restoring a row that does not exist.
      card.remove();
    }
  });

  /* ── editing in place ───────────────────────────────────────────────────── */

  let editing: HTMLElement | null = null;
  let saveTimer: number | undefined;
  let lock: Promise<unknown> = Promise.resolve();

  const textOf = (card: HTMLElement) => card.querySelector<HTMLElement>('[data-text]')!;
  const boxOf = (card: HTMLElement) => card.querySelector<HTMLTextAreaElement>('[data-edit-box]')!;
  const stampOf = (card: HTMLElement) => card.querySelector<HTMLTimeElement>('[data-ago]')!;

  function autoGrow(box: HTMLTextAreaElement) {
    box.style.height = 'auto';
    box.style.height = `${Math.max(box.scrollHeight, 60)}px`;
  }

  /** One save of the card being edited. Quiet on failure — the words are still on screen. */
  async function persist(card: HTMLElement): Promise<void> {
    const box = boxOf(card);
    const text = box.value;
    if (text === card.dataset.saved) return;

    const fd = new FormData();
    fd.set('id', card.dataset.note!);
    fd.set('body', text);
    fd.set('status', 'note');
    // Both sent back so neither is re-derived: the slug would otherwise churn
    // off the body's first words on every keystroke's save, and the token is
    // what stops a stale tab overwriting a newer edit.
    if (card.dataset.slug) fd.set('slug', card.dataset.slug);
    if (card.dataset.updated) fd.set('base_updated_at', card.dataset.updated);

    try {
      const { data, error } = await actions.fragments.saveWriting(fd);
      if (error || !data) {
        stampOf(card).textContent = error?.code === 'CONFLICT' ? 'changed elsewhere — reload' : 'not saved';
        return;
      }
      card.dataset.updated = data.updated_at;
      card.dataset.slug = data.slug;
      card.dataset.saved = text;
      stampOf(card).dateTime = data.updated_at;
      stampOf(card).textContent = elapsedSince(data.updated_at);
    } catch {
      stampOf(card).textContent = 'not saved';
    }
  }

  const save = (card: HTMLElement) => {
    lock = lock.then(() => persist(card)).catch(() => {});
    return lock;
  };

  function enterEdit(card: HTMLElement) {
    if (editing === card) return;
    if (editing) void leaveEdit(editing);
    editing = card;
    const box = boxOf(card);
    card.dataset.saved = box.value;
    textOf(card).hidden = true;
    card.querySelector<HTMLElement>('[data-more]')?.setAttribute('hidden', '');
    box.hidden = false;
    autoGrow(box);
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }

  async function leaveEdit(card: HTMLElement) {
    window.clearTimeout(saveTimer);
    editing = null;
    await save(card);
    const box = boxOf(card);
    const text = textOf(card);
    text.textContent = box.value;
    text.hidden = false;
    box.hidden = true;
    // An edited thought may have grown past the clamp, or shrunk under it.
    const long = box.value.split('\n').length > 10 || box.value.length > 700;
    text.classList.toggle('dump__text--clamped', long && !text.dataset.expanded);
    const more = card.querySelector<HTMLElement>('[data-more]');
    if (more) more.hidden = !long || !!text.dataset.expanded;
  }

  /* ── the two ways out ───────────────────────────────────────────────────── */

  /** `fragments.bulk` takes a comma-joined list; one id is a list of one. */
  async function bulk(id: string, op: 'draft' | 'note' | 'trash' | 'restore') {
    const fd = new FormData();
    fd.set('ids', id);
    fd.set('op', op);
    const { error } = await actions.fragments.bulk(fd);
    if (error) throw new Error(error.message);
  }

  /* ── the picker ─────────────────────────────────────────────────────────── */

  const fileDialog = document.getElementById('note-file') as HTMLDialogElement | null;
  const fileQuery = document.getElementById('note-file-q') as HTMLInputElement | null;
  const fileList = document.getElementById('note-file-list');
  const fileNone = document.getElementById('note-file-none');
  /** The card being filed — written when the dialog opens, per the one-sheet-many-rows rule. */
  let filing: HTMLElement | null = null;

  function openFiler(card: HTMLElement) {
    if (!fileDialog) return;
    filing = card;
    if (fileQuery) fileQuery.value = '';
    filterPieces('');
    fileDialog.showModal();
    // Not autofocused: the list is short and ordered most-likely-first, so the
    // common case is picking with your eyes rather than typing.
  }

  function filterPieces(term: string) {
    if (!fileList) return;
    const q = term.trim().toLowerCase();
    let shown = 0;
    fileList.querySelectorAll<HTMLElement>('li').forEach((li) => {
      const title = li.querySelector<HTMLElement>('[data-piece]')?.dataset.title ?? '';
      const hit = !q || title.toLowerCase().includes(q);
      li.hidden = !hit;
      if (hit) shown++;
    });
    if (fileNone) fileNone.hidden = shown > 0;
  }

  fileQuery?.addEventListener('input', () => filterPieces(fileQuery.value));
  fileDialog?.querySelector('[data-close]')?.addEventListener('click', () => fileDialog.close());
  fileDialog?.addEventListener('click', (e) => {
    if (e.target === fileDialog) fileDialog.close();
  });

  fileList?.addEventListener('click', async (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-piece]');
    if (!btn || !filing) return;
    const card = filing;
    fileDialog?.close();
    try {
      const { data, error } = await actions.fragments.appendToPiece({
        noteId: card.dataset.note!,
        targetId: btn.dataset.piece!,
      });
      if (error || !data) {
        stampOf(card).textContent = error?.message ?? 'could not add it';
        return;
      }
      // The title comes back from the SERVER rather than from the row you
      // clicked: it is what the piece is actually called at the moment the
      // words landed in it, not what this page last heard.
      //
      // NO UNDO ON THIS ONE, deliberately. Undoing an append means editing the
      // target's body back out, and by then the writing sheet may have saved
      // over it — an "undo" that sometimes silently does nothing is worse than
      // none. The honest offer is the way to where the words went.
      showUndo(`Added to ${data.title || '(untitled)'}`, card, null);
      const link = document.createElement('a');
      link.href = `/admin/fragments#edit=${btn.dataset.piece}`;
      link.className = 'btn btn-xs font-sans';
      link.textContent = 'Open →';
      undoBtn.hidden = true;
      undoBtn.after(link);
      window.setTimeout(() => link.remove(), 8000);
    } catch {
      stampOf(card).textContent = 'could not add it';
    }
  });

  /* ── wiring ─────────────────────────────────────────────────────────────── */

  pile?.addEventListener('click', async (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-edit], [data-more], [data-promote], [data-append], [data-delete]');
    if (!el) return;
    const card = el.closest<HTMLElement>('[data-note]');
    if (!card) return;
    const id = card.dataset.note!;

    if (el.hasAttribute('data-more')) {
      const text = textOf(card);
      text.classList.remove('dump__text--clamped');
      text.dataset.expanded = 'true';
      el.hidden = true;
      return;
    }

    if (el.hasAttribute('data-edit')) {
      if (editing === card) await leaveEdit(card);
      else enterEdit(card);
      return;
    }

    // Everything below moves the card out of the pile, so flush any edit first.
    if (editing === card) await leaveEdit(card);

    if (el.hasAttribute('data-promote')) {
      try {
        await bulk(id, 'draft');
      } catch {
        stampOf(card).textContent = 'could not promote it';
        return;
      }
      showUndo('Now a draft', card, () => bulk(id, 'note'));
      const link = document.createElement('a');
      link.href = `/admin/fragments#edit=${id}`;
      link.className = 'btn btn-xs btn-ghost font-sans';
      link.textContent = 'Open →';
      undoBtn.after(link);
      window.setTimeout(() => link.remove(), UNDO_MS);
      return;
    }

    if (el.hasAttribute('data-append')) {
      openFiler(card);
      return;
    }

    if (el.hasAttribute('data-delete')) {
      // No confirm dialog. A jotting is not worth a modal, and the strip below
      // is a cheaper way back than a question in front of every delete.
      try {
        await bulk(id, 'trash');
      } catch {
        stampOf(card).textContent = 'could not delete it';
        return;
      }
      showUndo('Deleted', card, () => bulk(id, 'restore'));
    }
  });

  pile?.addEventListener('input', (e) => {
    const box = (e.target as Element).closest<HTMLTextAreaElement>('[data-edit-box]');
    if (!box) return;
    const card = box.closest<HTMLElement>('[data-note]')!;
    autoGrow(box);
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(card), DEBOUNCE_MS);
  });

  pile?.addEventListener(
    'blur',
    (e) => {
      const box = (e.target as Element).closest<HTMLTextAreaElement>('[data-edit-box]');
      if (box && editing) void leaveEdit(editing);
    },
    true, // blur does not bubble
  );

  pile?.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !editing) return;
    e.preventDefault();
    void leaveEdit(editing);
  });

  // Anything still pending when the tab goes away.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && editing) void save(editing);
  });

  /* ── stamps ─────────────────────────────────────────────────────────────── */

  // The elapsed text is server-rendered (a duration is the same in every zone,
  // so it breaks no rule) and re-rendered here so a page left open overnight is
  // not still claiming "20m ago". The EXACT instant is the hover title, and
  // that one does need the device's zone — same contract as scripts/local-time.
  document.querySelectorAll<HTMLTimeElement>('time[data-ago]').forEach((t) => {
    if (!t.dateTime) return;
    t.textContent = elapsedSince(t.dateTime);
    t.title = new Date(t.dateTime).toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  });
}
