// The SONG SHEET's pairing picker (plan 39) — the second room to use the
// FragmentBrowser drawer, and the reason `browser-shell.ts` exists.
//
// It answers one question: *what am I going to write about this?* — asked while
// the music is playing, which is the whole reason it is here rather than only on
// the writing sheet's Music tab. Reaching that tab costs closing the song sheet,
// and closing the song sheet destroys the iframe; the old route was therefore
// only walkable by ending the listening that produced the thought.
//
// ⚠ ONE WRITE PATH, TWO DOORS. Both this and `music-panel.ts` call the same
// `songs.pair` against the same column with the same `type = 'writing'` guard.
// The invariant was never "one control".
//
// ⚠ AND THE TWO DOORS ARE DIFFERENT VERBS, because the cardinality is not
// symmetric: a writing has at most ONE song (a single column), while a song may
// be paired to MANY writings. From the essay, pairing REPLACES. From here it
// APPENDS — into a slot that may already belong to another song, which is why
// this file has a confirm and `music-panel.ts` does not.
import { actions } from 'astro:actions';
import { callAction, formatActionError } from './action-error';
import { confirmDialog } from './confirm-dialog';
import { starMarkHtml } from '../lib/star-mark';
import { wireBrowserShell } from './browser-shell';
import { cloneIcon } from './icon';
import { MIN_SEARCH } from '../lib/search-highlight';

/** A piece this song is now paired to — what the sheet's list renders. */
export interface PairedPiece {
  id: string;
  title: string;
  status: string;
}

export interface PairBrowserOpts {
  /**
   * A pairing happened. `queued` means the song has no row yet and the write is
   * being held (ruling 3) — the sheet says so rather than pretending it landed.
   */
  onPaired: (piece: PairedPiece, queued: boolean) => void;
}

export interface PairBrowserHandle {
  open: (ctx: { songId: string | null; songName: string; paired: PairedPiece[] }) => void;
  /** Pieces picked before the song had a row, in pick order. */
  queued: () => PairedPiece[];
  /** Land the held picks now that there is an id. Resolves false if any failed. */
  flush: (songId: string) => Promise<boolean>;
  /**
   * Forget a piece — the sheet unpaired it.
   *
   * ⚠ WITHOUT THIS, UNPAIRING A QUEUED PICK DOES NOTHING AND LOOKS LIKE IT DID.
   * On an unsaved song a pick is held in `pending`, and the sheet's own Unpair
   * only edits its list — so the row vanished from the screen and `flush` wrote
   * it anyway on the next Save. The pairing came back, having been removed.
   * `localPaired` matters for the same reason one layer up: the picker would
   * still render it dimmed as ours.
   */
  drop: (id: string) => void;
  /** Drop the queue — a different song is being loaded into the sheet. */
  reset: () => void;
}

export function wirePairBrowser(root: HTMLDialogElement, opts: PairBrowserOpts): PairBrowserHandle {
  let songId: string | null = null;
  /**
   * Every piece paired to the current song, including ones picked seconds ago.
   *
   * ⚠ THIS IS WHY THE PICKER CANNOT RELY ON THE SERVER'S MARKING ALONE. The
   * panel renders `pairedIds` from `paired_song_id` as it was when the partial
   * was fetched — so a piece paired since that fetch, and EVERY piece when the
   * song has no row at all, would come back through the next filter change
   * looking pairable. Re-picking it is harmless for a saved song and duplicates
   * a queued one; both look like the picker forgot.
   */
  const localPaired = new Map<string, PairedPiece>();
  /** The subset picked while `songId` was null — what `flush` has to write. */
  const pending: PairedPiece[] = [];

  const createBar = root.querySelector<HTMLElement>('.fb-createbar')!;
  const createBtn = root.querySelector<HTMLButtonElement>('.fb-create')!;
  const createTermEl = root.querySelector<HTMLElement>('.fb-create-term')!;

  const shell = wireBrowserShell(root, {
    params: () => ({ mode: 'pair', song: songId ?? '' }),
    panel: {
      // ⚠ THE ROW PAIRS INSTEAD OF OPENING AN EDITOR (plan 39 · ruling 5). The
      // composer's drawer opens one here because placing is curation and you
      // must read what you curate. Pairing is not curation — you already know
      // what the piece is; you are the one who wants to write it. And the
      // editor it would open is the writing sheet, which /admin/listening does
      // not mount, so the convention would cost a heavy import on the one page
      // whose point is that nothing moves while you file twenty songs.
      onOpen(row) {
        void pickRow(row);
      },
      onAction(act, _id, row) {
        if (act === 'pair') void pickRow(row);
      },
      onSwap() {
        reflectLocalMarks();
        reflectCreateBar();
      },
    },
    onClose() {
      // Nothing to flush and nothing to refresh: pairing writes immediately (or
      // is queued against the sheet's own Save), and the sheet repaints from
      // `onPaired` as each one lands. Closing is just closing.
    },
  });

  // --- the picks ------------------------------------------------------------

  function pieceFromRow(row: HTMLElement): PairedPiece {
    const title = row.querySelector('.row-open')?.textContent?.trim() || '(untitled)';
    return { id: row.dataset.id!, title, status: row.dataset.status || 'draft' };
  }

  async function pickRow(row: HTMLElement) {
    if (row.dataset.paired !== undefined) return; // already ours — nothing to do
    shell.clearError();
    const stealing = row.dataset.pairedTo;
    if (stealing) {
      // ⚠ RULING 2, AND THE SENTENCE IS THE FEATURE. From the essay you
      // overwrite your own field with its current value in front of you; from
      // here the slot belongs to a piece you are not looking at. The steal is
      // allowed — refusing would mean "go to another room to do this", which is
      // an obstacle wearing a dimmed row's clothes — but it names what it takes.
      const ok = await confirmDialog({
        title: 'Replace the song?',
        message: `“${pieceFromRow(row).title}” is paired with ${stealing}. Replace it with this song?`,
        confirmLabel: 'Replace',
      });
      if (!ok) return;
    }
    await pair(pieceFromRow(row), row);
  }

  /** Write it, or hold it if the song has no row yet, then mark the row. */
  async function pair(piece: PairedPiece, row?: HTMLElement): Promise<boolean> {
    if (songId) {
      const { error } = await callAction(actions.songs.pair({ fragment_id: piece.id, song_id: songId }));
      if (error) {
        shell.showError(formatActionError(error));
        return false;
      }
    } else {
      pending.push(piece);
    }
    localPaired.set(piece.id, piece);
    if (row) markPaired(row);
    opts.onPaired(piece, !songId);
    return true;
  }

  /** Flip a row to its paired state in place — no refetch, the drawer stays open. */
  function markPaired(row: HTMLElement) {
    row.classList.add('opacity-45');
    row.classList.remove('hover:bg-base-200/40');
    row.dataset.paired = '';
    delete row.dataset.pairedTo;
    const cell = row.querySelector('[data-act="pair"]')?.closest('td');
    if (cell)
      cell.innerHTML = `<span class="font-sans text-[0.65rem] tracking-wide text-primary/70 uppercase">${starMarkHtml()} paired</span>`;
  }

  /** Re-apply our own marks over a freshly swapped table. */
  function reflectLocalMarks() {
    const panel = shell.panel();
    if (!panel) return;
    for (const id of localPaired.keys()) {
      const row = panel.root.querySelector<HTMLElement>(`tr.fragment-row[data-id="${id}"]`);
      if (row && row.dataset.paired === undefined) markPaired(row);
    }
  }

  // --- the piece that does not exist yet (rulings 6 and 7) -------------------

  /** What the search box holds right now, across swaps. */
  function term(): string {
    const panel = shell.panel();
    return panel?.root.querySelector<HTMLInputElement>('input[name="q"]')?.value.trim() ?? '';
  }

  /**
   * Offer to create, unless a listed row already carries that exact title.
   *
   * EntityCombo settled this: the create option goes AFTER the matches and is
   * suppressed on an exact one, because offering to make a second copy of a
   * thing you can already see is the one way this affordance does harm.
   */
  function reflectCreateBar() {
    const q = term();
    const panel = shell.panel();
    const exact =
      !!panel &&
      [...panel.root.querySelectorAll('tr.fragment-row .row-open')].some(
        (t) => t.textContent!.trim().toLowerCase() === q.toLowerCase(),
      );
    createBar.hidden = q.length < MIN_SEARCH || exact;
    createTermEl.textContent = q;
  }

  // Delegated, because the search input is replaced on every filter swap and a
  // listener bound to the element itself would survive exactly one keystroke.
  root.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).matches?.('input[name="q"]')) reflectCreateBar();
  });

  createBtn.addEventListener('click', async () => {
    const title = term();
    if (!title) return;
    shell.clearError();
    createBtn.disabled = true;
    // ⚠ ONE `saveWriting` AND NO EDITOR. `capture.ts` already creates writing
    // this way, and `saveWriting` only demands a title and a body when the
    // status is `published` — so a titled, bodyless piece is legal by
    // construction. The expensive path (Add ▾ → the writing sheet) was assumed
    // and was never required.
    //
    // ⚠ AND IT IS A DRAFT, NOT A NOTE (ruling 7). A note is a dump of WORDS and
    // here there are none — a title, a song and an intention is an empty draft.
    // `scoped()` in fragment-query also drops notes unconditionally, so a note
    // would vanish from this picker the instant it was made.
    const fd = new FormData();
    // Minted client-side, the way the writing sheet does it: `persist` inserts
    // WITH the id when one is supplied, so a first save is an insert rather
    // than an insert-then-read.
    fd.set('id', crypto.randomUUID());
    fd.set('title', title);
    fd.set('status', 'draft');
    const { data, error } = await callAction(actions.fragments.saveWriting(fd));
    createBtn.disabled = false;
    if (error || !data) return shell.showError(error ? formatActionError(error) : 'That piece could not be created.');
    // ⚠ PAIR AGAINST THE ID THE SERVER ANSWERED WITH, not the one we sent. They
    // are the same today and the difference costs nothing — but `persist` owns
    // whether a supplied id is honoured, and if that ever changes, pairing
    // against our own would write a foreign key to a row that does not exist
    // and report success. Free insurance on a two-line path.
    const id = data.id;
    // ⚠ NO COLLISION CHECK ON THIS PATH, and that is correct rather than an
    // oversight: a row created one line above cannot already hold another song.
    // Routing it through `pickRow` for uniformity would ask the question anyway.
    //
    // ⚠ AND THE PAIR IS QUEUED IF THE SONG IS UNSAVED, WHILE THE PIECE IS NOT.
    // The writing is real the moment you name it — holding it hostage to the
    // song's Save would lose the thought if the sheet were dismissed, which is
    // the failure `capture.ts` exists to prevent.
    await pair({ id, title, status: 'draft' });
    createBar.hidden = true;
    // The new row belongs in the list, and `reflectLocalMarks` on the swap is
    // what stops it coming back looking pairable — which would invite a second
    // stub with the same title.
    //
    // ⚠ AND THERE IS DELIBERATELY NO `notifyFragmentsChanged` HERE, even though
    // a fragment was just created and that is exactly what the call is for.
    // `/admin/listening` has NO listener — it refreshes from `song:saved`
    // instead — so an unclaimed announcement falls back to `location.reload()`,
    // which would take down this drawer, the song sheet above it, and the
    // player. `song-sheet.ts`'s own header states the same rule for the same
    // page. The cost is that a draft made from here does not appear in
    // /admin/fragments' list behind the sheet until that page is reloaded; the
    // alternative costs the listening, which is what this feature exists for.
    await shell.refresh();
  });

  // --- opening --------------------------------------------------------------

  return {
    open({ songId: id, songName, paired }) {
      // ⚠ RESET, NOT REFRESH. The shell caches its panel, and these params name
      // a different song than the last open did — a kept panel would mark the
      // new song's rows with the old song's pairings.
      const changed = id !== songId;
      songId = id;
      if (changed) {
        localPaired.clear();
        pending.length = 0;
      }
      for (const p of paired) localPaired.set(p.id, p);
      shell.reset();
      shell.setName(songName || 'this song');
      createBar.hidden = true;
      shell.open();
    },
    queued: () => [...pending],
    async flush(id) {
      songId = id;
      if (!pending.length) return true;
      let ok = true;
      // Sequential and drained as it goes: a failure must leave the rest in the
      // queue rather than replaying the ones that landed.
      while (pending.length) {
        const piece = pending[0];
        const { error } = await callAction(actions.songs.pair({ fragment_id: piece.id, song_id: id }));
        if (error) {
          shell.showError(formatActionError(error));
          ok = false;
          break;
        }
        pending.shift();
      }
      return ok;
    },
    drop(id) {
      localPaired.delete(id);
      const i = pending.findIndex((p) => p.id === id);
      if (i !== -1) pending.splice(i, 1);
      // The row itself, if the drawer is open behind the sheet — otherwise it
      // stays dimmed and unpickable until the next open.
      const row = shell.panel()?.root.querySelector<HTMLElement>(`tr.fragment-row[data-id="${id}"]`);
      if (row) {
        delete row.dataset.paired;
        row.classList.remove('opacity-45');
        row.classList.add('hover:bg-base-200/40');
        const cell = row.querySelector('td:last-child');
        if (cell) {
          // ⚠ BUILT, NOT `innerHTML`d WITH A `＋` (plan 42 · §4.B.5). This
          // rebuilds the button `FragmentRow` renders with `<Icon ph:plus>`, so
          // an innerHTML string carrying the character meant un-pairing a song
          // swapped one row's SVG for a font glyph — the split the finding is
          // about, arriving through the back door and only in the transient
          // state nobody screenshots.
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-ghost btn-xs font-sans normal-case';
          btn.dataset.act = 'pair';
          btn.dataset.id = id;
          btn.title = 'Pair this song to it';
          btn.setAttribute('aria-label', 'Pair this song to it');
          const glyph = cloneIcon('ph:plus');
          if (glyph) btn.appendChild(glyph);
          cell.replaceChildren(btn);
        }
      }
    },
    reset() {
      localPaired.clear();
      pending.length = 0;
      songId = null;
    },
  };
}
