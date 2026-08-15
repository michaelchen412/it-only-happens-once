// How an essay's paired song is resolved from a row (ADR-0009, plans/04 Piece 3).
//
// The branch order in `pairedMediaOf` is a SECURITY property, not a preference,
// and it exists because of a bug this file pins down. When RLS hides an
// unpublished paired song the embed arrives as null — and an earlier version of
// this function fell through to a SECOND source and went on playing it. The
// probe caught it: PostgREST correctly returned `paired_song: null` while the
// rendered page still showed a player.
//
// ⚠ THAT SECOND SOURCE USED TO BE `details.media`, which every one of the 48
// promoted essays carried a copy of — so the fall-through had a track to find
// on any of them. It is now `paired_playlist_url` (plan 40 §1b), which only two
// rows have and no song row ever shadows. The hazard is smaller and the rule is
// unchanged, which is why these specs are rewritten rather than deleted.
import { describe, expect, it } from 'vitest';
import { pairedMediaOf } from '../lib/blog';

const SONG = {
  id: 'song-1',
  title: 'Creep',
  attribution: 'Bob Reynolds',
  source_url: 'https://open.spotify.com/track/abc',
  deleted_at: null,
};
/** A playlist on the same row — the thing branch 1 must never fall through to. */
const PLAYLIST = 'https://open.spotify.com/playlist/abc';

describe('pairedMediaOf — a promoted pairing', () => {
  it('uses the song fragment', () => {
    expect(pairedMediaOf({ paired_song_id: 'song-1', paired_song: SONG, paired_playlist_url: PLAYLIST })).toEqual({
      fragmentId: 'song-1',
      title: 'Creep',
      artist: 'Bob Reynolds',
      url: 'https://open.spotify.com/track/abc',
    });
  });

  // THE REGRESSION. `paired_song_id` is set but the embed came back null,
  // which is exactly what an anon reader sees when the song is a draft.
  it('shows NOTHING when RLS hid the song — it must not fall back to the playlist', () => {
    expect(pairedMediaOf({ paired_song_id: 'song-1', paired_song: null, paired_playlist_url: PLAYLIST })).toBeNull();
  });

  it('shows nothing when the song is in the trash', () => {
    expect(
      pairedMediaOf({
        paired_song_id: 'song-1',
        paired_song: { ...SONG, deleted_at: '2026-07-31T00:00:00Z' },
        paired_playlist_url: PLAYLIST,
      }),
    ).toBeNull();
  });

  it('shows nothing when the song somehow has no URL to embed', () => {
    expect(
      pairedMediaOf({
        paired_song_id: 'song-1',
        paired_song: { ...SONG, source_url: null },
        paired_playlist_url: PLAYLIST,
      }),
    ).toBeNull();
  });

  it('carries an empty artist through rather than inventing one', () => {
    const got = pairedMediaOf({ paired_song_id: 'song-1', paired_song: { ...SONG, attribution: null } });
    expect(got?.artist).toBeNull();
  });
});

describe('pairedMediaOf — the legacy path', () => {
  // Only reachable when the essay was NEVER promoted. Two imported essays are
  // paired with a Spotify playlist, which ADR-0009 forbids a song from citing.
  it('falls back to the playlist when there is no paired_song_id', () => {
    expect(pairedMediaOf({ paired_song_id: null, paired_playlist_url: PLAYLIST })).toEqual({
      fragmentId: null,
      title: '',
      artist: null,
      url: PLAYLIST,
    });
  });

  it('gives no title, so the iframe falls back to the generic accessible name', () => {
    const got = pairedMediaOf({ paired_playlist_url: PLAYLIST });
    expect(got?.title).toBe('');
    expect(got?.fragmentId).toBeNull();
  });
});

describe('pairedMediaOf — nothing at all', () => {
  it('is null for a row with neither', () => {
    expect(pairedMediaOf({})).toBeNull();
    expect(pairedMediaOf({ paired_playlist_url: null })).toBeNull();
    // An empty string is not a pairing either — a cleared field arrives as ''
    // through the form layer before the action normalises it.
    expect(pairedMediaOf({ paired_playlist_url: '' })).toBeNull();
  });
});
