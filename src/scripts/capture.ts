// Client logic for CaptureDialog.astro — the dump box (14 · Piece 1).
//
// Ported from `/admin/capture-lab`, which Michael approved as drawn on
// 2026-08-01 (*"the Capture Lab is good. I feel like it's the design I
// intended"*) and which is deleted by this piece. What changed in the port is
// the door — a dialog mounted globally instead of a page — and nothing about
// how the box behaves.
//
// ZERO NEW SERVER CODE. `fragments.saveWriting` already accepts a
// client-minted id, allows an empty title, derives a slug from the body's
// first words, and takes `status: 'note'`. A dump is a `writing` fragment in
// the `note` tier; "make it a piece" is later a status flip on this same row,
// with no copy and no second write path (14 §3).
import { actions } from 'astro:actions';

const fab = document.getElementById('cap-open') as HTMLButtonElement | null;
const dialog = document.getElementById('cap-dialog') as HTMLDialogElement | null;

if (fab && dialog) {
  const box = document.getElementById('cap-box') as HTMLTextAreaElement;
  const statusEl = document.getElementById('cap-status') as HTMLElement;
  const newBtn = document.getElementById('cap-new') as HTMLButtonElement;
  const doneBtn = document.getElementById('cap-done') as HTMLButtonElement;

  // Deliberately shorter than the writing sheet's 1200ms. That sheet is a
  // document you sit in; this is a dump box, where the pause before "Saved" is
  // the entire reassurance that you can walk away.
  const DEBOUNCE_MS = 700;

  let currentId: string | null = null; // null = nothing typed yet this round
  let baseUpdatedAt = ''; // optimistic-concurrency token from the last save
  let slug = ''; // minted once, then sent back — see persist()
  let timer: number | undefined;
  let lock: Promise<unknown> = Promise.resolve(); // serialize: New must not race autosave
  let lastSaved = '';
  let savedAnything = false; // did this visit write? decides whether the pile needs re-reading
  let fadeTimer: number | undefined;

  /**
   * ⚠ EMPTY UNTIL THERE IS SOMETHING TRUE TO SAY, and empty again after.
   *
   * The lab shipped with the word "Saved" sitting in the markup at opacity-0.
   * It lied to screen readers, and in the first e2e run it satisfied an
   * assertion for a save that had not happened. Never pre-fill a status
   * element with its success case.
   */
  function flash(text: string, sticky = false) {
    window.clearTimeout(fadeTimer);
    statusEl.textContent = text;
    statusEl.style.opacity = '1';
    if (sticky) return;
    fadeTimer = window.setTimeout(() => {
      statusEl.style.opacity = '0';
      window.setTimeout(() => {
        if (statusEl.style.opacity === '0') statusEl.textContent = '';
      }, 300); // matches the CSS transition, so the words go with the fade
    }, 1400);
  }

  function autoGrow() {
    box.style.height = 'auto';
    box.style.height = `${Math.max(box.scrollHeight, 140)}px`;
  }

  /**
   * One save. Quiet on failure, like the writing sheet's autosave: a banner
   * every 700ms on a bad connection is noise, and the words are still on
   * screen. `lock` keeps New from racing an in-flight write.
   */
  async function persist(): Promise<void> {
    const text = box.value;
    if (!text.trim()) return; // an empty box is never a row — a stray ✚ leaves no ghost
    if (text === lastSaved) return;

    const id = currentId ?? crypto.randomUUID();
    const fd = new FormData();
    fd.set('id', id);
    fd.set('body', text);
    fd.set('status', 'note');
    // Send the slug back once we have one. Without this, `saveWriting` re-derives
    // it from the body's first words on EVERY autosave — so the slug churns as
    // you type (`call` → `call-the` → `call-the-dentist`), each round trip
    // paying for a uniqueness query. Nobody ever sees a dump's slug; it exists
    // because the column is NOT NULL. Mint it once and leave it alone.
    if (slug) fd.set('slug', slug);
    if (baseUpdatedAt) fd.set('base_updated_at', baseUpdatedAt);

    try {
      const { data, error } = await actions.fragments.saveWriting(fd);
      if (error || !data) {
        flash(error?.code === 'CONFLICT' ? 'Changed elsewhere — reload' : 'Not saved', true);
        return;
      }
      currentId = data.id;
      baseUpdatedAt = data.updated_at;
      slug = data.slug;
      lastSaved = text;
      savedAnything = true;
      flash('Saved');
    } catch {
      flash('Not saved', true); // offline / server down — the text is still here
    }
  }

  const save = () => {
    lock = lock.then(persist).catch(() => {});
    return lock;
  };

  box.addEventListener('input', () => {
    autoGrow();
    window.clearTimeout(timer);
    timer = window.setTimeout(save, DEBOUNCE_MS);
  });

  /** Park the current thought and hand over a blank one, still focused. */
  async function startNew() {
    window.clearTimeout(timer);
    await save(); // flush whatever is pending first
    currentId = null;
    baseUpdatedAt = '';
    slug = '';
    lastSaved = '';
    box.value = '';
    autoGrow();
    box.focus();
  }

  newBtn.addEventListener('click', () => void startNew());
  box.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void startNew();
    }
  });

  function open() {
    dialog!.showModal();
    autoGrow();
    box.focus();
  }

  /**
   * Closing always flushes. Escape, the backdrop and Done all land here, and a
   * thought typed 200ms before Escape must not be the one that gets lost —
   * that is the exact failure the box exists to prevent.
   *
   * The pile is server-rendered, so a dump written while standing IN the Notes
   * room would leave a page that disagrees with the database. Re-reading the
   * room is one navigation and is always right; prepending a card here would
   * mean a second copy of the card's markup, kept in step by hand.
   */
  async function close() {
    window.clearTimeout(timer);
    await save();
    dialog!.close();
    if (savedAnything && document.getElementById('notes-pile')) window.location.reload();
  }

  fab.addEventListener('click', open);
  doneBtn.addEventListener('click', () => void close());
  // `cancel` fires for Escape and precedes `close`; take it over so the flush
  // has somewhere to happen before the dialog goes.
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    void close();
  });
  // Click outside the shell — the backdrop is the <dialog> itself.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) void close();
  });

  // Anything still pending when the tab goes away (phone locking, app switch).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void save();
  });

  // The PWA shortcut lands here: long-press the home-screen icon → New note →
  // /admin/notes?new=1, which is the room with the box already open.
  if (new URLSearchParams(window.location.search).get('new') !== null) open();
}
