// The Music tab of the writing sheet — ONE LINK on the piece (ADR 0044).
//
// Same contract as the constellation picker, and for the same reason: music is
// a RELATION, not a field of the document. It applies immediately rather than
// riding along with saveWriting's compare-and-set, so setting music can never
// be the thing that loses a rewrite — and a draft takes music without going
// anywhere near the publish dialog.
//
// ⚠ THIS WAS A SONG PICKER, AND THE PICKER WAS THE PROBLEM. It searched a
// catalogue of saved songs, offered to "add to the corpus" a link that wasn't
// in it, and named what it found in text. The catalogue's search had been
// querying a column the table did not have since 2026-08-15, so typing
// anything answered with an error — and nothing went red, because the e2e spec
// stubbed the search. With no songs table there is nothing to search, and the
// field below is the whole interface: paste, and it is saved.
//
// ⚠ PARSED HERE AND AGAIN ON THE SERVER, BY THE SAME FUNCTION. `parseMusicRef`
// is pure now that `lib/media.ts` lost its Spotify Web API half, so the browser
// can refuse a podcast link the instant it is pasted instead of after a round
// trip — and still not own a second copy of the rules. `music.set` re-parses
// and is the authority; this is only the early answer.
import { actions } from 'astro:actions';
import { parseMusicRef } from '../lib/media';
import { callAction, formatActionError } from './action-error';

export interface MusicEmbed {
  src: string;
  /** null = 16:9 video, sized by an aspect-ratio box rather than a height. */
  height: number | null;
  allow: string;
}

/** What `fragments.get` and `music.set` both answer with. */
export interface PieceMusic {
  url: string;
  embed: MusicEmbed | null;
}

export interface MusicPanelHandle {
  /**
   * Point the panel at a piece and its current music. `id` is null for a piece
   * with no row yet — `music.set` updates by id, so there is nothing to write
   * to until the first save, and the sheet calls this again once there is.
   */
  setFragment(id: string | null, music: PieceMusic | null): void;
  /** True if the music changed — the sheet reloads on close so the feed refreshes. */
  changed(): boolean;
}

interface Options {
  root: HTMLElement;
  /** The tab's little mark, shown when the piece has music. */
  markEl: HTMLElement;
}

export function wireMusicPanel({ root, markEl }: Options): MusicPanelHandle {
  const el = <T extends HTMLElement>(id: string): T => {
    const node = root.querySelector<T>(`#${id}`);
    // ⚠ Throws rather than casting. A missing player div was once a sheet that
    // silently stopped opening (`raisePlayer` on null, inside the open path);
    // a broken contract with the markup should say which id, at wire time.
    if (!node) throw new Error(`Music tab: #${id} is missing from WritingSheet.astro.`);
    return node;
  };
  const errorEl = el('ws-music-error');
  const urlEl = el<HTMLInputElement>('ws-music-url');
  const playerEl = el('ws-music-player');
  const statusEl = el('ws-music-status');
  const clearBtn = el<HTMLButtonElement>('ws-music-clear');

  let fragmentId: string | null = null;
  let current: PieceMusic | null = null;
  let touched = false;
  /** Writes are async; only the newest one may paint. */
  let seq = 0;

  const showError = (msg: string) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  };
  const clearError = () => {
    errorEl.hidden = true;
    errorEl.textContent = '';
  };

  /**
   * ⚠ REPLACES THE FRAME RATHER THAN HIDING IT, and only when the source
   * changes. A cross-origin player cannot be paused from outside, so removing
   * the iframe is the only stop there is — and re-creating it for the SAME
   * link would stop music you are listening to for no reason.
   */
  function raisePlayer(embed: MusicEmbed | null) {
    const frame = playerEl.querySelector('iframe');
    if (embed && frame?.src === embed.src) return;
    playerEl.replaceChildren();
    if (!embed) return;
    const f = document.createElement('iframe');
    f.src = embed.src;
    f.allow = embed.allow;
    f.loading = 'lazy';
    f.title = 'Player';
    f.className = 'rounded-box w-full border-0';
    if (embed.height) {
      f.height = String(embed.height);
      f.style.height = `${embed.height}px`;
    } else {
      f.style.aspectRatio = '16 / 9';
      f.style.height = 'auto';
    }
    playerEl.append(f);
  }

  function render() {
    urlEl.value = current?.url ?? '';
    clearBtn.hidden = !current;
    raisePlayer(current?.embed ?? null);
    // A dot on the tab, not a count: a piece carries one link, so a number
    // would imply it could carry two.
    markEl.textContent = current ? '·' : '';
  }

  /**
   * Save what is in the field — or clear the music when it is empty.
   *
   * ⚠ NO CONFIRM BEFORE REPLACING. The old picker replaced a pairing silently
   * from a list row, which is why the audit asked for one. Here the current
   * link IS the field's value, so replacing it means selecting it and pasting
   * over it — an edit of a visible value, not a press with a hidden cost.
   */
  async function commit(raw: string) {
    if (!fragmentId) return;
    const pasted = raw.trim();
    if (pasted === (current?.url ?? '')) return; // nothing changed
    clearError();
    if (pasted && !parseMusicRef(pasted)) {
      // In the error line, and the field keeps what you pasted so you can see
      // what was refused. Nothing was saved, so nothing needs rolling back.
      statusEl.textContent = '';
      return showError('That link can’t play here — paste a Spotify track, album or playlist, or a YouTube video.');
    }
    const mine = ++seq;
    statusEl.textContent = pasted ? 'Saving…' : 'Removing…';
    // `callAction` rather than a bare await: a dead network THROWS, and without
    // it the field would sit on "Saving…" with the link apparently accepted.
    const { data, error } = await callAction(actions.music.set({ fragment_id: fragmentId, url: pasted || undefined }));
    if (mine !== seq) return; // a newer paste already answered
    if (error || !data) {
      statusEl.textContent = '';
      return showError(error ? formatActionError(error) : 'That didn’t save — try again.');
    }
    current = data.url ? { url: data.url, embed: data.embed } : null;
    touched = true;
    render(); // the field now shows the CANONICAL link — what was actually stored
    statusEl.textContent = data.url ? 'Saved.' : 'Removed.';
  }

  // A paste is the whole gesture, so it saves without a second step. The
  // value is not in the field yet when `paste` fires; the next task it is.
  urlEl.addEventListener('paste', () => setTimeout(() => void commit(urlEl.value)));
  // Typed or edited by hand: saved when you leave the field or press Enter.
  urlEl.addEventListener('change', () => void commit(urlEl.value));
  urlEl.addEventListener('keydown', (e) => {
    // Enter in a field inside the sheet's form would otherwise submit it.
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void commit(urlEl.value);
  });
  urlEl.addEventListener('input', () => {
    clearError();
    statusEl.textContent = '';
  });
  clearBtn.addEventListener('click', () => void commit(''));

  // Closing the sheet must stop the music — see `raisePlayer`.
  root.closest('dialog')?.addEventListener('close', () => playerEl.replaceChildren());

  return {
    setFragment(id, music) {
      fragmentId = id;
      current = music;
      touched = false;
      seq++; // anything still in flight belongs to the previous piece
      clearError();
      // A piece that has never been saved has no row to write to. Say so,
      // rather than offering a field that quietly does nothing.
      urlEl.disabled = !id;
      statusEl.textContent = id ? '' : 'Save this piece first — then it can carry music.';
      playerEl.replaceChildren(); // a different piece's music must not keep playing
      render();
    },
    changed() {
      return touched;
    },
  };
}
