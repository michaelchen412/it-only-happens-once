// How an essay's paired song is resolved from a row (ADR-0009, plans/04 Piece 3).
//
// The branch order in `pairedMediaOf` is a SECURITY property, not a preference,
// and it exists because of a bug this file now pins down. All 48 promoted
// essays still carry the legacy `details.media` pointing at the same track. So
// when RLS hides an unpublished paired song, the embed arrives as null — and an
// earlier version of this function then fell through to `details.media` and
// went on playing it. The probe caught it: PostgREST correctly returned
// `paired_song: null` while the rendered page still showed a player.
import { describe, expect, it } from 'vitest';
import { pairedMediaOf } from '../lib/blog';

const SONG = {
  id: 'song-1',
  title: 'Creep',
  attribution: 'Bob Reynolds',
  source_url: 'https://open.spotify.com/track/abc',
  deleted_at: null,
};
const LEGACY = { media: { provider: 'spotify', url: 'https://open.spotify.com/track/abc' } };

describe('pairedMediaOf — a promoted pairing', () => {
  it('uses the song fragment', () => {
    expect(pairedMediaOf({ paired_song_id: 'song-1', paired_song: SONG, details: LEGACY })).toEqual({
      fragmentId: 'song-1',
      title: 'Creep',
      artist: 'Bob Reynolds',
      url: 'https://open.spotify.com/track/abc',
    });
  });

  // THE REGRESSION. `paired_song_id` is set but the embed came back null,
  // which is exactly what an anon reader sees when the song is a draft.
  it('shows NOTHING when RLS hid the song — it must not fall back to details.media', () => {
    expect(pairedMediaOf({ paired_song_id: 'song-1', paired_song: null, details: LEGACY })).toBeNull();
  });

  it('shows nothing when the song is in the trash', () => {
    expect(
      pairedMediaOf({
        paired_song_id: 'song-1',
        paired_song: { ...SONG, deleted_at: '2026-07-31T00:00:00Z' },
        details: LEGACY,
      }),
    ).toBeNull();
  });

  it('shows nothing when the song somehow has no URL to embed', () => {
    expect(
      pairedMediaOf({ paired_song_id: 'song-1', paired_song: { ...SONG, source_url: null }, details: LEGACY }),
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
  it('falls back to details.media when there is no paired_song_id', () => {
    expect(pairedMediaOf({ paired_song_id: null, details: LEGACY })).toEqual({
      fragmentId: null,
      title: '',
      artist: null,
      url: 'https://open.spotify.com/track/abc',
    });
  });

  it('gives no title, so the iframe falls back to the generic accessible name', () => {
    const got = pairedMediaOf({ details: LEGACY });
    expect(got?.title).toBe('');
    expect(got?.fragmentId).toBeNull();
  });
});

describe('pairedMediaOf — nothing at all', () => {
  it('is null for a row with neither', () => {
    expect(pairedMediaOf({})).toBeNull();
    expect(pairedMediaOf({ details: null })).toBeNull();
    expect(pairedMediaOf({ details: {} })).toBeNull();
    expect(pairedMediaOf({ details: { media: {} } })).toBeNull();
  });
});
