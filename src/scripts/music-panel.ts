// The Music tab of the writing sheet — pair ONE song to this essay (ADR-0009
// "paired media", docs/plans/04 Piece 3).
//
// Same contract as the constellation picker, and for the same reason: a pairing
// is a RELATION, not a field of the document. It applies immediately rather than
// riding along with saveWriting's compare-and-set, so pairing a song can never
// be the thing that loses a rewrite — and a draft can be paired without going
// anywhere near the publish dialog.
//
// ⚠ IT USED NOT TO CREATE SONGS, AND THE REASON IT GAVE WAS HALF RIGHT. The old
// note said: *"adding a song is the Fragment Manager's job, and duplicating that
// flow here would be a second way to write a song fragment."* The instinct was
// correct and the conclusion was not — and the cost was real (plan 33 §6a,
// Michael 2026-08-10): *"if I'm trying to pair a song that doesn't already exist
// in the corpus, then I have to stop what I'm doing, create a new fragment, go
// back to the piece of writing."*
//
// The distinction that resolves it: **a second DOOR is not a second WRITE PATH.**
// A duplicated form would be one. A control that calls the existing `saveSong`
// through the shared `createSong` helper is not — the action stays the single
// owner of the fact, and only the door moves. `entity-combo` set this precedent
// on the quote sheet, where typing an author who does not exist offers to make
// one without leaving; this panel was simply the outlier that never got it.
//
// So the one field takes a QUERY or a LINK, and `looksLikeLink` decides which
// round trip to make. It knows nothing about Spotify or YouTube on purpose —
// "may a song cite this?" is `parseSongRef`'s question and is answered exactly
// once, on the server.
import { actions } from 'astro:actions';
import { looksLikeLink } from '../lib/song-link';
import { callAction, formatActionError } from './action-error';
import { type ResolvedSong, createSong } from './song-create';

export interface PairedSong {
  id: string;
  title: string;
  artist: string;
}

interface SongResult extends PairedSong {
  annotated: boolean;
}

export interface MusicPanelHandle {
  /** Point the panel at a piece and its current pairing. */
  setFragment(id: string | null, paired: PairedSong | null): void;
  /**
   * Load the list. Called from the sheet's tab `onSelect` when this panel is
   * shown, so opening a piece doesn't spend a round trip on a tab nobody
   * looked at. Idempotent — re-showing the tab just re-runs the search.
   */
  refresh(): void;
  /** True if the pairing changed — the sheet reloads on close so the feed refreshes. */
  changed(): boolean;
}

interface Options {
  root: HTMLElement;
  /** The tab's little mark, shown when something is paired. */
  markEl: HTMLElement;
}

export function wireMusicPanel({ root, markEl }: Options): MusicPanelHandle {
  const errorEl = root.querySelector<HTMLElement>('#ws-music-error')!;
  const noneEl = root.querySelector<HTMLElement>('#ws-music-none')!;
  const nameEl = root.querySelector<HTMLElement>('#ws-music-name')!;
  const clearBtn = root.querySelector<HTMLButtonElement>('#ws-music-clear')!;
  const queryEl = root.querySelector<HTMLInputElement>('#ws-music-q')!;
  const listEl = root.querySelector<HTMLElement>('#ws-music-results')!;

  let fragmentId: string | null = null;
  let current: PairedSong | null = null;
  let touched = false;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  /** Results are async; a stale response must not overwrite a newer one. */
  let searchSeq = 0;

  const showError = (msg: string) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  };
  const clearError = () => {
    errorEl.hidden = true;
    errorEl.textContent = '';
  };

  function renderCurrent() {
    const has = Boolean(current);
    noneEl.hidden = has;
    nameEl.hidden = !has;
    clearBtn.hidden = !has;
    nameEl.textContent = current ? `♪ ${current.title}${current.artist ? ` — ${current.artist}` : ''}` : '';
    // A dot on the tab, not a count: there is only ever one paired song, so a
    // number would imply you could have two.
    markEl.textContent = has ? '·' : '';
  }

  function renderResults(items: SongResult[], opts: { note?: string } = {}) {
    listEl.replaceChildren();
    if (!items.length) {
      // ⚠ THE EMPTY STATE IS WHERE THE LINK AFFORDANCE LIVES, and that is the
      // whole of the discovery design for §6a. The field's placeholder cannot
      // carry it — it is gone the moment you type — and a permanent line of
      // instruction above the box would be telling rather than showing. "No
      // songs match" is exactly the moment pasting a link is the answer, so it
      // is the moment to mention it, and never before.
      say('No songs match — paste a Spotify or YouTube link to add it.');
      return;
    }
    if (opts.note) {
      const li = document.createElement('li');
      li.className = 'admin-hint mb-1 italic';
      li.textContent = opts.note;
      listEl.append(li);
    }
    for (const s of items) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'flex w-full items-baseline gap-2 rounded-field px-3 py-2 text-left hover:bg-base-200 disabled:opacity-40';
      btn.disabled = s.id === current?.id;

      const title = document.createElement('span');
      title.className = 'font-serif';
      title.textContent = s.title;
      const artist = document.createElement('span');
      artist.className = 'text-sm text-whisper';
      artist.textContent = s.artist;
      btn.append(title, artist);

      // Mark the ones that already say something — after the backfill most
      // don't, and the annotated few are the ones worth reaching for.
      if (s.annotated) {
        const mark = document.createElement('span');
        mark.className = 'ml-auto text-xs text-whisper';
        mark.textContent = 'annotated';
        btn.append(mark);
      }
      if (s.id === current?.id) {
        const mark = document.createElement('span');
        mark.className = 'ml-auto text-xs text-whisper';
        mark.textContent = 'paired';
        btn.append(mark);
      }

      btn.addEventListener('click', () => void pair(s));
      li.append(btn);
      listEl.append(li);
    }
  }

  /** One `<li>` of plain italic prose — the list's own way of saying something. */
  function say(text: string) {
    listEl.replaceChildren();
    const li = document.createElement('li');
    li.className = 'admin-hint italic';
    li.textContent = text;
    listEl.append(li);
  }

  /**
   * A pasted link (§6a). Three answers, and they are genuinely different things:
   *
   *   • **already in the corpus** — the same track under a different URL form.
   *     Offered as an ordinary result to pair, never as a create. Dedupe is done
   *     server-side on the PARSED ref, because `?si=` tracking tokens,
   *     `intl-de/` paths and `spotify:track:` URIs are all one song and a raw
   *     string comparison would grow a twin for each.
   *   • **not in the corpus** — a create row previewing what the lookup returned,
   *     so you confirm rather than trust. It says the artist it found, because
   *     the oEmbed fallback often knows the title and not the artist and you
   *     should see that before it becomes a row.
   *   • **not a link a song may cite, or nobody answered** — two failures, two
   *     sentences. `lookupSong` distinguishes them and the panel must not
   *     collapse them: telling somebody their working Spotify link is the wrong
   *     kind of link, because a network blipped, is the confidently-wrong answer
   *     this whole flow is written against.
   */
  async function resolveLink(url: string) {
    const seq = ++searchSeq;
    say('Reading that link…');
    const { data, error } = await callAction(actions.songs.lookup({ url }));
    if (seq !== searchSeq) return;
    if (error) {
      clearError();
      // In the LIST, not the alert bar: it is about the text in the field above
      // it, and it is fixed by pasting something else.
      return say(formatActionError(error));
    }
    clearError();
    if (!data) return;

    if (data.existing) {
      renderResults(
        [{ id: data.existing.id, title: data.existing.title, artist: data.existing.artist, annotated: false }],
        {
          note: 'Already in the corpus.',
        },
      );
      return;
    }
    renderCreateRow({
      url: data.url,
      title: data.title ?? '',
      artist: data.artist ?? null,
      album: data.album ?? null,
      releaseYear: data.releaseYear ?? null,
      thumbnailUrl: data.thumbnailUrl ?? null,
      artistIds: data.artistIds ?? [],
      albumId: data.albumId ?? null,
    });
  }

  /** Confirm-before-create, previewing what the lookup found. */
  function renderCreateRow(song: ResolvedSong) {
    listEl.replaceChildren();
    const li = document.createElement('li');
    li.className =
      'rounded-field border-primary/30 bg-primary/5 flex flex-wrap items-center gap-x-2 gap-y-1 border px-3 py-2 text-sm';

    const label = document.createElement('span');
    label.className = 'text-faint text-xs';
    label.textContent = 'Not in the corpus yet:';
    const title = document.createElement('span');
    title.className = 'font-serif';
    title.textContent = song.title || '(untitled)';
    const artist = document.createElement('span');
    artist.className = 'text-whisper text-sm';
    // ⚠ Says so rather than showing a gap. An empty artist here is a real state
    // — the keyless oEmbed tier answers with a title and no artist — and a blank
    // reads as a bug in the panel rather than as a fact about the lookup.
    artist.textContent = song.artist || 'artist unknown — you can fix it after';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'bg-primary/15 text-primary hover:bg-primary/25 ml-auto rounded px-2 py-0.5 text-xs font-medium';
    add.textContent = 'Add and pair';
    add.addEventListener('click', () => void addAndPair(song, add));

    li.append(label, title, artist, add);
    listEl.append(li);

    const note = document.createElement('li');
    note.className = 'admin-hint mt-2 italic';
    // Subjects are deliberately absent, and saying so is cheaper than a reader
    // later wondering whether the panel forgot: a song is not ABOUT anything
    // (ADR 0031 took subjects off songs), and since plan 40 there is nothing
    // else to file it under either — the sentence used to end "give it its
    // feelings in Listening", which pointed at a room that no longer exists.
    note.textContent = 'It will be saved as a song and paired here.';
    listEl.append(note);
  }

  async function addAndPair(song: ResolvedSong, btn: HTMLButtonElement) {
    if (!fragmentId) return;
    clearError();
    btn.disabled = true;
    btn.textContent = 'Adding…';
    const { data, error } = await createSong(song);
    if (error || !data) {
      btn.disabled = false;
      btn.textContent = 'Add and pair';
      return showError(error ? formatActionError(error) : 'That song could not be saved.');
    }
    // Straight into the normal paired state — `pair` does its own optimistic
    // paint and rollback, so there is nothing to duplicate here.
    queryEl.value = '';
    await pair({ id: data.id, title: song.title || '(untitled)', artist: song.artist ?? '' });
  }

  async function search() {
    // A piece that has never been saved has no row to point a pairing at —
    // `pair` updates by id. Say so, rather than showing an empty list and a
    // search box that quietly do nothing, which is what this did first.
    if (!fragmentId) {
      say('Save this piece first — then you can pair a song to it.');
      queryEl.disabled = true;
      return;
    }
    queryEl.disabled = false;
    const term = queryEl.value.trim();
    if (looksLikeLink(term)) return resolveLink(term);

    const seq = ++searchSeq;
    // `callAction` rather than a bare await: a dead network throws here, and an
    // unhandled rejection would leave the last results on screen with no
    // indication that the box had stopped answering.
    const { data, error } = await callAction(actions.songs.search({ q: term }));
    if (seq !== searchSeq) return; // a newer search already answered
    if (error) return showError(formatActionError(error));
    clearError();
    renderResults((data ?? []) as SongResult[]);
  }

  async function pair(song: PairedSong | null) {
    if (!fragmentId) return;
    clearError();
    const previous = current;
    // Optimistic: the panel is a relation editor, and snapping back on failure
    // reads better than a spinner on every row.
    current = song;
    renderCurrent();
    // ⚠ THE ROLLBACK HAS TO COVER THE **THROWN** FAILURE TOO, and it did not.
    // This branch tested the RETURNED error only, so on a dead network the
    // rejection sailed past it and the song stayed painted as paired while the
    // server had never heard of it — an optimistic control that cannot roll
    // back is just a lie with a transition on it. `callAction` is what makes
    // the two failures arrive at the same line.
    const { error } = await callAction(
      actions.songs.pair({
        fragment_id: fragmentId,
        song_id: song?.id ?? undefined,
      }),
    );
    if (error) {
      current = previous;
      renderCurrent();
      return showError(formatActionError(error));
    }
    touched = true;
    void search(); // refresh the "paired" / disabled marks
  }

  clearBtn.addEventListener('click', () => void pair(null));
  queryEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void search(), 200);
  });
  // Enter in a search field would otherwise submit the sheet's form.
  queryEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimer);
      void search();
    }
  });

  return {
    setFragment(id, paired) {
      fragmentId = id;
      current = paired;
      touched = false;
      queryEl.value = '';
      listEl.replaceChildren();
      clearError();
      renderCurrent();
    },
    refresh() {
      void search();
    },
    changed() {
      return touched;
    },
  };
}
