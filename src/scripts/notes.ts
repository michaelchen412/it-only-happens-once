// Client logic for /admin/notes — the pile (14 · Piece 1).
//
// THE DOM IS THE STATE, as everywhere else in HQ. A card carries its own id,
// its concurrency token and its slug; there is no JavaScript copy of the pile
// beside the pile.
//
// SIX MOTIONS, and the whole room is these six:
//   · open it              — the pencil, or the words themselves (plan 46)
//   · delete               — soft, with a way back
//   …and four ways OUT, behind the → chooser (14 · Piece 2):
//   · add to the Agenda    — READ first, then a task or an event (14 · Piece 3)
//   · log an entry         — a sheet that asks who first
//   · make it a piece      — one status flip: same row, no copy (14 §3)
//   · add to a piece       — the one genuine copy, so the dump is consumed
//
// ⚠ READING IS THE DOMINANT MOTION HERE, which is why the text is a `<div>` and
// nothing in the pile is ever editable. The alternative — a pile of live
// editors — was better on paper and worse in the hand: on a phone, every tap
// while scrolling past a thought would put a cursor in it and throw the
// keyboard up over the pile you were trying to read.
//
// ⚠ AND THAT EDITOR IS TIPTAP NOW (2026-08-06), not a textarea. Michael asked
// for the writing sheet's formatting in the pile as well — *"I think those are
// important still to have, even though they take up a little bit of UI space"*
// — so a dump's body is genuinely Markdown and the card renders it.
//
// ⚠⚠ THE EDITOR LEFT THE CARD ENTIRELY ON 2026-08-26 (plan 46). It used to be
// one shell MOVED into whichever card was open, and the card grew to whatever
// height the document wanted: a 900-word dump took the page from 2,122px to
// 3,181px at a desk and to 5,444px at 390px, with every other thought pushed
// off screen. Michael: *"it becomes a huge, stretched-out editor, and I can't
// browse anything else."*
//
// So the pencil opens `NoteSheet` — a drawer with the pile beside it — and the
// card is words from first render to last. What that DELETED is most of what
// used to live here: the shell's travel, the hand-back ordering, the belt in
// `finish()`, the click-away close, the in-card Escape. The hidden `<textarea>`
// stays, because the destinations still read a card that has no editor.
//
// THE SHEET-BASED DESTINATIONS ANNOUNCE RATHER THAN TIDY. `hq:note-filed`
// arrives from task-sheet.ts, event-sheet.ts and log-sheet.ts; consuming the
// dump, collapsing the card and offering the way back all happen here — so "a
// dump left the pile" has exactly one implementation rather than one per
// destination.
import { actions } from 'astro:actions';
import { elapsedSince } from '../lib/hq/dates';
import { stripMarkdown } from '../lib/markdown-plain';
import { wireAltDialog } from './alt-dialog';
import { anchorPopover } from './pop-anchor';
import { MIN_SEARCH } from '../lib/search-highlight';
import { MAX_SHELVES } from '../lib/shelves';
import { mountRichEditor } from './rich-editor';
import { uploadImage } from './upload';
import { closeWithExit, openDialog } from './dialog-close';
import { wireSheetDismiss } from './sheet-dismiss';
import { onBackdropDismiss } from './backdrop-close';

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
    undoBar!.querySelectorAll('a').forEach((a) => a.remove()); // and its way onward
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
    // ⚠ THE BELT THAT STOOD HERE IS GONE, and its absence is the point. It read
    // `if (shell.parentElement === pending.card) homeShell()` — because the
    // room's one editor used to LIVE inside whichever card was open, and a card
    // leaving the pile could carry it into the void and leave the pencil dead
    // everywhere else. The editor lives in the sheet now (plan 46), so a card
    // is only ever words and can be removed without consulting anything.
    pending.card.remove();
    pending = null;
    // The empty state is server-rendered, so an emptied pile would otherwise
    // sit here as a blank page rather than saying so.
    if (pile && !pile.querySelector('.dump')) window.location.reload();
  }

  /**
   * A way ONWARD on the strip, beside (or instead of) the way back. Added
   * imperatively because only some motions have somewhere to point, and it is
   * removed on the same clock as the strip so a dead link never outlives it.
   */
  function addStripLink(href: string, label: string) {
    const link = document.createElement('a');
    link.href = href;
    link.className = 'btn btn-xs btn-ghost font-sans';
    link.textContent = label;
    undoBtn.after(link);
    window.setTimeout(() => link.remove(), UNDO_MS);
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

  /* ── the open note ──────────────────────────────────────────────────────── */

  /** The card the sheet is open on, or null. The DOM is still the state. */
  let editing: HTMLElement | null = null;
  let saveTimer: number | undefined;
  let lock: Promise<unknown> = Promise.resolve();

  const textOf = (card: HTMLElement) => card.querySelector<HTMLElement>('[data-text]')!;
  const boxOf = (card: HTMLElement) => card.querySelector<HTMLTextAreaElement>('[data-edit-box]')!;
  const stampOf = (card: HTMLElement) => card.querySelector<HTMLTimeElement>('[data-ago]')!;
  /** What a card's stamp says at rest, after the line has been borrowed. */
  const atRest = (card: HTMLElement) => (card.dataset.updated ? elapsedSince(card.dataset.updated) : '');

  /* ── the sheet ──────────────────────────────────────────────────────────── */

  const sheet = document.getElementById('nsheet') as HTMLDialogElement | null;
  const sheetShell = document.getElementById('nsheet-shell');
  const doc = document.getElementById('ns-doc');
  const railRows = document.getElementById('ns-rail');
  const nsStamp = document.getElementById('ns-stamp') as HTMLTimeElement | null;
  const nsWords = document.getElementById('ns-words');
  const pileBtn = document.getElementById('ns-pile') as HTMLButtonElement | null;

  const { editor, getMarkdown } = mountRichEditor({
    editorEl: document.getElementById('ns-editor')!,
    toolbarRoot: document.querySelector('.nsheet__tools') as HTMLElement,
    linkDialog: document.getElementById('dump-link-dialog') as HTMLDialogElement,
    placeholder: 'Write it down…', // the ✚'s words, for a thought you emptied
    ariaLabel: 'Edit this note',
    // ⚠ NOT `jot-prose` ANY MORE. That class carried the CARD's metrics so the
    // words would not move when an editor arrived in their place — a promise
    // this room no longer has to keep, because the editor is somewhere else
    // entirely. The sheet sets its own, at document scale (hq.css).
    docClass: 'ns-prose',
    // ⚠ A dump's newlines are its shape, and every one written before this
    // editor existed is plain text. See rich-editor's `breaks` for the whole
    // argument; the card renders to match.
    breaks: true,
    images: {
      // `essays/<id>/` rather than `notes/<id>/`, because "make it a piece" is
      // a status flip on this very row — the picture must not need moving when
      // the thought graduates. The id is read at upload time from the card the
      // sheet is open on, which is the only card an upload can come from.
      upload: async (file) => {
        const id = editing?.dataset.note;
        if (!id) throw new Error('No note is open');
        // `embedUrl` — the dims ride along so the picture keeps its box when
        // this note graduates to a public piece (plan 43 §5).
        return (await uploadImage(file, { pathFor: (hash, ext) => `essays/${id}/${hash}.${ext}` })).embedUrl;
      },
      askAlt: wireAltDialog(document.getElementById('dump-alt-dialog') as HTMLDialogElement),
      // ⚠ IT HAS TO REACH THE SHEET'S STAMP, and `say` is what guarantees it:
      // the card is behind a backdrop while an upload runs, so a notice written
      // only there would be reported to nobody. Both stamps carry it, and both
      // go back to the elapsed line when the upload ends.
      onStatus: (m) => editing && say(editing, m || atRest(editing)),
      onError: (m) => editing && say(editing, m),
    },
    onChange: () => {
      if (!editing) return;
      const card = editing;
      sayWords();
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => void save(card), DEBOUNCE_MS);
    },
  });

  /**
   * This card's Markdown. From the editor while its note is the open one, from
   * the hidden carrier otherwise — the carrier is what every other card has
   * instead of an editor of its own.
   */
  const markdownOf = (card: HTMLElement) => (editing === card ? getMarkdown() : boxOf(card).value);

  /**
   * ⚠ COUNTED OFF THE EDITOR'S TEXT, NOT ITS MARKDOWN. `getMarkdown()` would
   * count `**` and `###` as part of the words they format, so a dump full of
   * headings would read heavier than it is — the same reason the pile renders
   * rather than prints.
   */
  function sayWords() {
    if (!nsWords) return;
    const t = editor.getText().trim();
    const n = t ? t.split(/\s+/).length : 0;
    nsWords.textContent = n === 1 ? '1 word' : `${n} words`;
  }

  /** One save of the open note. Quiet on failure — the words are still on screen. */
  async function persist(card: HTMLElement): Promise<void> {
    const box = boxOf(card);
    const text = markdownOf(card);
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
        say(card, error?.code === 'CONFLICT' ? 'changed elsewhere — reload' : 'not saved');
        return;
      }
      card.dataset.updated = data.updated_at;
      card.dataset.slug = data.slug;
      card.dataset.saved = text;
      // The carrier follows every save, so the five destinations read what is
      // actually stored even mid-edit.
      box.value = text;
      stampOf(card).dateTime = data.updated_at;
      say(card, elapsedSince(data.updated_at));
    } catch {
      say(card, 'not saved');
    }
  }

  /**
   * Say something on this card's stamp — and on the sheet's too while it is the
   * open one. ⚠ BOTH, because they are two renderings of one fact and the sheet
   * is the only one you can see while it is up.
   */
  function say(card: HTMLElement, text: string) {
    stampOf(card).textContent = text;
    if (editing === card && nsStamp) nsStamp.textContent = text;
  }

  const save = (card: HTMLElement) => {
    lock = lock.then(() => persist(card)).catch(() => {});
    return lock;
  };

  /* ── the rail ───────────────────────────────────────────────────────────── */

  /**
   * Built from the cards themselves every time the sheet opens, so it can never
   * describe a pile one edit out of date — this room is ordered by when a
   * thought was last touched, and touching one is exactly what you came here
   * to do.
   *
   * The label is the note's first non-empty line with any heading marks off:
   * the pile has no titles, and inventing one for a rail would be the middle
   * ground arriving in a costume (14 §9a).
   */
  function buildRail(current: HTMLElement) {
    if (!railRows || !pile) return;
    railRows.textContent = '';
    pile.querySelectorAll<HTMLElement>('.dump').forEach((card) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ns-row';
      row.dataset.railFor = card.dataset.note ?? '';

      const first = (
        boxOf(card)
          .value.split('\n')
          .find((l) => l.trim()) ?? ''
      ).replace(/^#+\s*/, '');
      const line = document.createElement('span');
      line.textContent = first.slice(0, 80) + (first.length > 80 ? '…' : '');
      row.append(line);

      const when = document.createElement('span');
      when.className = 'ns-row__when';
      // ⚠ CLONED FROM THE HEAD'S CLOCK rather than hand-rolled as inline SVG.
      // `astro-icon` renders at build time, so a row built in the browser cannot
      // ask for one — and an SVG retyped here would be a second copy of a mark
      // the `astro.config` allowlist owns, free to drift from it.
      const clock = nsStamp?.parentElement?.querySelector('svg');
      if (clock) when.append(clock.cloneNode(true));
      const ago = document.createElement('span');
      ago.textContent = card.dataset.updated ? elapsedSince(card.dataset.updated) : '';
      when.append(ago);
      row.append(when);

      if (card === current) row.setAttribute('aria-current', 'true');
      railRows.append(row);
    });
  }

  /**
   * The phone's rail slides OVER the note, because at 390px a 16rem rail beside
   * a readable measure is not tight, it is impossible. ⚠ IT CLOSES ON PICK,
   * which is what makes it a detail view rather than a menu left open: choosing
   * a note is choosing to read it. Above the breakpoint this attribute is inert
   * — the rail is a column and nothing about it moves.
   */
  function setRail(open: boolean) {
    if (!sheetShell) return;
    if (open) sheetShell.dataset.railOpen = '1';
    else delete sheetShell.dataset.railOpen;
    pileBtn?.setAttribute('aria-expanded', String(open));
  }

  pileBtn?.addEventListener('click', () => setRail(!sheetShell?.dataset.railOpen));
  sheet?.querySelector('[data-ns-scrim]')?.addEventListener('click', () => setRail(false));

  railRows?.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('[data-rail-for]');
    if (!row) return;
    const card = pile?.querySelector<HTMLElement>(`[data-note="${row.dataset.railFor}"]`);
    if (!card || card === editing) return;
    void handOver(card);
  });

  /* ── opening, handing over, closing ─────────────────────────────────────── */

  /**
   * ⚠ THE DOM WORK HAPPENS BEFORE THE AWAIT, deliberately, and this ordering
   * survived the editor leaving the card. It is one editor for the whole pile,
   * so a save left in front of the hand-over would let the next note claim the
   * editor and the previous one's tail then overwrite it. The promise is still
   * returned, because the motions that move a card out of the pile need the
   * save landed before they flip its status.
   */
  function flush(card: HTMLElement): Promise<unknown> {
    window.clearTimeout(saveTimer);
    const box = boxOf(card);
    box.value = getMarkdown();
    /*
      The rendered twin comes from the editor's own document rather than from a
      Markdown round trip: it is the exact thing that was on screen a moment
      ago, and it costs no parser in the browser. `innerHTML` is safe here in a
      way it usually isn't — this string is written by ProseMirror's serializer
      out of a schema with no script node and no event-handler attribute, so it
      cannot express one. The public renderer still sanitizes (lib/markdown).
    */
    const text = textOf(card);
    text.innerHTML = editor.getHTML();
    // An edited thought may have grown past the clamp, or shrunk under it.
    const long = box.value.split('\n').length > 10 || box.value.length > 700;
    text.classList.toggle('dump__text--clamped', long && !text.dataset.expanded);
    const more = card.querySelector<HTMLElement>('[data-more]');
    if (more) more.hidden = !long || !!text.dataset.expanded;
    return save(card);
  }

  function load(card: HTMLElement) {
    editing = card;
    editor.commands.setContent(boxOf(card).value, { emitUpdate: false });
    /*
      ⚠ THE BASELINE IS WHAT THE EDITOR WOULD WRITE, not what the server sent,
      and the difference is the whole reason this line has a comment.

      Opening a thought to re-read it must not rewrite the row — that would move
      it to the top of a pile ordered by when things were last touched. But a
      dump typed before this editor existed is plain text, and a round trip
      through TipTap re-spells it (a newline becomes Markdown's `\` hard break).
      Comparing against the server's copy would call that a change and save it,
      on every note you so much as opened. Comparing against the editor's own
      serialization asks the question that actually matters: did the DOCUMENT
      change?
    */
    card.dataset.saved = getMarkdown();
    if (nsStamp) {
      nsStamp.dateTime = card.dataset.updated ?? '';
      nsStamp.textContent = card.dataset.updated ? elapsedSince(card.dataset.updated) : '';
    }
    sayWords();
    buildRail(card);
    setRail(false);
    /*
      ⚠ THE TOP, AND THE CARET AT THE START — ruled 2026-08-26, against the
      card's own `focus('end')`. A card is short enough that landing at its end
      is invisible; this drawer is where you come to RE-READ a long dump, and
      opening one at its last line is opening it at the wrong end. `setContent`
      has already put the selection at the start; scrolling the pane is the
      other half, since the previous note may have left it anywhere.
    */
    doc?.scrollTo({ top: 0 });
    editor.commands.focus('start');
  }

  function openSheet(card: HTMLElement) {
    if (!sheet || editing === card) return;
    load(card);
    if (!sheet.open) openDialog(sheet);
  }

  /** Note to note without leaving — the rail's whole proposition. */
  async function handOver(card: HTMLElement) {
    if (!editing) return openSheet(card);
    const outgoing = editing;
    editing = null; // the DOM work below must not be attributed to the new one
    const landed = flush(outgoing);
    load(card);
    setRail(false);
    await landed;
  }

  async function closeSheet() {
    if (!sheet?.open) return;
    const card = editing;
    editing = null;
    const landed = card ? flush(card) : Promise.resolve();
    await closeWithExit(sheet);
    await landed;
  }

  if (sheet) {
    // ✕, Escape and the backdrop, all three flushing first — `closeSheet` is
    // what dismissal MEANS here, which is why the helper takes a callback
    // rather than closing the dialog itself.
    wireSheetDismiss(sheet, () => void closeSheet(), '[data-ns-close]');

    /*
      ⚠ AND ESCAPE STILL HAS TO BE CLOSED BY HAND ON TOP OF THAT.

      A `<dialog>` turns Escape into a close request only if the keydown's
      default survives, and `prosemirror-view`'s `captureKeyDown` preventDefaults
      keyCode 27 unconditionally — so inside this editor the `cancel` event
      `wireSheetDismiss` listens for never fires at all. The helper is right and
      complete for a sheet full of inputs; it is half a rule for one whose body
      is a rich editor. `capture.ts` carries this same second half, and
      `notes.spec.ts` and `checkin.spec.ts` both pin it, which is why this is a
      known trap rather than a discovery.

      `preventDefault` here too, deliberately: focus on the toolbar or the foot
      is OUTSIDE the editor, where nothing swallows the key and the native
      `cancel` does fire — claiming the default keeps the two paths from running
      two closes on top of each other.
    */
    sheet.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      void closeSheet();
    });

    // The five destinations and the bin, on the note in view. ⚠ EVERY ONE OF
    // THEM DISPATCHES INTO THE SAME FUNCTIONS THE CARD'S → CHOOSER CALLS — see
    // `fileAs` below. A second implementation of "make it a quote" in this
    // building is the one outcome this foot must never produce.
    sheet.querySelector('.nsheet__foot')?.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest<HTMLElement>('[data-as], [data-ns-delete]');
      if (!btn || !editing) return;
      const card = editing;
      if (btn.hasAttribute('data-ns-delete')) void leaveThen(card, () => discard(card));
      else void leaveThen(card, () => fileAs(card, btn.dataset.as!));
    });
  }

  /**
   * A destination chosen from inside the sheet. ⚠ THE SHEET GOES FIRST, and the
   * order is not cosmetic: every one of these either moves the card out of the
   * pile or navigates away, and a drawer still standing over a card that is
   * fading out of the room behind it is a way to lose track of what just
   * happened. `closeSheet` also flushes, so the destination reads the words you
   * just typed rather than the ones the debounce had got to.
   */
  async function leaveThen(card: HTMLElement, act: () => unknown) {
    await closeSheet();
    await act();
    void card;
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

  /**
   * Make it a piece — the one destination that writes nothing new.
   *
   * `note → draft` on the row you already typed: same id, same text, same
   * history. This is the motion that decided 14 §3's storage fork, so it stays
   * a single status flip and never grows into a copy.
   */
  async function promote(card: HTMLElement) {
    const id = card.dataset.note!;
    try {
      await bulk(id, 'draft');
    } catch {
      stampOf(card).textContent = 'could not promote it';
      return;
    }
    showUndo('Now a draft', card, () => bulk(id, 'note'));
    addStripLink(`/admin/fragments#edit=${id}`, 'Open →');
  }

  /**
   * A dump on its way to the Agenda — read first, then handed to whichever
   * sheet the reading says it belongs in (14 · Piece 3, §6).
   *
   * ⚠ ONE ROW IN THE CHOOSER, NOT TWO, and that is the whole point. Michael,
   * 2026-08-04: *"I don't want the cognitive expenditure of thinking: is this
   * more of an event or more of a task?"* Tasks and events share every surface
   * — the calendar grid, Today — so the question is about shape, not about
   * where a thought goes, and much of it is not judgement at all: a repeat or a
   * lead CANNOT be an event, because the table has neither column.
   *
   * ⚠ BUT NEVER SILENTLY. The sheet that opens says which it chose and why, and
   * offers the other in one tap. That is 10-hq §4.21's ban narrowed rather than
   * broken: the model still never decides between a task, a log entry and a
   * piece — only between two rows that live in the same room, in front of you,
   * before anything is written.
   *
   * ⚠ AND IT DEGRADES. No key, a dead model, a slow network: the sheet opens
   * anyway with the naive first-line split, which is exactly what shipped in
   * Piece 2. Nothing here can ever be worse than not having the parser.
   */
  async function toAgenda(card: HTMLElement) {
    const text = plainOf(card);
    const stamp = stampOf(card);
    const wasSaying = stamp.textContent;
    stamp.textContent = 'reading…';

    let parsed: Record<string, unknown> | null = null;
    let why = '';
    try {
      const { data } = await actions.tasks.parse({ text });
      parsed = (data?.parsed as Record<string, unknown> | null) ?? null;
      why = data?.why ?? '';
    } catch {
      // Silence is the correct handling: the fallback below IS the behaviour
      // this room had yesterday, and an error message in front of a working
      // motion would be the parser making things worse by existing.
    }
    stamp.textContent = wasSaying;

    const kind = parsed?.kind === 'event' ? 'hq:event-open' : 'hq:task-open';
    document.dispatchEvent(new CustomEvent(kind, { detail: { noteId: card.dataset.note, text, parsed, why } }));
  }

  // The switch in either sheet comes back here, so one place decides which
  // sheet opens and both sheets stay ignorant of each other.
  document.addEventListener('hq:kind-switch', (e) => {
    const detail = (e as CustomEvent<{ to: 'task' | 'event' }>).detail;
    document.dispatchEvent(new CustomEvent(detail.to === 'event' ? 'hq:event-open' : 'hq:task-open', { detail }));
  });

  /* ── the chooser ────────────────────────────────────────────────────────── */

  const chooser = document.getElementById('dump-file');
  /** Which card's → is open. The menu is one element shared by the whole pile. */
  let choosing: HTMLElement | null = null;
  if (chooser) anchorPopover(chooser, () => choosing?.querySelector<HTMLElement>('[data-file]'));

  /*
   * What this card says, for a field that cannot render Markdown.
   *
   * ⚠ THE MARKS COME OFF ON THE WAY OUT. A task's title is an `<input>` and a
   * log entry's body is a `<textarea>`; handing either `**call mom**` would
   * leak the asterisks into a field you then have to clean by hand. Stripping
   * is only right for these two doors — **Add to a piece…** appends Markdown
   * to Markdown on the server, which is the one destination that wants it
   * whole, and it never comes through here.
   */
  const plainOf = (card: HTMLElement) => stripMarkdown(markdownOf(card));

  /**
   * ⚠ ONE IMPLEMENTATION OF "WHERE THIS THOUGHT IS GOING", called from two
   * places (plan 46). The pile's → chooser dispatches here, and so does the
   * sheet's foot — which is the whole reason this is a named function rather
   * than a `switch` living inside a click handler. A second copy of "make it a
   * quote" is the one thing that change was not allowed to produce.
   *
   * The caller owns getting out of the way first: the chooser hides its
   * popover, the sheet closes and flushes.
   */
  function fileAs(card: HTMLElement, as: string) {
    switch (as) {
      case 'agenda':
        void toAgenda(card);
        break;
      case 'log':
        document.dispatchEvent(
          new CustomEvent('hq:log-open', { detail: { noteId: card.dataset.note, text: plainOf(card) } }),
        );
        break;
      case 'quote':
        /*
          ⚠ THE ONE DESTINATION THAT LEAVES THIS ROOM, and the reason is the
          SHEET rather than the motion. A task's sheet and a log entry's sheet
          are mounted here — small forms over data this page already holds. The
          quote sheet is two `EntityCombo`s over every author and every work,
          plus subjects, plus Shared by; mounting it here would hang three more
          queries on a room whose whole job is a pile you can open fast.

          So the jot travels as an ID and the corpus room does the collecting —
          the same arrival `?person=…&new=quote` has used from a profile since
          12 · Piece 3. The body is fetched there, never carried in the URL.

          ⚠ NO UNDO STRIP FOR THIS ONE, and that follows from leaving rather than
          from a change of mind about undo: the strip lives on this page and you
          will not be on this page. What stands in for it is stronger for being
          immediate — nothing leaves the pile until the quote is SAVED, and once
          it is, the quote is the thing in front of you. Abandon the sheet and
          the jot is exactly where you left it. (Michael ruled the same question
          for the ✚ on 2026-08-24: *"no undo for now."*)
        */
        window.location.href = `/admin/fragments?new=quote&from=${encodeURIComponent(card.dataset.note ?? '')}`;
        break;
      case 'piece':
        void promote(card);
        break;
      case 'append':
        openFiler(card);
        break;
    }
  }

  /**
   * The bin, from either surface. ⚠ NO CONFIRM DIALOG — a jotting is not worth
   * a modal, and the undo strip is a cheaper way back than a question in front
   * of every delete. Named for the same reason `fileAs` is: the card's 🗑 and
   * the sheet's both call it, and neither owns it.
   */
  async function discard(card: HTMLElement) {
    const id = card.dataset.note!;
    try {
      await bulk(id, 'trash');
    } catch {
      say(card, 'could not delete it');
      return;
    }
    showUndo('Deleted', card, () => bulk(id, 'restore'));
  }

  chooser?.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('[data-as]');
    if (!row || !choosing) return;
    const card = choosing;
    chooser.hidePopover();
    fileAs(card, row.dataset.as!);
  });

  /* ── the search field ─────────────────────────────────────────────────────
     A `<form method="get">`, so Enter works with no script at all — the debounce
     below is a convenience on top of a control that already functions.

     ⚠ THE SAME `MIN_SEARCH` COMPARISON THE OTHER TWO CONSUMERS MAKE
     (docs/search.md §3: one constant, and now six enforcement sites). Below it
     the term never reaches the URL, so typing or clearing a single letter costs
     no navigation and no stray `?q=a` lands in history. */
  const qField = document.querySelector<HTMLInputElement>('[data-notes-q]');
  const qForm = qField?.closest('form');
  if (qField && qForm) {
    const effective = (raw: string) => (raw.trim().length >= MIN_SEARCH ? raw.trim() : '');
    let last = effective(qField.value);
    let timer = 0;
    qField.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = effective(qField.value);
        if (next === last) return; // nothing the server would answer differently
        last = next;
        // ⚠ SUBMIT THE FORM rather than building a URL: the shelf rides along in
        // a hidden field, so the pressed-shelf half of the escape rule is kept
        // by the markup instead of being re-derived here and drifting from it.
        qField.value = next || qField.value.trim();
        qForm.submit();
      }, 260);
    });
    // A navigation destroys focus, and a field you must re-click after every
    // keystroke-batch cannot be typed in. Caret to the end, not to 0.
    if (qField.value) {
      qField.focus();
      qField.setSelectionRange(qField.value.length, qField.value.length);
    }
  }

  /* ── shelves: the fifth destination, and the only one that KEEPS the note ──
     Bench /lab/shelves, decided 2026-09-01. Everything above this line moves a
     thought OUT of the pile; a shelf is how it stays in without still counting
     as un-triaged. Unshelved is the inbox. */

  /** A shelf as the chooser and the chips both carry it: id writes, name shows,
      slug answers "is this the shelf the room is currently filtered to". */
  type ShelfPick = { id: string; name: string; slug: string };

  const newForm = chooser?.querySelector<HTMLFormElement>('[data-shelf-new-form]');
  const newField = newForm?.querySelector<HTMLInputElement>('input');

  /** What a card says it is on. ⚠ THE DOM IS THE STATE, as everywhere in HQ. */
  const shelfIdsOf = (card: HTMLElement) =>
    [...card.querySelectorAll<HTMLElement>('[data-shelf-id]')].map((c) => c.dataset.shelfId!);

  /**
   * Redraw a card's chips. Server-rendered on load and re-rendered here after a
   * write — the one place both spellings meet, which is why the markup is this
   * short and lives beside the `<span data-shelf-id>` it mirrors.
   */
  function drawShelves(card: HTMLElement, refs: ShelfPick[]) {
    const slot = card.querySelector<HTMLElement>('[data-shelves]');
    if (!slot) return;
    slot.textContent = '';
    for (const r of refs) {
      const chip = document.createElement('span');
      chip.className = 'dump__shelf';
      chip.dataset.shelfId = r.id;
      chip.dataset.shelfSlug = r.slug;
      chip.textContent = r.name;
      slot.append(chip);
    }
  }

  /** The badge numbers above the pile, nudged rather than re-queried. */
  function bumpBadge(shelfId: string | 'inbox', delta: number) {
    const sel = shelfId === 'inbox' ? '[data-shelf-badge="inbox"]' : `[data-shelf-badge="${shelfId}"]`;
    const el = document.querySelector<HTMLElement>(sel);
    if (el) el.textContent = String(Math.max(0, Number(el.textContent ?? 0) + delta));
  }

  /**
   * Write a note's shelves and reflect it.
   *
   * ⚠ THE CARD ONLY LEAVES IF IT NO LONGER BELONGS IN THE VIEW YOU ARE IN, and
   * that is the whole of what makes filing feel like triage in the inbox and
   * like an edit everywhere else. In the inbox, shelving a note is the note
   * going away — so it gets `showUndo`, the same strip a delete gets, because
   * it is exactly as reversible. On a shelf, or mid-search, nothing vanishes
   * and a strip would be an apology for something that did not happen.
   */
  async function setShelves(card: HTMLElement, next: ShelfPick[]) {
    const id = card.dataset.note!;
    const before = shelfIdsOf(card);
    try {
      const { error } = await actions.shelves.set({ noteId: id, shelfIds: next.map((s) => s.id) });
      if (error) throw new Error(error.message);
    } catch {
      say(card, 'could not file it');
      return;
    }

    const nextIds = next.map((s) => s.id);
    for (const was of before) if (!nextIds.includes(was)) bumpBadge(was, -1);
    for (const now of nextIds) if (!before.includes(now)) bumpBadge(now, +1);
    if (before.length && !nextIds.length) bumpBadge('inbox', +1);
    if (!before.length && nextIds.length) bumpBadge('inbox', -1);

    drawShelves(card, next);

    // `?shelf=` / `?q=` decide what this room is currently showing. The inbox is
    // the only view a filing can push a note out of; a pressed shelf loses it
    // only when it is taken off THAT shelf.
    const view = new URLSearchParams(location.search);
    const pressed = (view.get('shelf') ?? '').trim();
    const inInbox = !pressed && (view.get('q') ?? '').trim().length < MIN_SEARCH;
    const leaves = inInbox ? nextIds.length > 0 : pressed ? !next.some((s) => s.slug === pressed) : false;

    if (!leaves) return;
    const label = next.length ? next.map((s) => s.name).join(' · ') : 'the inbox';
    showUndo(next.length ? `Filed under ${label}` : 'Back in the inbox', card, async () => {
      await actions.shelves.set({ noteId: id, shelfIds: before });
    });
  }

  chooser?.addEventListener('click', async (e) => {
    const card = choosing;
    if (!card) return;

    const newRow = (e.target as Element).closest<HTMLElement>('[data-shelf-new]');
    if (newRow && newForm && newField) {
      newForm.hidden = false;
      newField.value = '';
      newField.focus();
      return;
    }

    const row = (e.target as Element).closest<HTMLElement>('[data-shelf]');
    if (!row) return;
    const id = row.dataset.shelf!;
    const name = row.dataset.shelfName ?? '';
    const slug = row.dataset.shelfSlug ?? '';
    const on = shelfIdsOf(card);

    /* ⚠ TWO IS THE CAP AND A THIRD PICK REPLACES THE OLDER, rather than being
       refused. `MAX_SHELVES` is the decided shape (a note may sit on two), and
       a menu that simply stops responding teaches nothing — the swap shows you
       what the cap is by doing it. The server enforces the same number, which
       is what makes this an affordance rather than the rule. */
    const next = on.includes(id)
      ? on.filter((x) => x !== id)
      : on.length >= MAX_SHELVES
        ? [...on.slice(1), id]
        : [...on, id];

    chooser.hidePopover();
    await setShelves(
      card,
      next.map((sid) => {
        const el = chooser.querySelector<HTMLElement>(`[data-shelf="${sid}"]`);
        return {
          id: sid,
          name: sid === id ? name : (el?.dataset.shelfName ?? ''),
          slug: sid === id ? slug : (el?.dataset.shelfSlug ?? ''),
        };
      }),
    );
  });

  /* A shelf named where you went looking for it (`pair-browser`'s create bar).
     The new drawer is created AND the note filed onto it in one motion — the
     row you just typed is obviously where you meant this note to go. */
  newForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const card = choosing;
    const name = newField?.value.trim();
    if (!card || !name) return;
    newForm.hidden = true;
    chooser?.hidePopover();

    const { data, error } = await actions.shelves.create({ name });
    if (error || !data) {
      say(card, error?.message ?? 'could not make that shelf');
      return;
    }
    // The menu has to learn the word too, or the next card's chooser will not
    // offer it until a reload.
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'pop__row';
    row.dataset.shelf = data.id;
    row.dataset.shelfName = data.name;
    row.dataset.shelfSlug = data.slug;
    row.textContent = data.name;
    newForm.before(row);

    const on = shelfIdsOf(card).map((sid) => {
      const el = chooser?.querySelector<HTMLElement>(`[data-shelf="${sid}"]`);
      return { id: sid, name: el?.dataset.shelfName ?? '', slug: el?.dataset.shelfSlug ?? '' };
    });
    const next = on.length >= MAX_SHELVES ? [...on.slice(1), data] : [...on, data];
    await setShelves(card, next);
  });

  /**
   * A dump filed into a sheet's destination. The sheet has already written the
   * row; what is left is the half only the pile can do.
   *
   * ⚠ THE NOTE IS CONSUMED AFTER the destination exists, never before. The other
   * order loses a thought whenever the second call fails, and the failure this
   * order leaves behind is a dump still sitting in the pile — which you can see
   * and delete.
   */
  document.addEventListener('hq:note-filed', async (e) => {
    const { noteId, what, href, undo } = (
      e as CustomEvent<{
        noteId: string;
        what: string;
        href: string | null;
        undo: { kind: 'task' | 'interaction' | 'event'; id?: string };
      }>
    ).detail;
    const card = pile?.querySelector<HTMLElement>(`[data-note="${noteId}"]`);
    if (!card) return;
    /*
      ⚠ THE PILE CLAIMS IT — and the claim has to be made HERE, after the card
      is found and before the first await (plan 45 · Piece 2).

      The sheets announce a filing to whoever is listening. This room is the one
      that can do the whole job: trash the jot, raise the undo strip, and offer
      the way onward. Everywhere else the same jot arrived from the ✚ and nobody
      would answer, so `announceFiled` consumes it itself when the event comes
      back uncancelled.

      After the card check because a filing whose card is not on this page is
      one this room CANNOT tidy — claiming that would consume nothing and
      silently stop the sheet from doing it either.
    */
    e.preventDefault();

    try {
      await bulk(noteId, 'trash');
    } catch {
      stampOf(card).textContent = `filed as ${what}, but still here`;
      return;
    }

    // Undoable, unlike an append: a task or an entry is a whole row, so putting
    // things back is deleting it and restoring the note — no words to unpick
    // out of somebody else's paragraph.
    showUndo(`Filed as ${what}`, card, async () => {
      if (undo.id) {
        if (undo.kind === 'task') await actions.tasks.remove({ id: undo.id });
        else if (undo.kind === 'event') await actions.events.remove({ id: undo.id });
        else await actions.interactions.remove({ id: undo.id });
      }
      await bulk(noteId, 'restore');
    });
    if (href) addStripLink(href, 'Open →');
  });

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
    openDialog(fileDialog);
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

  /** Every exit from the picker, so the ✕ and the backdrop can't drift apart. */
  const closeFiler = () => {
    if (fileDialog) void closeWithExit(fileDialog);
  };

  fileQuery?.addEventListener('input', () => filterPieces(fileQuery.value));
  fileDialog?.querySelector('[data-close]')?.addEventListener('click', closeFiler);
  // Guarded like every other backdrop in the tree — the least costly of the
  // four to get wrong (this dialog holds a search box and a list, and closing
  // it loses nothing), but a dismiss rule that behaves differently in one
  // dialog is the kind of inconsistency you feel without being able to name.
  if (fileDialog) onBackdropDismiss(fileDialog, closeFiler);

  fileList?.addEventListener('click', async (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-piece]');
    if (!btn || !filing) return;
    const card = filing;
    closeFiler();
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
      addStripLink(`/admin/fragments#edit=${btn.dataset.piece}`, 'Open →');
    } catch {
      stampOf(card).textContent = 'could not add it';
    }
  });

  /* ── wiring ─────────────────────────────────────────────────────────────── */

  /*
   * ⚠ THE WORDS ARE THE CONTROL, and the pencil is the label for it.
   *
   * Michael, 2026-08-15: *"I try to click the text to edit it but I didn't
   * realise I actually had to press the pencil icon. I think notes need to be
   * fast and responsive, and clicking into the note should already be able to
   * start editing it."* He is describing the thing this room was built for — a
   * dump costs fifteen seconds — being two gestures away from itself, because
   * the only door was a 16px glyph in the foot of the card.
   *
   * So the rendered text opens the note. THREE GUARDS, and each one is a real
   * gesture this would otherwise eat:
   *
   *  · A SELECTION IS NOT A CLICK. Dragging across a sentence to copy it ends
   *    with a click event on the card, and without this every copy would throw
   *    a drawer over the thing you were reading. `isCollapsed` is the question —
   *    "did this press select anything" — and it is asked of the live selection
   *    rather than tracked across pointerdown/up, because the browser knows.
   *  · A LINK IS A LINK. A dump can contain one, and following it must not be
   *    reinterpreted as "open the note that mentions it".
   *  · `more` STILL EXPANDS. It is a `<button>` inside the text's own region, so
   *    without an early return the same click would expand AND open — leaving
   *    you in a drawer for a reason you did not ask for.
   *
   * The pencil stays. It is the affordance that says the words are editable at
   * all before you have discovered that they are, and it is the keyboard path.
   *
   * ⚠ IT NO LONGER ALSO CLOSES. Both doors used to toggle, because the editor
   * was in the card and there was nothing else to press; the sheet has its own
   * ✕, Escape and backdrop, so a toggle here would be a fourth way to do what
   * three already do — and the only one you would have to remember was a
   * toggle.
   */
  pile?.addEventListener('click', (e) => {
    const target = e.target as Element;
    const el = target.closest<HTMLElement>('[data-edit], [data-more], [data-file], [data-delete], [data-text]');
    if (!el) return;
    const card = el.closest<HTMLElement>('[data-note]');
    if (!card) return;

    if (el.hasAttribute('data-more')) {
      const text = textOf(card);
      text.classList.remove('dump__text--clamped');
      text.dataset.expanded = 'true';
      el.hidden = true;
      return;
    }

    if (el.hasAttribute('data-text')) {
      if (target.closest('a')) return; // following a link the dump contains
      if (!window.getSelection()?.isCollapsed) return; // selecting, not opening
      openSheet(card);
      return;
    }

    if (el.hasAttribute('data-edit')) {
      openSheet(card);
      return;
    }

    if (el.hasAttribute('data-file')) {
      // The menu is one element for the whole pile, so it has to be told which
      // card it belongs to before it opens — that is what positions it, too.
      choosing = card;
      /* The menu says where the note LIVES before it offers to move it — and
         the create bar closes, so a half-typed name never greets the next
         card. */
      const on = shelfIdsOf(card);
      chooser?.querySelectorAll<HTMLElement>('[data-shelf]').forEach((r) => {
        r.classList.toggle('is-on', on.includes(r.dataset.shelf!));
      });
      if (newForm) newForm.hidden = true;
      chooser?.showPopover();
      return;
    }

    if (el.hasAttribute('data-delete')) void discard(card);
  });

  /*
   * ⚠ TWO HANDLERS STOOD HERE AND BOTH ARE GONE (plan 46), which is worth
   * recording because each was load-bearing for a room that no longer exists.
   *
   *  · A `pointerdown` close, because a card that WAS an editor had to know
   *    when you had finished with it — and `blur` could not answer, since a
   *    rich editor loses focus constantly and legitimately (its own toolbar,
   *    the link dialog, the alt prompt, the file picker). A modal drawer has no
   *    such question: what is outside it is inert, and the backdrop press that
   *    used to mean "done here" is now the dialog's own dismissal, guarded
   *    against the drag-out selection by `backdrop-close.ts`.
   *  · An Escape on the pile, for the same reason and with the same answer —
   *    `wireSheetDismiss` plus the hand-rolled keydown above.
   */

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
