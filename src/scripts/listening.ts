// The listening bench (docs/plans/33 §3, §6a) — /admin/listening.
//
// One song on the bench at a time: paste a link, the player comes up, press the
// words the track leaves you with, save, next. The page's frontmatter carries
// the argument for why adding and tagging are one motion rather than two
// screens; this file is the loop that has to stay cheap enough for it to
// survive a Tuesday.
//
// ⚠ REMOVING THE IFRAME IS THE ONLY PAUSE WE HAVE. A cross-origin frame cannot
// be controlled from outside — no API, no postMessage we own, nothing. So
// `Close`, loading a different song, and saving all destroy the frame, and that
// is what stops the sound. Anything here that "hides" a player instead of
// removing it leaves music playing in a room you have left.
import { actions } from 'astro:actions';
import { callAction, formatActionError } from './action-error';
import { type ResolvedSong, createSong } from './song-create';

interface Loaded {
  /** null until the song has a row — a pasted link that nobody has saved yet. */
  id: string | null;
  /**
   * What the lookup returned, and the only thing a create needs.
   *
   * null when the song came off one of the lists below rather than off a paste:
   * it already has a row, so there is nothing to create and no reason to have
   * asked Spotify anything.
   */
  resolved: ResolvedSong | null;
}

export function wireListeningBench(): void {
  // The two the whole screen depends on. Re-bound to fresh consts after the
  // guard because TypeScript does not carry a narrowing across the closures
  // below — every handler here would otherwise re-check for null it has already
  // ruled out.
  const url0 = document.getElementById('lst-url') as HTMLInputElement | null;
  const bench0 = document.getElementById('lst-bench');
  if (!url0 || !bench0) return;
  const urlEl = url0;
  const bench = bench0;

  const playerEl = document.getElementById('lst-player') as HTMLElement;
  const fieldsEl = document.getElementById('lst-fields') as HTMLElement;
  const titleEl = document.getElementById('lst-title') as HTMLInputElement;
  const artistEl = document.getElementById('lst-artist') as HTMLInputElement;
  const lineEl = document.getElementById('lst-line') as HTMLElement;
  const lineTitleEl = document.getElementById('lst-line-title') as HTMLElement;
  const lineArtistEl = document.getElementById('lst-line-artist') as HTMLElement;
  const wordsEl = document.getElementById('lst-words') as HTMLElement;
  const newWordEl = document.getElementById('lst-newword') as HTMLInputElement;
  const addWordBtn = document.getElementById('lst-addword') as HTMLButtonElement;
  const wordNoteEl = document.getElementById('lst-wordnote') as HTMLElement;
  const saveBtn = document.getElementById('lst-save') as HTMLButtonElement;
  const closeBtn = document.getElementById('lst-close') as HTMLButtonElement;
  const statusEl = document.getElementById('lst-status') as HTMLElement;
  const errorEl = document.getElementById('lst-error') as HTMLElement;
  const waitingList = document.getElementById('lst-waiting') as HTMLElement;
  const filedList = document.getElementById('lst-filed') as HTMLElement;
  const waitingN = document.getElementById('lst-waiting-n') as HTMLElement;
  const filedN = document.getElementById('lst-filed-n') as HTMLElement;

  let loaded: Loaded | null = null;
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

  // --- the vocabulary, read off the chips the server rendered ---------------
  const wordName = (id: string) => wordsEl.querySelector<HTMLElement>(`[data-feeling="${id}"]`)?.textContent ?? '';
  const chips = () => [...wordsEl.querySelectorAll<HTMLButtonElement>('.lst-word')];
  const selected = () => chips().filter((c) => c.getAttribute('aria-pressed') === 'true');
  const setSelection = (ids: string[]) => {
    const want = new Set(ids);
    chips().forEach((c) => c.setAttribute('aria-pressed', String(want.has(c.dataset.feeling ?? ''))));
  };

  // --- the two lists -------------------------------------------------------
  /**
   * Words on a row, in the vocabulary's own order rather than the order they
   * were pressed. The spectrum is the claim (`feelings.sort`); the sequence a
   * pair of hands happened to click in is not, and plan 33's own table records
   * that an ORDERED arc was refused by the material.
   */
  const renderRowWords = (row: HTMLElement) => {
    const ids = (row.dataset.feelings ?? '').split(',').filter(Boolean);
    const order = chips().map((c) => c.dataset.feeling);
    const names = order.filter((id) => id && ids.includes(id)).map((id) => wordName(id as string));
    const target = row.querySelector<HTMLElement>('.lst-row-words');
    if (target) target.textContent = names.join(' · ');
  };

  const refreshCounts = () => {
    const w = waitingList.querySelectorAll('.lst-row').length;
    const f = filedList.querySelectorAll('.lst-row').length;
    waitingN.textContent = `(${w})`;
    filedN.textContent = `(${f})`;
    // The "nothing here" lines are server-rendered and must come and go as rows
    // move between the lists, or an empty list keeps insisting it has something.
    waitingList.querySelector<HTMLElement>('.lst-empty')?.toggleAttribute('hidden', w > 0);
    filedList.querySelector<HTMLElement>('.lst-empty')?.toggleAttribute('hidden', f > 0);
  };

  const rowFor = (id: string) => document.querySelector<HTMLElement>(`.lst-row[data-song="${id}"]`);

  /** A row for a song that had none — a link pasted a minute ago. */
  function makeRow(song: { id: string; title: string; artist: string }): HTMLElement {
    const li = document.createElement('li');
    li.className = 'lst-row flex items-baseline gap-3 px-3 py-2';
    li.dataset.song = song.id;
    li.dataset.title = song.title;
    li.dataset.artist = song.artist;
    li.dataset.feelings = '';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'lst-open min-w-0 grow text-left';
    const t = document.createElement('span');
    t.className = 'font-serif';
    t.textContent = song.title;
    const a = document.createElement('span');
    a.className = 'text-base-content/50 ml-2 text-sm';
    a.textContent = song.artist;
    open.append(t, a);
    const words = document.createElement('span');
    words.className = 'lst-row-words text-base-content/45 shrink-0 font-sans text-xs';
    li.append(open, words);
    return li;
  }

  // --- the player ----------------------------------------------------------
  /** ⚠ Replaces the frame rather than hiding it. See the file header. */
  function raisePlayer(src: string, height: number, allow: string) {
    playerEl.replaceChildren();
    if (!src) return;
    const frame = document.createElement('iframe');
    frame.src = src;
    frame.allow = allow;
    frame.loading = 'lazy';
    frame.title = 'Player';
    frame.className = 'w-full rounded-box border-0';
    if (height > 0) {
      frame.height = String(height);
      frame.style.height = `${height}px`;
    } else {
      // A YouTube frame is 16:9 and has no fixed height — same treatment the
      // public renderer gives it.
      frame.style.aspectRatio = '16 / 9';
      frame.style.height = 'auto';
    }
    playerEl.append(frame);
  }

  // --- opening and closing the bench ---------------------------------------
  function closeBench() {
    playerEl.replaceChildren(); // stops the music
    bench.hidden = true;
    loaded = null;
    statusEl.textContent = '';
    wordNoteEl.hidden = true;
  }

  function openBench(args: {
    song: Loaded;
    title: string;
    artist: string;
    feelingIds: string[];
    embed: { src: string; height: number; allow: string };
    known: boolean;
  }) {
    loaded = args.song;
    bench.hidden = false;
    raisePlayer(args.embed.src, args.embed.height, args.embed.allow);
    // Fields for a song with no row yet; a plain line for one that has one. Both
    // are always populated — `save` reads the inputs, and a song that already
    // exists never reaches that branch — so the two can never disagree about
    // what is on the bench.
    titleEl.value = args.title;
    artistEl.value = args.artist;
    lineTitleEl.textContent = args.title;
    lineArtistEl.textContent = args.artist;
    fieldsEl.hidden = args.known;
    lineEl.hidden = !args.known;
    setSelection(args.feelingIds);
    statusEl.textContent = '';
    bench.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

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

    const existing = data.existing;
    openBench({
      song: {
        id: existing?.id ?? null,
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
      },
      title: existing?.title ?? data.title ?? '',
      artist: existing?.artist || (data.artist ?? ''),
      // ⚠ Dedupe is on the PARSED ref, decided server-side (`songForRef`) — the
      // same track arrives as three different strings and a raw comparison grows
      // a twin for each, splitting one song's feelings across two shelves.
      feelingIds: existing ? ((rowFor(existing.id)?.dataset.feelings ?? '').split(',').filter(Boolean) ?? []) : [],
      embed: { src: data.embed.src, height: data.embed.height ?? 0, allow: data.embed.allow },
      known: Boolean(existing),
    });
  }

  urlEl.addEventListener('input', () => {
    clearTimeout(lookupTimer);
    const value = urlEl.value.trim();
    if (!value) return;
    lookupTimer = setTimeout(() => void lookup(value), 350);
  });
  urlEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(lookupTimer);
    const value = urlEl.value.trim();
    if (value) void lookup(value);
  });

  // --- pressing the words --------------------------------------------------
  wordsEl.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('.lst-word');
    if (!chip) return;
    chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
  });

  // --- adding a word mid-listen (§6a) --------------------------------------
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
      // ⚠ Reported HERE, beside the field, not in the page-top alert. The two
      // refusals this can give — "there is already a feeling called X" and "that
      // word wants a link another feeling still owns" — are both about the word
      // you just typed, and both are recoverable by typing a different one.
      wordNoteEl.textContent = formatActionError(error);
      wordNoteEl.hidden = false;
      return;
    }
    if (!data) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className =
      'lst-word rounded-field border-base-300 hover:border-base-content/40 border px-2.5 py-1 font-sans text-sm transition-colors';
    chip.dataset.feeling = data.id;
    // Pressed on arrival: you added it because this song needs it. Making you
    // press it again would be the interface asking whether you meant it.
    chip.setAttribute('aria-pressed', 'true');
    chip.textContent = data.name;
    wordsEl.append(chip);
    newWordEl.value = '';
    wordNoteEl.textContent = `“${data.name}” is at the bright end until the Library places it.`;
    wordNoteEl.hidden = false;
  }
  addWordBtn.addEventListener('click', () => void addWord());
  newWordEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void addWord();
  });

  // --- saving --------------------------------------------------------------
  async function save() {
    if (!loaded) return;
    clearError();
    const ids = selected().map((c) => c.dataset.feeling!);
    saveBtn.disabled = true;
    statusEl.textContent = 'Saving…';

    let songId = loaded.id;
    if (!songId) {
      const title = titleEl.value.trim();
      const artist = artistEl.value.trim();
      if (!loaded.resolved || !title || !artist) {
        saveBtn.disabled = false;
        statusEl.textContent = '';
        return showError('A song needs a title and an artist before it can be saved.');
      }
      // `createSong` is shared with the writing sheet's Music tab (§6a) — one
      // client-side path to one action, so the two doors cannot drift into two
      // ways of writing a song fragment.
      const { data, error } = await createSong(loaded.resolved, { title, artist });
      if (error || !data) {
        saveBtn.disabled = false;
        statusEl.textContent = '';
        return showError(error ? formatActionError(error) : 'That song could not be saved.');
      }
      songId = data.id;
      loaded.id = songId;
    }

    const { error } = await callAction(actions.songs.setFeelings({ song_id: songId, feeling_ids: ids }));
    saveBtn.disabled = false;
    if (error) {
      statusEl.textContent = '';
      // ⚠ The song row may exist by now even though its feelings do not — the
      // two writes are separate on purpose (a relation applies immediately,
      // independent of the fragment save). Say so, rather than "failed": the
      // song is in the corpus and will be sitting in "Not yet heard".
      return showError(`${formatActionError(error)} The song is saved; its words are not.`);
    }

    // --- the lists follow the save -----------------------------------------
    const title = titleEl.value.trim();
    const artist = artistEl.value.trim();
    const row = rowFor(songId) ?? makeRow({ id: songId, title, artist });
    row.dataset.feelings = ids.join(',');
    renderRowWords(row);
    const home = ids.length ? filedList : waitingList;
    home.prepend(row);
    refreshCounts();

    closeBench();
    urlEl.value = '';
    urlEl.focus();
  }
  saveBtn.addEventListener('click', () => void save());
  closeBtn.addEventListener('click', closeBench);

  // --- pulling an existing song back onto the bench ------------------------
  document.addEventListener('click', (e) => {
    const open = (e.target as HTMLElement).closest<HTMLElement>('.lst-open');
    const row = open?.closest<HTMLElement>('.lst-row');
    if (!row) return;
    clearError();
    urlEl.value = '';
    openBench({
      // `resolved: null` — this song already has a row, so there is nothing to
      // create and no reason to have asked Spotify anything for it.
      song: { id: row.dataset.song!, resolved: null },
      title: row.dataset.title ?? '',
      artist: row.dataset.artist ?? '',
      feelingIds: (row.dataset.feelings ?? '').split(',').filter(Boolean),
      embed: {
        src: row.dataset.embedSrc ?? '',
        height: Number(row.dataset.embedHeight ?? 0),
        allow: row.dataset.embedAllow ?? '',
      },
      known: true,
    });
  });

  document.querySelectorAll<HTMLElement>('.lst-row').forEach(renderRowWords);
  refreshCounts();
}
