// The Music tab of the writing sheet — pair ONE song to this essay (ADR-0009
// "paired media", docs/plans/04 Piece 3).
//
// Same contract as the constellation picker, and for the same reason: a pairing
// is a RELATION, not a field of the document. It applies immediately rather than
// riding along with saveWriting's compare-and-set, so pairing a song can never
// be the thing that loses a rewrite — and a draft can be paired without going
// anywhere near the publish dialog.
//
// It does NOT create songs. Pairing picks from what's already in the corpus;
// adding a song is the Fragment Manager's job, and duplicating that flow here
// would be a second way to write a song fragment.
import { actions } from 'astro:actions';
import { callAction, formatActionError } from './action-error';

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

  function renderResults(items: SongResult[]) {
    listEl.replaceChildren();
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'admin-hint italic';
      li.textContent = 'No songs match.';
      listEl.append(li);
      return;
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
      artist.className = 'text-sm text-base-content/50';
      artist.textContent = s.artist;
      btn.append(title, artist);

      // Mark the ones that already say something — after the backfill most
      // don't, and the annotated few are the ones worth reaching for.
      if (s.annotated) {
        const mark = document.createElement('span');
        mark.className = 'ml-auto text-xs text-base-content/35';
        mark.textContent = 'annotated';
        btn.append(mark);
      }
      if (s.id === current?.id) {
        const mark = document.createElement('span');
        mark.className = 'ml-auto text-xs text-base-content/35';
        mark.textContent = 'paired';
        btn.append(mark);
      }

      btn.addEventListener('click', () => void pair(s));
      li.append(btn);
      listEl.append(li);
    }
  }

  async function search() {
    // A piece that has never been saved has no row to point a pairing at —
    // `pair` updates by id. Say so, rather than showing an empty list and a
    // search box that quietly do nothing, which is what this did first.
    if (!fragmentId) {
      listEl.replaceChildren();
      const li = document.createElement('li');
      li.className = 'admin-hint italic';
      li.textContent = 'Save this piece first — then you can pair a song to it.';
      listEl.append(li);
      queryEl.disabled = true;
      return;
    }
    queryEl.disabled = false;
    const seq = ++searchSeq;
    // `callAction` rather than a bare await: a dead network throws here, and an
    // unhandled rejection would leave the last results on screen with no
    // indication that the box had stopped answering.
    const { data, error } = await callAction(actions.songs.search({ q: queryEl.value.trim() }));
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
