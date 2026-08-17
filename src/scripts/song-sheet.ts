// The song sheet (docs/plans/37 §2, ADR 0031) — the ONE editor for a song.
//
// It replaced two that were split by field: `/admin/listening` owned the
// feelings and could not touch the metadata, `FragmentSheet`'s song form owned
// the metadata and knew nothing about feelings. This file is the loop that has
// to stay cheap enough for the practice to survive a Tuesday:
//
//     paste a link → the player comes up → press the words → Save → next
//
// ⚠ REMOVING THE IFRAME IS THE ONLY PAUSE WE HAVE. A cross-origin frame cannot
// be controlled from outside — no API, no postMessage we own, nothing. So
// closing the sheet, loading a different song, and saving all DESTROY the
// frame, and that is what stops the sound. Anything here that "hides" a player
// instead of removing it leaves music playing in a room you have left.
//
// ⚠ AND THE SHEET TELLS ITS HOST PAGE WHAT HAPPENED RATHER THAN DECIDING.
// `song:saved` / `song:deleted` carry enough detail for a list to update a row
// in place; what to do with that is the page's business. Calling
// `notifyFragmentsChanged` from in here would RELOAD `/admin/listening`, whose
// whole point is that you can file twenty songs without the page moving.
import { actions } from 'astro:actions';
import { callAction, formatActionError, submitAction } from './action-error';
import { confirmDialog } from './confirm-dialog';
import { wireSharedBy } from './shared-by';
import { type ResolvedSong, createSong } from './song-create';
import { openDialog } from './dialog-close';
import { wireSheet } from './sheet';
import { wirePairBrowser, type PairedPiece } from './pair-browser';
import { sheetError } from './sheet-error';

/** Everything the sheet needs to open on one song. */
export interface SongSheetSeed {
  /** null until the song has a row — a pasted link nobody has saved yet. */
  id: string | null;
  title: string;
  artist: string;
  url: string;
  /**
   * The pieces this song is paired to — EDITABLE here since plan 39.
   *
   * ⚠ A LIST, NOT A VALUE, and the asymmetry is the data model: a writing has
   * at most one song (`paired_song_id` is a single column) while a song may be
   * paired to many writings. The writing sheet's Music tab shows one; this
   * shows all of them.
   */
  paired: PairedPiece[];
  embed: { src: string; height: number; allow: string };
  /**
   * What a lookup returned, and the only thing a CREATE needs.
   *
   * null when the song already has a row: there is nothing to create, and no
   * reason to have asked Spotify anything about it.
   */
  resolved: ResolvedSong | null;
}

const EMPTY: SongSheetSeed = {
  id: null,
  title: '',
  artist: '',
  url: '',
  paired: [],
  embed: { src: '', height: 0, allow: '' },
  resolved: null,
};

const sheet = document.getElementById('song-sheet') as HTMLDialogElement | null;
/** Assigned by `wire()` below, which runs on import. */
let loadSeed: ((seed: SongSheetSeed) => void) | null = null;

/**
 * Open the sheet on a song, or empty for a new one.
 *
 * Exported so a host page opens it by calling a function rather than by
 * dispatching at it — the pages that mount this sheet are the only callers, and
 * a typed argument is what stops a seed drifting out of shape.
 */
export function openSongSheet(seed: Partial<SongSheetSeed> = {}): void {
  if (!sheet || !loadSeed) return;
  loadSeed({ ...EMPTY, ...seed });
  // ⚠ `openDialog` DIRECTLY, NOT `ui.open()`, AND ONLY HERE. This function is
  // module scope — the host pages call it — while `ui` lives inside the
  // `if (sheet)` block below. It loses nothing: `loadSeed` above already clears
  // the error line and resets the tracker, which is all `ui.open()` adds.
  openDialog(sheet);
  // ⚠ FOCUS FOLLOWS THE JOB, and the job changed. An empty sheet is waiting
  // for a link, so it still focuses the URL field. A LOADED one used to focus
  // the first feeling chip, because pressing words was the loop this sheet was
  // built for — plan 40 retired them, and there is now nothing on an existing
  // song that you reliably came to type. So focus stays with the dialog and
  // the reader chooses a tab, rather than being dropped into a title field
  // they were probably not here to edit.
  if (!seed.id) (document.getElementById('sng-url') as HTMLInputElement | null)?.focus();
}

/** Pull an existing song up by id — one round trip, everything the sheet shows. */
export async function openSongById(id: string): Promise<void> {
  const { data, error } = await callAction(actions.songs.forSheet({ id }));
  if (error || !data) {
    /* ⚠ THIS WAS THE LAST NATIVE `alert()` IN THE TREE, and the comment that
       stood here justified it — "nothing is on screen to attach this to yet".
       That was not true: `#sng-error` is in this sheet's own markup, and the
       sheet is the thing that failed to open. So the sheet opens EMPTY with the
       sentence in its own error line, which is also the only version that
       cannot be dismissed by a stray Return before it has been read.

       A blocking `alert()` is the one dialog in a browser that steals focus
       from the page and cannot be styled, on the one failure most likely to be
       a dead network. (plan 38 · §6.3) */
    openSongSheet();
    const box = sheet && sheetError(sheet);
    if (box) {
      box.textContent = error ? formatActionError(error) : 'That song could not be opened.';
      box.hidden = false;
    }
    return;
  }
  openSongSheet({ ...data, resolved: null });
}

if (sheet) {
  wire(sheet);
  // The row → editor seam (`scripts/open-editor.ts`). A row says WHICH song it
  // wants opened and never names a surface, so the Fragment Manager needs no
  // knowledge of this sheet at all — it dispatches the same way it does for a
  // quote or a piece of writing.
  document.addEventListener('song:edit', (e) => {
    const id = (e as CustomEvent<{ id?: string }>).detail?.id;
    if (id) void openSongById(id);
  });
}

function wire(sheet: HTMLDialogElement) {
  /*
    ⚠ IT THROWS ON A MISSING ID, AND IT USED TO LIE ABOUT ONE. This was
    `document.getElementById(id) as T` — a cast that promises the element exists
    and hands back `null` when it doesn't, so TypeScript sees `HTMLElement` and
    the failure surfaces later, somewhere else, as a null dereference.

    That is exactly how `#sng-player` cost an afternoon: the div came out of the
    markup, this kept "finding" it, and `raisePlayer` blew up inside `loadSeed`
    — which runs BEFORE `openDialog`, so the sheet silently stopped opening at
    all. Nine specs went red pointing at the pairing picker, which was fine.

    Every id below is a contract with `SongSheet.astro`. Breaking one should say
    which one, at wire time, in the console — not produce a sheet that no longer
    opens for reasons three call frames away.
  */
  const el = <T extends HTMLElement>(id: string): T => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`SongSheet: #${id} is missing from the markup — the script and the sheet disagree.`);
    return node as T;
  };
  const urlEl = el<HTMLInputElement>('sng-url');
  const playerEl = el('sng-player');
  const headingEl = el('sng-title');
  const songTitleEl = el<HTMLInputElement>('sng-song-title');
  const artistEl = el<HTMLInputElement>('sng-artist');
  const pairedEl = el<HTMLUListElement>('sng-paired');
  const pairedNoneEl = el('sng-paired-none');
  const pairAddBtn = el<HTMLButtonElement>('sng-pair-add');
  const pairQueuedEl = el('sng-pair-queued');
  const saveBtn = el<HTMLButtonElement>('sng-save');
  const deleteBtn = el<HTMLButtonElement>('sng-delete');
  // The zone, not the button: Delete left the sticky footer for the foot of the
  // Facts panel (plan 38 · §1.4) and took an explanatory line and a rule with
  // it. Hiding the button alone would strand both under a brand-new song.
  const deleteZone = el('sng-delete-zone');
  const statusEl = el('sng-status');
  // By role — see `sheet-error.ts`. `sng-error` was one of twenty names for
  // this element across the admin (plan 29 · §6 + plan 38 · §3).
  const errorEl = sheetError(sheet)!;

  /*
    ⚠ SHARED BY IS IGNORED, because a tick there writes IMMEDIATELY (see
    SharedByField) — counting it would warn about edits that are already in the
    database, which is the fastest way to teach someone to click through a
    confirm without reading it. The feelings are NOT ignored: they look like the
    same kind of control and are not, because this sheet holds them until Save.
  */
  const ui = wireSheet(sheet, {
    noun: 'This song',
    ignore: '[data-sby="song"]',
    // ⚠ ON `close`, NOT IN `requestClose`. Every path out — the ✕, Escape, the
    // backdrop, a save, a delete — ends in the native `close`, and the frame has
    // to go on ALL of them. Hanging this off one handler is how a song ends up
    // playing behind a sheet that is no longer there, with no control left
    // anywhere to stop it. ⚠ And removing the iframe IS the pause: a
    // cross-origin frame cannot be controlled from outside (SongSheet.astro).
    onClose: () => playerEl.replaceChildren(),
  });
  const sharedByRoot = sheet.querySelector<HTMLElement>('[data-sby="song"]');
  const sharedBy = sharedByRoot ? wireSharedBy(sharedByRoot) : null;
  const sharedByMap = JSON.parse(sheet.dataset.sharedBy || '{}') as Record<string, string[]>;

  /** The song on the sheet. */
  let cur: SongSheetSeed = { ...EMPTY };
  /**
   * The metadata as it was when the sheet opened.
   *
   * ⚠ SAVE ONLY CALLS `saveSong` WHEN ONE OF THESE MOVED, and that is not a
   * micro-optimisation. `saveSong` re-derives the slug and upserts an author and
   * a work every time it runs, so a save that only added a feeling would do
   * three writes nobody asked for. It is also the difference between "Save"
   * meaning *commit what I changed* and meaning *rewrite this row*.
   */
  let base = { title: '', artist: '', url: '' };
  let lookupTimer: ReturnType<typeof setTimeout> | undefined;
  /** Lookups are async; a stale answer must not replace a newer one. */
  let lookupSeq = 0;

  const showError = (msg: string) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    errorEl.scrollIntoView({ block: 'nearest' });
  };
  const clearError = () => {
    errorEl.hidden = true;
    errorEl.textContent = '';
  };

  // --- the pairing (plan 39) -----------------------------------------------
  //
  // ⚠ IT WRITES IMMEDIATELY AND IS NOT PART OF `Save`, which is a deliberate
  // exception to this sheet's own "one Save for the whole sheet" rule — the
  // same exception, and the same reasoning, as Shared by beside it. `songs.pair`
  // is a RELATION with its own action and no compare-and-set; folding it into
  // Save would make pairing able to lose a rewrite, and would mean the fast
  // loop's one press now commits a foreign key on somebody else's row.
  //
  // ⚠ AND SAVE DESTROYS THE IFRAME. A pairing that only landed on Save would
  // stop the music every time you recorded a thought about it, which is the
  // defect this whole feature was opened against.
  let pairs: PairedPiece[] = [];

  const pairBrowser = wirePairBrowser(document.getElementById('pair-browser') as HTMLDialogElement, {
    onPaired(piece, queued) {
      if (!pairs.some((p) => p.id === piece.id)) pairs.push(piece);
      paintPairs(queued ? pairBrowser.queued().length : 0);
    },
  });

  /** Render the list. `queued` > 0 says n picks are waiting on the first Save. */
  function paintPairs(queued = pairBrowser.queued().length) {
    pairedEl.replaceChildren(
      ...pairs.map((p) => {
        const li = document.createElement('li');
        li.className = 'flex items-center gap-2';
        li.dataset.pair = p.id;
        const name = document.createElement('span');
        name.className = 'font-serif';
        name.textContent = p.title;
        const chip = document.createElement('span');
        chip.className = `admin-chip admin-chip--${p.status}`;
        chip.textContent = p.status;
        const un = document.createElement('button');
        un.type = 'button';
        un.className = 'btn btn-ghost btn-xs text-error ml-auto normal-case';
        un.textContent = 'Unpair';
        // ⚠ NAMED, NOT ✕. This removes a relation, not a chip — and the row it
        // is removing from is an essay you are not looking at. A glyph on a
        // fast, unaimed click is how you silently unpair the wrong piece;
        // FragmentRow makes the same call about its membership cell.
        un.setAttribute('aria-label', `Unpair ${p.title}`);
        un.addEventListener('click', () => void unpair(p));
        li.append(name, chip, un);
        return li;
      }),
    );
    pairedNoneEl.hidden = pairs.length > 0;
    pairQueuedEl.hidden = queued === 0;
    pairQueuedEl.textContent = queued
      ? `${queued} waiting — ${queued === 1 ? 'it lands' : 'they land'} when you save the song.`
      : '';
  }

  async function unpair(piece: PairedPiece) {
    clearError();
    // `song_id` absent is the clear path — the same action, and the reason
    // `pair` takes an optional id rather than having a sibling.
    if (cur.id) {
      const { error } = await callAction(actions.songs.pair({ fragment_id: piece.id }));
      if (error) return showError(formatActionError(error));
    }
    pairs = pairs.filter((p) => p.id !== piece.id);
    // ⚠ AND THE PICKER HAS TO BE TOLD. On an UNSAVED song there is no write to
    // undo — the pick is sitting in the picker's queue waiting for the first
    // Save — so removing it from this list alone made the row disappear and
    // then come back, because `flush` still had it. Found by walking the path
    // rather than by any check: everything about it is green.
    pairBrowser.drop(piece.id);
    paintPairs();
  }

  pairAddBtn.addEventListener('click', () => {
    clearError();
    pairBrowser.open({
      songId: cur.id,
      // The heading names the song, and it comes from the FIELD rather than
      // from `cur` — you may have just corrected the title, and the picker
      // should say what is on screen.
      songName: songTitleEl.value.trim() || cur.title,
      paired: pairs,
    });
  });

  // --- the player ----------------------------------------------------------
  /** ⚠ Replaces the frame rather than hiding it. See the file header. */
  function raisePlayer(embed: SongSheetSeed['embed']) {
    playerEl.replaceChildren();
    if (!embed.src) return;
    const frame = document.createElement('iframe');
    frame.src = embed.src;
    frame.allow = embed.allow;
    frame.loading = 'lazy';
    frame.title = 'Player';
    frame.className = 'rounded-box w-full border-0';
    if (embed.height > 0) {
      frame.height = String(embed.height);
      frame.style.height = `${embed.height}px`;
    } else {
      // A YouTube frame is 16:9 and has no fixed height — the same treatment the
      // public renderer gives it.
      frame.style.aspectRatio = '16 / 9';
      frame.style.height = 'auto';
    }
    playerEl.append(frame);
  }

  // --- loading -------------------------------------------------------------
  function load(seed: SongSheetSeed) {
    cur = { ...seed };
    clearError();
    statusEl.textContent = '';

    headingEl.textContent = seed.id ? seed.title || '(untitled)' : 'New song';
    urlEl.value = seed.url;
    songTitleEl.value = seed.title;
    artistEl.value = seed.artist;
    base = { title: seed.title, artist: seed.artist, url: seed.url };

    // emitUpdate: false — TipTap fires `update` on setContent, and the badges
    // are repainted right below anyway; letting it fire would also arm any
    // future dirty-guard against words we put there ourselves.

    // ⚠ RESET BEFORE PAINTING. The picker holds queued picks against the song
    // it was opened on; loading a different one into the same sheet must not
    // carry them across, or the next Save writes this song's pairings onto that
    // one. `load` runs on every open, which is exactly the boundary.
    pairs = [...seed.paired];
    pairBrowser.reset();
    paintPairs();

    deleteZone.hidden = !seed.id;
    sharedBy?.setFragment(seed.id, seed.id ? (sharedByMap[seed.id] ?? []) : []);
    raisePlayer(seed.embed);
    // ⚠ LAST, AND AFTER EVERYTHING ABOVE. Populating the fields fires `input`
    // like any other write, so a sheet nobody has touched would otherwise open
    // already dirty and guard on the way out.
    ui.dirty.reset();
  }
  loadSeed = load;

  // --- pasting a link ------------------------------------------------------
  async function lookup(url: string) {
    const seq = ++lookupSeq;
    statusEl.textContent = 'Looking it up…';
    const { data, error } = await callAction(actions.songs.lookup({ url }));
    if (seq !== lookupSeq) return; // a newer paste already answered
    statusEl.textContent = '';
    if (error) return showError(formatActionError(error));
    clearError();
    if (!data) return;

    // ⚠ DEDUPE IS ON THE PARSED REF, DECIDED SERVER-SIDE (`songForRef`). The same
    // track arrives as `?si=…`, as `intl-de/…`, and as `spotify:track:…`, and a
    // raw string comparison grows a twin for each — which splits one song's
    // feelings across two shelves and neither of them looks wrong.
    if (data.existing) {
      // Already ours: pull the WHOLE row up instead of treating the paste as a
      // new song. Pasting a link you already have therefore becomes a way of
      // FINDING it, which is the behaviour you want the first time you do it by
      // accident.
      const { data: full } = await callAction(actions.songs.forSheet({ id: data.existing.id }));
      if (full) {
        load({ ...full, resolved: null });
        statusEl.textContent = 'Already in the corpus.';
        return;
      }
    }
    load({
      ...EMPTY,
      title: data.title ?? '',
      artist: data.artist ?? '',
      url: data.url,
      embed: { src: data.embed.src, height: data.embed.height ?? 0, allow: data.embed.allow },
      resolved: {
        url: data.url,
        title: data.title ?? '',
        artist: data.artist ?? null,
        album: data.album ?? null,
        releaseYear: data.releaseYear ?? null,
        thumbnailUrl: data.thumbnailUrl ?? null,
        artistIds: data.artistIds ?? [],
        albumId: data.albumId ?? null,
      },
    });
  }

  urlEl.addEventListener('input', () => {
    clearTimeout(lookupTimer);
    const value = urlEl.value.trim();
    if (!value || value === base.url) return;
    lookupTimer = setTimeout(() => void lookup(value), 350);
  });
  urlEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(lookupTimer);
    const value = urlEl.value.trim();
    if (value) void lookup(value);
  });

  // --- saving --------------------------------------------------------------
  const metaChanged = () =>
    songTitleEl.value.trim() !== base.title || artistEl.value.trim() !== base.artist || urlEl.value.trim() !== base.url;

  const stop = (msg?: string) => {
    saveBtn.disabled = false;
    statusEl.textContent = '';
    if (msg) showError(msg);
  };

  async function save() {
    clearError();
    const title = songTitleEl.value.trim();
    const artist = artistEl.value.trim();
    const url = urlEl.value.trim();

    if (!url) return showError('A song needs a link.');
    if (!title || !artist) {
      // Send them where the problem is. An error about a field on a tab you
      // cannot see is an error you have to go hunting for.
      return showError('A song needs a title and an artist before it can be saved.');
    }

    saveBtn.disabled = true;
    statusEl.textContent = 'Saving…';

    // 1 · the row, if it does not exist yet ----------------------------------
    if (!cur.id) {
      if (!cur.resolved) return stop('Paste the link again — the lookup didn’t finish.');
      // `createSong` is shared with the writing sheet's Music tab, so the two
      // doors into the corpus cannot drift into two ways of writing a song.
      const { data, error } = await createSong(cur.resolved, { title, artist });
      if (error || !data) return stop(error ? formatActionError(error) : 'That song could not be saved.');
      cur.id = data.id;
      // Ticks made before the row existed are QUEUED by SharedByField; this is
      // the moment they can land.
      await sharedBy?.flush(data.id);
      // ⚠ AND SO ARE PAIRINGS (plan 39 · ruling 3). Same moment, same reason:
      // `songs.pair` needs a `song_id` and there wasn't one when you picked.
      // A failure here does NOT stop the save — the song is real, its feelings
      // and notes still have to land, and the queue keeps whatever didn't so a
      // second Save retries it.
      if (!(await pairBrowser.flush(data.id))) {
        showError('The song is saved, but a pairing didn’t land. Try Save again.');
      }
      paintPairs();
    } else if (metaChanged()) {
      // 2 · the metadata, only when it moved — see `base` above.
      const fd = new FormData();
      fd.set('id', cur.id);
      fd.set('spotify_url', url);
      fd.set('title', title);
      fd.set('attribution', artist);
      const { error } = await callAction(actions.fragments.saveSong(fd));
      if (error) return stop(formatActionError(error));
    }

    const songId = cur.id!;

    stop();
    ui.dirty.reset(); // it is all in the database now
    void ui.close();
    document.dispatchEvent(new CustomEvent('song:saved', { detail: { id: songId, title, artist } }));
  }
  saveBtn.addEventListener('click', () => void save());

  // --- delete --------------------------------------------------------------
  deleteBtn.addEventListener('click', async () => {
    if (!cur.id) return;
    const ok = await confirmDialog({
      title: 'Move to trash',
      // Named rather than implied: `paired_song_id` is ON DELETE SET NULL and
      // the trash is a soft delete, so an essay loses its player and keeps
      // everything else. Saying which is what stops the button feeling risky.
      message: 'Move this song to trash? An essay paired with it keeps its own words.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('id', cur.id);
    const res = await submitAction(() => actions.fragments.trash(fd), {
      button: deleteBtn,
      onError: showError,
      reusable: true,
    });
    if (!res.ok) return;
    const gone = cur.id;
    void ui.close();
    document.dispatchEvent(new CustomEvent('song:deleted', { detail: { id: gone } }));
  });

  /*
    ⚠ THIS SHEET HAS THE MOST TO LOSE OF ANY OF THEM (ADR 0032), which is why it
    guards rather than dismissing freely: two rich-text notes, a set of feelings
    and four metadata fields, none of which are written until Save. It shipped
    with no guard AND no backdrop dismiss, and the second was hiding the first.
    All of that is `wireSheet` now (plan 41 · §4).

    ⚠ ITS `showError` IS UNUSED HERE and the local pair above stays: this is the
    tallest sheet in the building, so a failure has to SCROLL to be read, and
    `wireSheet` does not scroll.
  */
}
