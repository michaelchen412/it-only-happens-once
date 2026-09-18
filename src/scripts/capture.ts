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
import { callAction } from './action-error';
import { MAX_SHELVES } from '../lib/shelves';
import { pick, wireRadioGroups } from './radio-group';
import { closeWithExit, openDialog } from './dialog-close';
import { onBackdropDismiss } from './backdrop-close';

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

  /* ── where this jotting goes (2026-09-18) ────────────────────────────────
     CaptureDialog.astro carries the design argument; this is the wiring. */

  const shelfZone = dialog.querySelector<HTMLElement>('[data-cap-shelf]');
  const shelfRow = dialog.querySelector<HTMLElement>('[data-cap-shelf-row]');
  /** Shelf ids this note should end up on. Survives ＋ New — see `startNew`. */
  let picked: string[] = [];
  /** The last list actually written, so a re-save is not a second round trip. */
  let appliedShelves = '\u0000'; // not `''`, which is a legitimate list ("inbox")
  let shelvesLoaded = false;
  /** `shelf id → slug`, because `?shelf=` addresses a view by slug. */
  const slugOf = new Map<string, string>();

  /**
   * The vocabulary, fetched once and only if the ✚ is ever opened.
   *
   * ⚠ THE PRESSED SHELF IS THE DEFAULT, AND THIS IS THE WHOLE POINT OF THE
   * FEATURE. `?shelf=<slug>` is how the pile addresses a filtered view, so
   * reading it here is how the ✚ learns where you are standing WITHOUT the
   * layout having to tell it — no prop, no `locals`, and correct from a
   * bookmark. Michael: *"if I have a notes section already open there should be
   * an option to add a note into here under that category automatically."*
   */
  async function loadShelves() {
    if (shelvesLoaded || !shelfRow) return;
    shelvesLoaded = true;
    const { data, error } = await callAction(actions.shelves.list());
    if (error || !data) {
      shelvesLoaded = false; // let the next open try again
      return;
    }
    // ⚠ NOTHING AT ALL WHEN THERE IS NO VOCABULARY — 10-hq §10b, the rule the
    // Log tab's picker and the pile's own chooser row both follow. A label over
    // an empty strip is a control asking a question with no answers.
    if (!data.length) return;

    const here = new URLSearchParams(window.location.search).get('shelf')?.trim();
    shelfRow.textContent = '';
    for (const sh of data) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'lchip';
      chip.dataset.shelfId = sh.id;
      chip.textContent = sh.name;
      slugOf.set(sh.id, sh.slug);
      // `aria-pressed`, because these are toggles rather than a radio group:
      // a note may sit on two (MAX_SHELVES), and neither is "the" choice.
      chip.setAttribute('aria-pressed', 'false');
      shelfRow.append(chip);
      if (here && sh.slug === here) toggleShelf(chip, true);
    }
    syncShelfRow();
  }

  function toggleShelf(chip: HTMLElement, on: boolean) {
    const id = chip.dataset.shelfId!;
    chip.classList.toggle('lchip--on', on);
    chip.setAttribute('aria-pressed', String(on));
    picked = on ? [...picked.filter((x) => x !== id), id] : picked.filter((x) => x !== id);
  }

  /** The row is the `jot` tab's, exactly as the picker above is the Log tab's. */
  function syncShelfRow() {
    if (shelfZone) shelfZone.hidden = kind !== 'jot' || !shelfRow?.children.length;
  }

  /**
   * File the note onto what is picked.
   *
   * ⚠ SEPARATE FROM THE TEXT SAVE, AND AFTER IT. There is nothing to file until
   * `saveWriting` has minted a row, and the 700ms autosave must not carry a
   * second write on every keystroke — so this runs on the same lock, once, and
   * only when the list has actually changed.
   */
  async function applyShelves() {
    if (!currentId) return;
    const want = picked.join(',');
    if (want === appliedShelves) return;
    const { error } = await callAction(actions.shelves.set({ noteId: currentId, shelfIds: picked }));
    // Quiet, like the autosave it rides behind: the words are saved either way,
    // and the pile is where an unfiled note will be visible.
    if (!error) appliedShelves = want;
  }
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
        // `embedUrl` — same reason as the writing sheet: the markdown carries
        // the image's own size for the public renderer (plan 43 §5).
        (
          await uploadImage(file, {
            pathFor: (hash, ext) => `essays/${(currentId ??= crypto.randomUUID())}/${hash}.${ext}`,
          })
        ).embedUrl,
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
    // ⚠ FILING RIDES THE SAME LOCK, AFTER THE TEXT. `applyShelves` needs the id
    // `persist` mints, and putting it on the lock is what stops a close racing
    // an in-flight save and filing a note that does not exist yet.
    lock = lock
      .then(persist)
      .then(applyShelves)
      .catch(() => {});
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
    /*
      ⚠ `picked` SURVIVES AND `appliedShelves` DOES NOT, and the asymmetry is the
      motion this shortcut exists for: ⌘/Ctrl+Enter is *emptying your head*,
      three or four dumps in a row without leaving the box. If you were filing
      those under `job applications`, the second one belongs there too — so the
      chips stay lit. What must reset is the record of having WRITTEN them,
      which belonged to the row just parked.
    */
    appliedShelves = '\u0000';
    // emitUpdate: false — TipTap fires `update` on setContent, which would arm
    // the debounce and try to save the blank we just handed over.
    editor.commands.setContent('', { emitUpdate: false });
    editor.commands.focus('end');
  }

  /* A chip toggles, and files immediately if there is already a row to file.
     Before the first save there is nothing to write to, and `save()` will carry
     the selection the moment one exists. */
  shelfRow?.addEventListener('click', (e) => {
    const chip = (e.target as Element).closest<HTMLElement>('[data-shelf-id]');
    if (!chip) return;
    const on = chip.getAttribute('aria-pressed') === 'true';
    /*
      ⚠ A THIRD PICK REPLACES THE OLDEST — the pile's chooser rule, and the
      server enforces the same cap (`MAX_SHELVES`). A control that simply stops
      responding teaches nothing; the swap shows you what the cap is by doing
      it. `picked` is append-ordered, so `[0]` is genuinely the oldest.
    */
    if (!on && picked.length >= MAX_SHELVES) {
      const oldest = shelfRow!.querySelector<HTMLElement>(`[data-shelf-id="${picked[0]}"]`);
      if (oldest) toggleShelf(oldest, false);
    }
    toggleShelf(chip, !on);
    if (currentId) void save();
  });

  newBtn.addEventListener('click', () => void startNew());
  // On the dialog rather than on the box: the shortcut has to work from the
  // toolbar and the foot as well, and a keystroke inside the editor bubbles
  // here anyway. Nothing in TipTap binds Mod-Enter, so nothing is being stolen.
  dialog.addEventListener('keydown', (e) => {
    /*
      ⚠ ⌘/Ctrl+Enter STAYS A JOT ACTION, whatever the tab says (Piece 4, closing
      plan 45 · §9's third question). It parks this thought and hands over a
      blank one — a motion for emptying your head, three or four dumps in a row
      without leaving the box.

      Filing is the opposite of that: it takes you out of the room. Binding the
      same keys to it would mean the fastest way to keep dumping had quietly
      become the fastest way to be somewhere else, and the difference would only
      show up once you had already gone. Done is where leaving lives, and it
      names the room it is taking you to.
    */
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
    openDialog(dialog!);
    // First open only; the pressed shelf is read from the URL in there, which is
    // why this is not hoisted to boot time — the ✚ can be opened from anywhere.
    void loadShelves();
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
    /*
      ⚠ THE FLUSH IS AWAITED, THE EXIT IS NOT, AND THE RELOAD WAITS FOR BOTH.
      Michael, 2026-08-15: *"it opens fine but immediately closes with no
      transition."* Two things were doing that, and only fixing both helps.

      The first was `dialog.close()`, which on any WebKit engine — so on every
      iOS browser, Chrome included — drops the box out of the top layer in the
      same frame and never renders the 0.2s fade. `closeWithExit` is the cure
      and the whole account is in scripts/dialog-close.ts.

      The second only bit in the Notes room and it beat the animation even on a
      desktop: a `location.reload()` on the very next line tore the page down a
      frame or two into the fade. Same failure the writing sheet had, same fix —
      let the exit finish first. It is a reload rather than an in-place refresh
      because the pile is server-rendered and prepending a card here would mean
      a second copy of the card's markup kept in step by hand.
    */
    await closeWithExit(dialog!);
    if (savedAnything && document.getElementById('notes-pile')) window.location.assign(landing());
  }

  /**
   * Where to re-read the pile — the view the note you just wrote is ACTUALLY in.
   *
   * ⚠ A BARE `location.reload()` COULD LAND YOU WHERE THE NOTE IS NOT, and that
   * is the second half of what Michael reported on 2026-09-18. Standing in
   * `?shelf=philosophy`, pressing ✚ and typing wrote the note to the inbox —
   * and then reloaded the shelf view, which does not contain it. The thought
   * was saved, the room said nothing, and the only honest reading from the
   * outside is that it went nowhere.
   *
   * The chips fix the common case by pre-selecting the shelf you are standing
   * in. This covers the rest: turn that chip OFF, or write from a shelf that
   * the note does not end up on, and the room follows the note rather than
   * leaving you looking at the view it just left.
   *
   * ⚠ IT ONLY EVER RELAXES THE SHELF FILTER, never tightens it and never
   * touches anything else. Sending you to a shelf you did not press would be
   * the ✚ navigating on your behalf; dropping to the inbox is returning to the
   * room's own default, which is where an unfiled note lives by definition. A
   * live `?q=` is left exactly as it was — narrowing it was the reader's
   * decision, and this function's whole licence is to undo a filter the note
   * has fallen out of, not to tidy the room.
   */
  function landing(): string {
    const url = new URL(window.location.href);
    const pressed = url.searchParams.get('shelf')?.trim();
    if (!pressed) return url.pathname + url.search;
    // On the shelf the room is filtered to? Then nothing moves, which is the
    // normal path now that the chip for it starts lit.
    if (picked.some((id) => slugOf.get(id) === pressed)) return url.pathname + url.search;
    // Otherwise the note is in the inbox — including when the vocabulary never
    // loaded, because then nothing could have been filed.
    url.searchParams.delete('shelf');
    return url.pathname + (url.search || '');
  }

  // ⚠ NOT `fab.addEventListener('click', open)` ANY MORE — the door is wired
  // below, outside `boot`, because by the time this line runs the click that
  // caused the boot has already happened and would never be replayed.
  /* ---- the declaration row (plan 45 · Piece 2) ----------------------------
     ⚠ THE TAB CHANGES WHERE **Done** GOES AND NOTHING ELSE. It does not change
     what is written while you type — that is always a note, because only the
     note tier can hold a half-typed thought (`tasks.save` wants a title,
     `saveQuote` wants words, `interactions.save` wants a person uuid). So the
     autosave above is untouched, and everything below is about the exit.

     ⚠ AND THE BUTTON SAYS WHERE IT IS TAKING YOU. Filing leaves the room you
     were standing in, which is a real cost and the one thing this dialog has
     always protected you from — Escape puts you back exactly where you were.
     A primary still reading "Done" while it navigates elsewhere would be the
     affordance lying. Naming the destination is how the control says it, so no
     sentence has to (10-hq §10i). */
  const ROUTES: Record<string, (id: string) => string> = {
    // Built in Piece 1: the corpus room fetches the jot by id and opens the
    // quote sheet already holding the words.
    quote: (id) => `/admin/fragments?new=quote&from=${encodeURIComponent(id)}`,
    agenda: (id) => `/admin/agenda/tasks?from=${encodeURIComponent(id)}`,
    // No `from=` for a piece, because there is nothing to consume: the jot IS
    // the draft after a status flip, which is what the pile's own "Make a
    // piece" does. The hash is the writing sheet's own door.
    piece: (id) => `/admin/fragments#edit=${id}`,
  };
  const DONE_LABEL: Record<string, string> = {
    jot: 'Done',
    agenda: 'Agenda →',
    quote: 'Quote →',
    piece: 'Piece →',
    log: 'Log →',
  };

  /* ---- the Log tab's picker (plan 45 · Piece 3) ---------------------------
     ⚠ THE PERSON IS THE ADDRESS, NOT A FIELD. Every other tab declares a room
     and goes; a log entry's room is somebody's profile, so there is nowhere to
     go until you have said who. Everything else an entry needs — the kind, the
     date, who else was there — has an honest default and is collected there,
     which is `LogSheet`'s own rule: *"there is no defensible default for whose
     life this was."*

     ⚠ AND THE ROSTER LOADS ON FIRST USE, not on render. The layout mounts this
     dialog on every admin page and knows only `locals.hasRoster` — one count.
     Fetching the names here would be plan 45 · §4d's cost paid by every page
     view for a tab most of them never open. */
  const whoRow = dialog.querySelector<HTMLElement>('[data-cap-who]');
  const combo = document.getElementById('cap-who') as
    | (HTMLElement & {
        setOptions?: (o: { id: string; name: string }[]) => void;
        getId?: () => string;
        getName?: () => string;
      })
    | null;
  /** `person id → slug`, because the profile is addressed by slug. */
  const slugs = new Map<string, string>();
  let rosterLoaded = false;

  async function loadRoster() {
    if (rosterLoaded || !combo) return;
    rosterLoaded = true;
    const { data, error } = await callAction(actions.people.roster());
    if (error || !data) {
      rosterLoaded = false; // let the next open try again
      return flash('Couldn’t load the roster', true);
    }
    slugs.clear();
    combo.setOptions?.(
      data.map((p) => {
        slugs.set(p.id, p.slug);
        return { id: p.id, name: p.display_name };
      }),
    );
  }

  let kind = 'jot';
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[data-cap-tab]')];
  // Arrow keys and one tab stop, from the same wiring every other segmented
  // control in the Observatory uses. It only FOLLOWS `aria-checked`; `pick` is
  // what moves it (see radio-group.ts).
  wireRadioGroups(dialog);
  for (const tab of tabs) {
    tab.addEventListener('click', (e) => {
      kind = tab.dataset.capTab!;
      // ⚠ `'cap-tab'` — the attribute as it is SPELLED IN THE MARKUP, never the
      // camel-case `dataset` key. radio-group.ts carries the whole account of
      // what that confusion cost the goal sheet.
      pick(dialog, 'cap-tab', kind);
      doneBtn.textContent = DONE_LABEL[kind] ?? 'Done';
      if (whoRow) whoRow.hidden = kind !== 'log';
      // The shelf row belongs to `jot` the way the picker belongs to `log`: the
      // other three tabs take the thought OUT of the pile, so filing it would
      // be shelving something that is about to stop existing.
      syncShelfRow();
      if (kind === 'log') void loadRoster();

      /*
        ⚠ ONLY A POINTER MOVES THE CARET, AND ARROW KEYS MUST NOT (Piece 4).
        `wireRadioGroup` walks this row by calling `.click()` on the next
        option — so putting the caret back in the box on every click meant the
        FIRST arrow key yanked focus out of the group and the second one went
        to the editor instead. The row was navigable exactly one step, which is
        the sort of half-working a keyboard user meets and a mouse never does.

        `detail` is the discriminator the DOM already provides: a real press
        counts clicks and reports 1 or more; a synthesised one reports 0.
      */
      if (e.detail === 0) return;
      if (kind === 'log') {
        // The words are usually already written by the time you say what they
        // are; on this tab the unanswered question is who, so the caret goes
        // there rather than back to a box you have finished with.
        combo?.querySelector('input')?.focus();
        return;
      }
      // Everywhere else the words are the point, and a tap on the row must not
      // cost you the caret.
      editor.commands.focus('end');
    });
  }

  /**
   * Park the thought, then go where the tab says.
   *
   * ⚠ THE SAVE IS AWAITED FIRST, and it has to be: every route is built from
   * the jot's ID, and a jot that has never been saved does not have one. This
   * is also what keeps *an empty box is never a row* true — nothing was typed,
   * nothing was written, so there is nowhere to go and the ✚ closes as it
   * always did rather than inventing a destination for a thought that does not
   * exist.
   *
   * ⚠ THE FLIP HAPPENS BEFORE THE NAVIGATION, on purpose. `piece` is the one
   * route that changes the row itself, and doing it here means the writing
   * sheet opens on a draft rather than on a note it would have to promote. A
   * failure stops the trip and says so — the words are saved either way, which
   * is the promise that matters.
   */
  async function fileAs(k: string) {
    if (k === 'jot' || (!ROUTES[k] && k !== 'log')) return close();
    window.clearTimeout(timer);
    await save();
    if (!currentId) return close();

    /*
      ⚠ WHO FIRST, THEN THE PERSON ROW, THEN THE TRIP — and the jot is consumed
      last of all, in the room at the other end. Every step leaves something you
      can see if the next one fails: a jot in the pile, or a person on the roster
      with no entry against them yet.

      ⚠ CREATING SOMEBODY IS ALLOWED HERE (Michael, 2026-08-24: *"yes we can
      create"*). "Coffee with Sam" where Sam is new is an ordinary capture, and
      refusing it would send you to the roster and back for a name you have
      already typed. `EntityCombo`'s own *＋ Add «name»* row is the affordance;
      this is the write behind it.

      ⚠ THE CIRCLE IS A PLACEHOLDER, AND IT HAS TO BE ONE. `people.save` demands
      family | friends | professional and the ✚ was told a NAME — guessing which
      circle somebody belongs to is a judgement about a relationship, and this
      box has no business making it silently. What saves it is where you land:
      their profile, with the circle on screen and one tap from correct. Any
      default would be wrong sometimes; this one is wrong visibly.
    */
    if (k === 'log') {
      const id = combo?.getId?.() ?? '';
      const name = (combo?.getName?.() ?? '').trim();
      if (!id && !name) {
        // Not a disabled button — an inert control that looks live is the fault
        // 14 §10f caught with a screenshot. It says what is missing, and puts
        // the caret where the answer goes.
        flash('Who was it?', true);
        combo?.querySelector('input')?.focus();
        return;
      }
      let slug = id ? slugs.get(id) : undefined;
      if (!slug) {
        // ⚠ THE NULLS ARE SPELLED OUT because `facts` is the PersonSheet's own
        // schema, and that form submits every field. Nothing here is unknown in
        // a way the sheet's blanks are not — a person the ✚ just met has no
        // epithet and no birthday either — so the shape is honest rather than
        // padding: what the ✚ was given is a name, and it says so in eight
        // fields' worth of nothing.
        const { data, error } = await callAction(
          actions.people.save({
            displayName: name,
            circle: 'friends',
            epithet: null,
            location: null,
            birthMonth: null,
            birthDay: null,
            birthYear: null,
            knownSinceYear: null,
          }),
        );
        if (error || !data) return flash('Couldn’t add them — the jot is still here', true);
        slug = data.slug;
      }
      window.location.href = `/admin/people/${slug}?from=${encodeURIComponent(currentId)}`;
      return;
    }

    if (k === 'piece') {
      const fd = new FormData();
      fd.set('ids', currentId);
      fd.set('op', 'draft');
      const { error } = await callAction(actions.fragments.bulk(fd));
      if (error) return flash('Couldn’t make it a piece — it’s still in the pile', true);
    }
    window.location.href = ROUTES[k](currentId);
  }

  doneBtn.addEventListener('click', () => void fileAs(kind));
  // `cancel` fires for Escape and precedes `close`; take it over so the flush
  // has somewhere to happen before the dialog goes.
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    void close();
  });
  // Click outside the shell — the backdrop is the <dialog> itself, and the
  // press has to both START and END there.
  //
  // ⚠ THIS BOX IS THE WORST PLACE IN THE TREE TO GET THAT WRONG, which is why
  // it is the first of the four that were missing it (docs/plans/25 · §3).
  // Closing here FLUSHES — so a right-to-left selection across a sentence that
  // overshoots the edge used to end the thought and file it, mid-word. The box
  // exists so a thought at 11pm costs fifteen seconds; losing one to a drag is
  // the opposite of that.
  onBackdropDismiss(dialog, () => void close());

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
