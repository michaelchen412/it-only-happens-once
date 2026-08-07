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
//
// ⚠ THE BOX BECAME A TIPTAP EDITOR ON 2026-08-06, reversing 14 §4's "plain
// <textarea>, ever" — see CaptureDialog.astro for the trade Michael accepted.
// Only the surface changed: `getMarkdown()` stands where `box.value` stood, and
// every promise about not losing the thought (the 700ms debounce, the flush on
// close and on visibilitychange, ＋ New parking one under its own id) is the
// same code it was.
// ⚠ THE ✚ COSTS THE WHOLE COMPOSER, ON EVERY ADMIN PAGE — that is what the
// three dynamic imports below are about (24 · Piece 5).
//
// `CaptureDialog` is mounted from `AdminLayout`, on purpose (10-hq §10c: *"the
// ✚ belongs to the building, not to a room"*), and that decision is NOT in
// question here. But this module used to `import` TipTap statically, so Today,
// People, Agenda, Notes, Fragments, Constellations, Library and About each
// fetched, parsed and executed it whether or not anybody opened the box.
// Measured 2026-08-07, transitively from this file: **725.2 KB raw / 228.4 KB
// gzip**, of which `rich-editor` is 509 KB and the Supabase browser client
// `upload` drags in is another 218 KB. HTTP-cached, so the cost is re-parse on
// every navigation rather than re-download — which on a phone is real time with
// the main thread held.
//
// ⚠ WARMED ON IDLE, NOT IMPORTED ON CLICK, and the difference is the design.
// The obvious shape — `await import()` inside the click handler — puts a fetch
// between the tap and a usable editor, taxing the one interaction plan 14
// exists to keep instant. Warming after first paint takes the parse off the
// critical path while leaving the editor already resident by the time a ✚ is
// pressed in anger. `pointerdown`/`focusin` are belt and braces for the tap
// that lands in the first second of a page's life, before idle has fired.
import { actions } from 'astro:actions';

const fab = document.getElementById('cap-open') as HTMLButtonElement | null;
const dialog = document.getElementById('cap-dialog') as HTMLDialogElement | null;

/**
 * Build the box. Everything below this line is exactly what used to run at
 * import time — the `dialog` parameter shadows the module-level lookup
 * deliberately, so the body needed no edit at all and `git diff` shows the
 * wrapper rather than a 230-line reindent.
 *
 * ⚠ It takes no `fab`. The ✚ is the DOOR and the door is wired outside, because
 * the click that triggers the boot has already happened by the time this
 * resolves and could never be replayed from in here.
 */
async function boot(dialog: HTMLDialogElement) {
  // One await, three modules — they are independent and `rich-editor` is the
  // long pole; serialising them would make the warm-up three round trips of
  // parse latency instead of one.
  const [{ mountRichEditor }, { wireAltDialog }, { uploadImage }] = await Promise.all([
    import('./rich-editor'),
    import('./alt-dialog'),
    import('./upload'),
  ]);

  const boxEl = document.getElementById('cap-box') as HTMLElement;
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

  /**
   * The box itself.
   *
   * `breaks: true` — a dump's line breaks ARE its structure (an errand list, a
   * stanza), and every dump written before 2026-08-06 is plain text whose
   * newlines mean exactly that. Parsed as soft wraps they would glue into one
   * paragraph and the autosave would write that back. The pile renders the
   * other end to match: `renderMarkdown(body, { breaks: true })`.
   */
  const { editor, getMarkdown } = mountRichEditor({
    editorEl: boxEl,
    toolbarRoot: dialog.querySelector('[role="toolbar"]') as HTMLElement,
    linkDialog: document.getElementById('cap-link-dialog') as HTMLDialogElement,
    placeholder: 'Write it down…',
    ariaLabel: 'What are you thinking?',
    breaks: true,
    // A jotting's register, not an essay's — shared with the pile's cards.
    docClass: 'jot-prose',
    images: {
      // ⚠ MINTS THE ID EARLY, and it has to. Files key on the fragment id the
      // same way the writing sheet's do, but here the id is normally minted by
      // the first save — and pasting a screenshot into an empty box is a save
      // that has not happened yet. Claiming it now is free: `persist` uses
      // whatever `currentId` holds, and ＋ New clears it so the next thought
      // gets its own folder. The path is `essays/` rather than `notes/`
      // because "make it a piece" is a status flip on this very row: the
      // picture must not need moving when the thought graduates.
      upload: async (file) =>
        (
          await uploadImage(file, {
            pathFor: (hash, ext) => `essays/${(currentId ??= crypto.randomUUID())}/${hash}.${ext}`,
          })
        ).url,
      askAlt: wireAltDialog(document.getElementById('cap-alt-dialog') as HTMLDialogElement),
      onStatus: (m) => (m ? flash(m, true) : flash('')),
      onError: (m) => flash(m, true),
    },
    onChange: () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, DEBOUNCE_MS);
    },
  });

  /**
   * One save. Quiet on failure, like the writing sheet's autosave: a banner
   * every 700ms on a bad connection is noise, and the words are still on
   * screen. `lock` keeps New from racing an in-flight write.
   */
  async function persist(): Promise<void> {
    const text = getMarkdown();
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

  /** Park the current thought and hand over a blank one, still focused. */
  async function startNew() {
    window.clearTimeout(timer);
    await save(); // flush whatever is pending first
    currentId = null;
    baseUpdatedAt = '';
    slug = '';
    lastSaved = '';
    // emitUpdate: false — TipTap fires `update` on setContent, which would arm
    // the debounce and try to save the blank we just handed over.
    editor.commands.setContent('', { emitUpdate: false });
    editor.commands.focus('end');
  }

  newBtn.addEventListener('click', () => void startNew());
  // On the dialog rather than on the box: the shortcut has to work from the
  // toolbar and the foot as well, and a keystroke inside the editor bubbles
  // here anyway. Nothing in TipTap binds Mod-Enter, so nothing is being stolen.
  dialog.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void startNew();
      return;
    }
    /*
      ⚠ ESCAPE HAS TO BE CLOSED BY HAND, and this cost an e2e failure to find.

      A `<dialog>` turns Escape into a close request only if the keydown's
      default survives — and ProseMirror's `captureKeyDown` preventDefaults
      keyCode 27 unconditionally (prosemirror-view, "Enter, Esc"). So the
      moment the box became an editor, Escape stopped reaching `cancel`: the
      dialog just sat there, which is the *one* thing this box may never do,
      because Escape is how you leave and leaving is what flushes the save.

      Calling preventDefault here as well is deliberate, not habit — it keeps
      the two paths mutually exclusive. Focus on the toolbar or on Done is
      OUTSIDE the editor, where nothing swallows the key and the native
      `cancel` below still fires; claiming the default stops that one from
      running a second close on top of this one.
    */
    if (e.key === 'Escape') {
      e.preventDefault();
      void close();
    }
  });

  function open() {
    dialog!.showModal();
    editor.commands.focus('end');
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

  // ⚠ NOT `fab.addEventListener('click', open)` ANY MORE — the door is wired
  // below, outside `boot`, because by the time this line runs the click that
  // caused the boot has already happened and would never be replayed.
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

  return { open };
}

if (fab && dialog) {
  // One boot per page, whichever door reaches it first.
  let booted: ReturnType<typeof boot> | null = null;
  const warm = () => (booted ??= boot(dialog));

  // The tap that beats the idle warm-up. `pointerdown` fires before `click`, so
  // a press already has the import in flight by the time the finger lifts.
  fab.addEventListener('pointerdown', () => void warm());
  fab.addEventListener('focusin', () => void warm());
  fab.addEventListener('click', () => void warm().then((box) => box.open()));

  // ⚠ THE PWA SHORTCUT BOOTS IMMEDIATELY, NOT ON IDLE. Long-pressing the
  // home-screen icon → New note lands on /admin/notes?new=1, which is the room
  // with the box ALREADY OPEN — so there is no click to wait for and no idle to
  // be patient about. Waiting here would show the room with no box in it.
  if (new URLSearchParams(window.location.search).get('new') !== null) {
    void warm().then((box) => box.open());
  } else {
    // Otherwise: off the critical path, but resident before it is wanted.
    // `requestIdleCallback` is still missing on some Safari versions Michael
    // actually uses, and a missing warm-up would silently move the cost back
    // onto the first ✚ press — which is precisely the trade this piece refuses.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    idle(() => void warm());
  }
}
