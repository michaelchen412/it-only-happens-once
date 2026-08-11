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
import { mountMiniEditor } from './rich-editor';
import { wireSheetTabs } from './sheet-tabs';
import { wireSharedBy } from './shared-by';
import { type ResolvedSong, createSong } from './song-create';

/** Everything the sheet needs to open on one song. */
export interface SongSheetSeed {
  /** null until the song has a row — a pasted link nobody has saved yet. */
  id: string | null;
  title: string;
  artist: string;
  album: string;
  year: number | null;
  url: string;
  feelingIds: string[];
  publicNote: string;
  privateNote: string;
  /** Essay titles this song is paired to. Read-only here; see the component. */
  paired: string[];
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
  album: '',
  year: null,
  url: '',
  feelingIds: [],
  publicNote: '',
  privateNote: '',
  paired: [],
  embed: { src: '', height: 0, allow: '' },
  resolved: null,
};

const sheet = document.getElementById('song-sheet') as HTMLDialogElement | null;
/** Assigned by `wire()` below, which runs on import. */
let loadSeed: ((seed: SongSheetSeed) => void) | null = null;
let focusWords: (() => void) | null = null;

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
  sheet.showModal();
  // Focus follows the job: an empty sheet is waiting for a link, a loaded one
  // is waiting for words. Anything else costs a reach for the mouse on the
  // press this whole loop exists to keep cheap.
  if (seed.id) focusWords?.();
  else (document.getElementById('sng-url') as HTMLInputElement | null)?.focus();
}

/** Pull an existing song up by id — one round trip, everything the sheet shows. */
export async function openSongById(id: string): Promise<void> {
  const { data, error } = await callAction(actions.songs.forSheet({ id }));
  if (error || !data) {
    // Nothing is on screen to attach this to yet, so the host page's own alert
    // is the wrong target and a silent failure is worse than a blunt one.
    alert(error ? formatActionError(error) : 'That song could not be opened.');
    return;
  }
  openSongSheet({ ...data, resolved: null });
}

if (sheet) wire(sheet);

function wire(sheet: HTMLDialogElement) {
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const urlEl = el<HTMLInputElement>('sng-url');
  const playerEl = el('sng-player');
  const headingEl = el('sng-title');
  const wordsEl = el('sng-words');
  const feelCountEl = el('sng-feel-count');
  const notesMarkEl = el('sng-notes-mark');
  const songTitleEl = el<HTMLInputElement>('sng-song-title');
  const artistEl = el<HTMLInputElement>('sng-artist');
  const albumEl = el<HTMLInputElement>('sng-album');
  const yearEl = el<HTMLInputElement>('sng-year');
  const pairedWrap = el('sng-paired-wrap');
  const pairedEl = el('sng-paired');
  const newWordEl = el<HTMLInputElement>('sng-newword');
  const addWordBtn = el<HTMLButtonElement>('sng-addword');
  const wordNoteEl = el('sng-wordnote');
  const saveBtn = el<HTMLButtonElement>('sng-save');
  const deleteBtn = el<HTMLButtonElement>('sng-delete');
  const statusEl = el('sng-status');
  const errorEl = el('sng-error');

  const tabs = wireSheetTabs(sheet);
  const sharedByRoot = sheet.querySelector<HTMLElement>('[data-sby="song"]');
  const sharedBy = sharedByRoot ? wireSharedBy(sharedByRoot) : null;
  const sharedByMap = JSON.parse(sheet.dataset.sharedBy || '{}') as Record<string, string[]>;

  const pub = mountMiniEditor({
    editorEl: el('sng-pub'),
    toolbarRoot: el('sng-pub-wrap'),
    placeholder: 'Something worth having beside the music…',
    ariaLabel: 'A note anyone can open',
  });
  const priv = mountMiniEditor({
    editorEl: el('sng-priv'),
    toolbarRoot: el('sng-priv-wrap'),
    placeholder: 'For you…',
    ariaLabel: 'A note only you can read',
  });

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
  let base = { title: '', artist: '', album: '', year: '', url: '' };
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

  // --- the words -----------------------------------------------------------
  const chips = () => [...wordsEl.querySelectorAll<HTMLButtonElement>('.sng-word')];
  const selected = () => chips().filter((c) => c.getAttribute('aria-pressed') === 'true');

  /** The two tab badges. A count on Feelings, a MARK on Notes — see below. */
  function paintBadges() {
    const n = selected().length;
    feelCountEl.textContent = n ? String(n) : '';
    // ⚠ A MARK RATHER THAN A COUNT, because "2" would be a lie about what is
    // there: the two notes are different documents with different readers, not
    // two of one thing. `··` says both, `·` says one, nothing says neither.
    notesMarkEl.textContent = (pub.editor.getText().trim() ? '·' : '') + (priv.editor.getText().trim() ? '·' : '');
  }
  pub.editor.on('update', paintBadges);
  priv.editor.on('update', paintBadges);

  wordsEl.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('.sng-word');
    if (!chip) return;
    chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    paintBadges();
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
    wordNoteEl.hidden = true;
    tabs.select('feelings');

    headingEl.textContent = seed.id ? seed.title || '(untitled)' : 'New song';
    urlEl.value = seed.url;
    songTitleEl.value = seed.title;
    artistEl.value = seed.artist;
    albumEl.value = seed.album;
    yearEl.value = String(seed.year ?? new Date().getFullYear());
    base = { title: seed.title, artist: seed.artist, album: seed.album, year: yearEl.value, url: seed.url };

    const want = new Set(seed.feelingIds);
    chips().forEach((c) => c.setAttribute('aria-pressed', String(want.has(c.dataset.feeling ?? ''))));
    // emitUpdate: false — TipTap fires `update` on setContent, and the badges
    // are repainted right below anyway; letting it fire would also arm any
    // future dirty-guard against words we put there ourselves.
    pub.editor.commands.setContent(seed.publicNote || '', { emitUpdate: false });
    priv.editor.commands.setContent(seed.privateNote || '', { emitUpdate: false });
    paintBadges();

    pairedWrap.hidden = seed.paired.length === 0;
    pairedEl.textContent = seed.paired.join(' · ');

    deleteBtn.hidden = !seed.id;
    sharedBy?.setFragment(seed.id, seed.id ? (sharedByMap[seed.id] ?? []) : []);
    raisePlayer(seed.embed);
  }
  loadSeed = load;
  focusWords = () => chips()[0]?.focus();

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
        focusWords?.();
        return;
      }
    }
    load({
      ...EMPTY,
      title: data.title ?? '',
      artist: data.artist ?? '',
      album: data.album ?? '',
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
    // The lookup answered; the words are the next thing you do.
    focusWords?.();
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

  // --- adding a word mid-listen --------------------------------------------
  async function addWord() {
    const name = newWordEl.value.trim();
    if (!name) return;
    wordNoteEl.hidden = true;
    const fd = new FormData();
    fd.set('name', name);
    addWordBtn.disabled = true;
    const { data, error } = await callAction(actions.feelings.create(fd));
    addWordBtn.disabled = false;
    if (error) {
      // ⚠ Reported HERE, beside the field, not in the sheet-top alert. The two
      // refusals this can give — "there is already a feeling called X" and "a
      // feeling that used to be called X still owns that link" — are both about
      // the word you just typed, and both are fixed by typing a different one.
      wordNoteEl.textContent = formatActionError(error);
      wordNoteEl.hidden = false;
      return;
    }
    if (!data) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className =
      'sng-word rounded-field border-base-300 hover:border-base-content/40 border px-2.5 py-1 font-sans text-sm transition-colors';
    chip.dataset.feeling = data.id;
    // Pressed on arrival: you added it because this song needs it. Making you
    // press it again would be the interface asking whether you meant it.
    chip.setAttribute('aria-pressed', 'true');
    chip.textContent = data.name;
    wordsEl.append(chip);
    newWordEl.value = '';
    wordNoteEl.textContent = `“${data.name}” is at the bright end until the Library places it.`;
    wordNoteEl.hidden = false;
    paintBadges();
  }
  addWordBtn.addEventListener('click', () => void addWord());
  newWordEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void addWord();
  });

  // --- saving --------------------------------------------------------------
  const metaChanged = () =>
    songTitleEl.value.trim() !== base.title ||
    artistEl.value.trim() !== base.artist ||
    albumEl.value.trim() !== base.album ||
    yearEl.value !== base.year ||
    urlEl.value.trim() !== base.url;

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
    const ids = selected().map((c) => c.dataset.feeling!);

    if (!url) return showError('A song needs a link.');
    if (!title || !artist) {
      // Send them where the problem is. An error about a field on a tab you
      // cannot see is an error you have to go hunting for.
      tabs.select('song');
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
    } else if (metaChanged()) {
      // 2 · the metadata, only when it moved — see `base` above.
      const fd = new FormData();
      fd.set('id', cur.id);
      fd.set('spotify_url', url);
      fd.set('title', title);
      fd.set('attribution', artist);
      if (albumEl.value.trim()) fd.set('album', albumEl.value.trim());
      fd.set('year', yearEl.value || String(new Date().getFullYear()));
      fd.set('status', 'published');
      const { error } = await callAction(actions.fragments.saveSong(fd));
      if (error) return stop(formatActionError(error));
    }

    const songId = cur.id!;

    // 3 · the relations. Two calls rather than one: they write different tables,
    // either can fail alone, and the sentence for each failure is different.
    const { error: feelErr } = await callAction(actions.songs.setFeelings({ song_id: songId, feeling_ids: ids }));
    // ⚠ The row may exist by now even though its feelings do not. Say so rather
    // than "failed": the song IS in the corpus and will be sitting in "Not yet
    // heard", which is a different thing to go and fix.
    if (feelErr) return stop(`${formatActionError(feelErr)} The song is saved; its words are not.`);

    const { error: noteErr } = await callAction(
      actions.songs.setNotes({
        song_id: songId,
        public_notes: pub.getMarkdown().trim(),
        private_notes: priv.getMarkdown().trim(),
      }),
    );
    if (noteErr) return stop(`${formatActionError(noteErr)} The song and its words are saved; the notes are not.`);

    stop();
    close();
    document.dispatchEvent(new CustomEvent('song:saved', { detail: { id: songId, title, artist, feelingIds: ids } }));
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
    close();
    document.dispatchEvent(new CustomEvent('song:deleted', { detail: { id: gone } }));
  });

  // --- closing -------------------------------------------------------------
  function close() {
    sheet.close();
  }
  sheet.querySelector('[data-sng-close]')?.addEventListener('click', close);
  // ⚠ ON `close`, NOT ON THE BUTTON. Escape and the backdrop close a native
  // dialog without going near that handler, and the frame has to go on EVERY
  // one of those paths — otherwise the song plays on behind a sheet that is no
  // longer there, and there is no control left anywhere to stop it.
  sheet.addEventListener('close', () => playerEl.replaceChildren());
}
