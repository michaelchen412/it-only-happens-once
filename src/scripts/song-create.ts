// Creating a song from a resolved link — the ONE client-side path, shared by
// the listening bench and the writing sheet's Music tab (plan 33 §3 and §6a).
//
// ⚠ THIS FILE IS THE ANSWER TO THE OBJECTION `music-panel.ts` USED TO CARRY.
// It said, correctly, that the Music tab does not create songs because
// *"duplicating that flow here would be a second way to write a song
// fragment"*. That instinct was right and the conclusion was not: the fix is not
// a second way to write one — it is the same way, reachable from where you
// already are. `saveSong` stays the single owner of the fact on the server, and
// this keeps the two callers from hand-building the same FormData twice, which
// is the client-side version of the same drift.
import { actions } from 'astro:actions';
import { callAction } from './action-error';

/** What `songs.lookup` hands back, narrowed to the fields a save needs. */
export interface ResolvedSong {
  url: string;
  title: string;
  artist: string | null;
  album: string | null;
  releaseYear: number | null;
  thumbnailUrl: string | null;
  artistIds: string[];
  albumId: string | null;
}

/**
 * Write the song row. Returns the same `{ data, error }` shape every action
 * call in here does, so the caller decides what to say.
 *
 * ⚠ PUBLISHED, NOT THE `draft` DEFAULT, and it matters more here than it looks.
 * A song has no draft register — all 48 already in the corpus are published —
 * and the paired player under an essay reads the song row through a policy that
 * requires `status = 'published'`. A song saved as a draft and then paired would
 * go silent under its own essay for every reader but Michael, which is a bug you
 * only find by opening your own site signed out.
 *
 * `year` is the year it entered the corpus, deliberately distinct from
 * `release_year`, which rides along in `details`. `saveSong`'s own comment has
 * the full account; the two are easy to conflate and mean different things.
 */
export async function createSong(
  song: ResolvedSong,
  overrides: { title?: string; artist?: string } = {},
): Promise<{ data?: { id: string; slug: string }; error?: unknown }> {
  const title = (overrides.title ?? song.title).trim();
  const artist = (overrides.artist ?? song.artist ?? '').trim();

  const fd = new FormData();
  fd.set('spotify_url', song.url);
  fd.set('title', title);
  fd.set('attribution', artist);
  if (song.album) fd.set('album', song.album);
  if (song.thumbnailUrl) fd.set('thumbnail_url', song.thumbnailUrl);
  if (song.releaseYear) fd.set('release_year', String(song.releaseYear));
  if (song.artistIds.length) fd.set('spotify_artist_ids', song.artistIds.join(','));
  if (song.albumId) fd.set('spotify_album_id', song.albumId);
  fd.set('year', String(new Date().getFullYear()));
  fd.set('status', 'published');

  return callAction(actions.fragments.saveSong(fd)) as Promise<{
    data?: { id: string; slug: string };
    error?: unknown;
  }>;
}
