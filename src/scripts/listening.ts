// The Listening room's two lists (docs/plans/37 §2) — /admin/listening.
//
// ⚠ THIS FILE USED TO BE THE WHOLE BENCH and is now only the lists. Everything
// that edits a song — the paste bar, the player, the words, the notes, the
// metadata — moved into `SongSheet`, because the split it replaced was two
// editors divided by FIELD rather than by task (ADR 0031). What is left here is
// the one job a sheet cannot do: keeping the room behind it honest.
//
// ⚠ AND IT UPDATES IN PLACE RATHER THAN RELOADING, which is the whole reason
// the sheet dispatches `song:saved` instead of calling `notifyFragmentsChanged`.
// That helper reloads any page which does not claim its event, and a reload
// after every save would put a full round trip in the middle of the loop this
// room exists to keep cheap — twenty songs in a sitting, without the page ever
// moving under you.
import { openSongById, openSongSheet } from './song-sheet';

export function wireListeningLists(): void {
  const lists = document.getElementById('lst-lists');
  const waitingList = document.getElementById('lst-waiting');
  const filedList = document.getElementById('lst-filed');
  if (!lists || !waitingList || !filedList) return;

  const waitingN = document.getElementById('lst-waiting-n') as HTMLElement;
  const filedN = document.getElementById('lst-filed-n') as HTMLElement;

  /**
   * `feeling_id → name`, rendered by the page.
   *
   * The sheet's `song:saved` carries ids, because ids are what it wrote; the
   * row shows words. Rather than have the sheet send names it does not own, the
   * page ships the vocabulary once and the translation happens here.
   */
  const names = JSON.parse(lists.dataset.vocab || '{}') as Record<string, string>;
  /** The vocabulary's own order — the spectrum is a claim, a click order is not. */
  const order = Object.keys(names);

  function refreshCounts() {
    const w = waitingList!.querySelectorAll('.lst-row').length;
    const f = filedList!.querySelectorAll('.lst-row').length;
    waitingN.textContent = `(${w})`;
    filedN.textContent = `(${f})`;
    // The "nothing here" lines are server-rendered and have to come and go as
    // rows move between the lists, or an empty list keeps insisting it has
    // something in it.
    waitingList!.querySelector<HTMLElement>('.lst-empty')?.toggleAttribute('hidden', w > 0);
    filedList!.querySelector<HTMLElement>('.lst-empty')?.toggleAttribute('hidden', f > 0);
  }

  const rowFor = (id: string) => document.querySelector<HTMLElement>(`.lst-row[data-song="${id}"]`);

  /** A row for a song that had none — a link pasted a minute ago. */
  function makeRow(id: string, title: string, artist: string): HTMLElement {
    const li = document.createElement('li');
    li.className = 'lst-row flex items-baseline gap-3 px-3 py-2';
    li.dataset.song = id;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'lst-open min-w-0 grow text-left';
    const t = document.createElement('span');
    t.className = 'font-serif';
    t.textContent = title;
    const a = document.createElement('span');
    a.className = 'text-base-content/50 ml-2 text-sm';
    a.textContent = artist;
    open.append(t, a);
    const words = document.createElement('span');
    words.className = 'lst-row-words text-base-content/45 shrink-0 font-sans text-xs';
    li.append(open, words);
    return li;
  }

  // --- the doors -----------------------------------------------------------
  document.getElementById('lst-new')?.addEventListener('click', () => openSongSheet());
  lists.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.lst-open')?.closest<HTMLElement>('.lst-row');
    if (row?.dataset.song) void openSongById(row.dataset.song);
  });

  // --- the lists follow the sheet ------------------------------------------
  document.addEventListener('song:saved', (e) => {
    const d = (e as CustomEvent<{ id: string; title: string; artist: string; feelingIds: string[] }>).detail;
    const row = rowFor(d.id) ?? makeRow(d.id, d.title, d.artist);
    // A rename lands here too: the row may have existed with the old title.
    const spans = row.querySelectorAll('span');
    if (spans[0]) spans[0].textContent = d.title;
    if (spans[1]) spans[1].textContent = d.artist;
    const words = order.filter((id) => d.feelingIds.includes(id)).map((id) => names[id]);
    row.querySelector<HTMLElement>('.lst-row-words')!.textContent = words.join(' · ');
    // ⚠ PREPENDED, NOT LEFT WHERE IT WAS. A song you just filed moving to the
    // top of the other list is the confirmation — the room is ordered newest
    // first anyway, and a row that stayed put would make a successful save look
    // like nothing happened.
    (words.length ? filedList : waitingList)!.prepend(row);
    refreshCounts();
  });

  document.addEventListener('song:deleted', (e) => {
    rowFor((e as CustomEvent<{ id: string }>).detail.id)?.remove();
    refreshCounts();
  });

  refreshCounts();
}
