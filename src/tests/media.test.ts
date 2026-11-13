// What an essay's music may be, and how it embeds (ADR 0044).
//
// This is regex, which is exactly the kind of thing that looks right and isn't:
// a YouTube id is 11 chars of [A-Za-z0-9_-], which means `-` and `_` are legal
// and a greedy pattern happily eats a `?t=30` suffix.
import { describe, expect, it } from 'vitest';
import {
  embedForUrl,
  musicEmbed,
  musicRefUrl,
  parseMusicRef,
  spotifyEmbedHeight,
  parseSpotifyEmbed,
} from '../lib/media';

describe('parseMusicRef — Spotify', () => {
  it('takes a track link', () => {
    expect(parseMusicRef('https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5')).toEqual({
      provider: 'spotify',
      kind: 'track',
      id: '697MdxMbVWn1Ajbw8iaPv5',
    });
  });

  it('takes an album link', () => {
    expect(parseMusicRef('https://open.spotify.com/album/3INiRYxzmmq04CYPbx5v6H')).toEqual({
      provider: 'spotify',
      kind: 'album',
      id: '3INiRYxzmmq04CYPbx5v6H',
    });
  });

  it('survives the ?si= tracking token the share sheet appends', () => {
    // Both songs already in the corpus were saved with one of these.
    const ref = parseMusicRef('https://open.spotify.com/track/1ZNRJry28A7EsSgoMpW49Z?si=715df3742f3a4825');
    expect(ref).toEqual({ provider: 'spotify', kind: 'track', id: '1ZNRJry28A7EsSgoMpW49Z' });
  });

  it('survives the /intl-xx/ locale prefix', () => {
    expect(parseMusicRef('https://open.spotify.com/intl-de/track/697MdxMbVWn1Ajbw8iaPv5')?.id).toBe(
      '697MdxMbVWn1Ajbw8iaPv5',
    );
  });

  it('takes a spotify: URI', () => {
    expect(parseMusicRef('spotify:track:697MdxMbVWn1Ajbw8iaPv5')).toEqual({
      provider: 'spotify',
      kind: 'track',
      id: '697MdxMbVWn1Ajbw8iaPv5',
    });
  });

  // ADR 0044: a playlist is music an essay may carry. It was refused while music
  // was a song row (ADR 0009 — a song is one recording), which is why the two
  // imported playlist pairings needed a column of their own.
  it('takes a playlist', () => {
    expect(parseMusicRef('https://open.spotify.com/playlist/2wQlYWCZpxDvO7UAWEUSY5')).toEqual({
      provider: 'spotify',
      kind: 'playlist',
      id: '2wQlYWCZpxDvO7UAWEUSY5',
    });
    expect(parseMusicRef('spotify:playlist:2wQlYWCZpxDvO7UAWEUSY5')?.kind).toBe('playlist');
  });

  it('refuses artists, shows and episodes', () => {
    expect(parseMusicRef('https://open.spotify.com/artist/7blXVKBSxdFZsIqlhdViKc')).toBeNull();
    expect(parseMusicRef('https://open.spotify.com/episode/4bZZ2sLZTGaQMRVfNJTHKz')).toBeNull();
    expect(parseMusicRef('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk')).toBeNull();
  });

  it('refuses junk', () => {
    expect(parseMusicRef('')).toBeNull();
    expect(parseMusicRef('not a url')).toBeNull();
    expect(parseMusicRef('https://example.com/track/abc')).toBeNull();
  });
});

describe('parseMusicRef — YouTube', () => {
  // The three imported pairings that are videos, not Spotify tracks.
  it('takes a watch?v= link', () => {
    expect(parseMusicRef('https://www.youtube.com/watch?v=IXQN1mv6CtI')).toEqual({
      provider: 'youtube',
      kind: 'video',
      id: 'IXQN1mv6CtI',
    });
  });

  it('takes a watch link with the id NOT first', () => {
    expect(parseMusicRef('https://www.youtube.com/watch?list=PLabc&v=_qsjJu53ghc')?.id).toBe('_qsjJu53ghc');
  });

  it('keeps a leading underscore and does not eat a trailing param', () => {
    // `_qsjJu53ghc` is a real id from the corpus and starts with an underscore;
    // `?t=30` must not be swallowed into the 11-char window.
    expect(parseMusicRef('https://youtu.be/_qsjJu53ghc?t=30')?.id).toBe('_qsjJu53ghc');
  });

  it('takes youtu.be, /embed/, /shorts/ and /live/', () => {
    expect(parseMusicRef('https://youtu.be/gzFAR6aN20g')?.id).toBe('gzFAR6aN20g');
    expect(parseMusicRef('https://www.youtube.com/embed/gzFAR6aN20g')?.id).toBe('gzFAR6aN20g');
    expect(parseMusicRef('https://www.youtube.com/shorts/gzFAR6aN20g')?.id).toBe('gzFAR6aN20g');
    expect(parseMusicRef('https://www.youtube.com/live/gzFAR6aN20g')?.id).toBe('gzFAR6aN20g');
  });

  it('refuses an id of the wrong length', () => {
    expect(parseMusicRef('https://www.youtube.com/watch?v=tooshort')).toBeNull();
  });
});

describe('musicRefUrl — the canonical form stored in music_url', () => {
  it('drops the ?si= tracking token', () => {
    const ref = parseMusicRef('https://open.spotify.com/track/1ZNRJry28A7EsSgoMpW49Z?si=715df3742f3a4825')!;
    expect(musicRefUrl(ref)).toBe('https://open.spotify.com/track/1ZNRJry28A7EsSgoMpW49Z');
  });

  it('normalises youtu.be to a watch URL', () => {
    expect(musicRefUrl(parseMusicRef('https://youtu.be/IXQN1mv6CtI')!)).toBe(
      'https://www.youtube.com/watch?v=IXQN1mv6CtI',
    );
  });

  it('round-trips: the canonical URL parses back to the same ref', () => {
    for (const url of [
      'https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5',
      'https://open.spotify.com/album/3INiRYxzmmq04CYPbx5v6H',
      'https://open.spotify.com/playlist/28ohILaOsYNo8vZlmkfFkf',
      'https://www.youtube.com/watch?v=IXQN1mv6CtI',
    ]) {
      const ref = parseMusicRef(url)!;
      expect(parseMusicRef(musicRefUrl(ref))).toEqual(ref);
    }
  });
});

describe('musicEmbed', () => {
  it('gives a Spotify track its one-row height', () => {
    const e = musicEmbed({ provider: 'spotify', kind: 'track', id: 'abc' });
    expect(e.height).toBe(152);
    expect(e.src).toBe('https://open.spotify.com/embed/track/abc?theme=0');
  });

  it('gives an album the taller tracklist frame', () => {
    expect(musicEmbed({ provider: 'spotify', kind: 'album', id: 'abc' }).height).toBe(352);
    expect(spotifyEmbedHeight('playlist')).toBe(352);
  });

  it('gives video a null height, so the caller uses a 16:9 box', () => {
    const e = musicEmbed({ provider: 'youtube', kind: 'video', id: 'IXQN1mv6CtI' });
    expect(e.height).toBeNull();
    // -nocookie, and rel=0 so the end card stays in the same channel.
    expect(e.src).toContain('youtube-nocookie.com/embed/IXQN1mv6CtI');
    expect(e.src).toContain('rel=0');
  });
});

describe('the `allow` attribute — the permissions a play button actually needs', () => {
  // Regression pin, 2026-08-10. We shipped `allow="encrypted-media"` alone, and
  // some play buttons did nothing — intermittently, which is the tell: Chrome's
  // Feature Policy blocks `autoplay` in a cross-origin iframe unless the
  // EMBEDDER delegates it, and its per-origin Media Engagement Index decides
  // how strictly, so the same page fails on one profile and works on another.
  // Spotify's docs are explicit that dropping these restricts the player to
  // preview mode. Cheap to lose in a refactor, expensive to notice.
  const grants = (allow: string) => new Set(allow.split(';').map((s) => s.trim()));

  it('delegates autoplay AND encrypted-media for a Spotify track', () => {
    const g = grants(musicEmbed({ provider: 'spotify', kind: 'track', id: 'abc' }).allow);
    expect(g.has('autoplay')).toBe(true);
    expect(g.has('encrypted-media')).toBe(true);
  });

  it('delegates them for a Spotify album too', () => {
    const g = grants(musicEmbed({ provider: 'spotify', kind: 'album', id: 'abc' }).allow);
    expect(g.has('autoplay')).toBe(true);
    expect(g.has('encrypted-media')).toBe(true);
  });

  it('delegates autoplay for YouTube', () => {
    const g = grants(musicEmbed({ provider: 'youtube', kind: 'video', id: 'abcdefghijk' }).allow);
    expect(g.has('autoplay')).toBe(true);
  });

  it('delegates them for a playlist', () => {
    const g = grants(embedForUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')!.allow);
    expect(g.has('autoplay')).toBe(true);
    expect(g.has('encrypted-media')).toBe(true);
  });
});

describe('embedForUrl — wider than parseMusicRef, on purpose', () => {
  it('embeds a playlist at the tall tracklist height', () => {
    const e = embedForUrl('https://open.spotify.com/playlist/2wQlYWCZpxDvO7UAWEUSY5')!;
    expect(e.src).toBe('https://open.spotify.com/embed/playlist/2wQlYWCZpxDvO7UAWEUSY5?theme=0');
    expect(e.height).toBe(352);
  });

  it('embeds an artist an essay may not carry — the About page asks this too', () => {
    const url = 'https://open.spotify.com/artist/7blXVKBSxdFZsIqlhdViKc';
    expect(parseMusicRef(url)).toBeNull();
    expect(embedForUrl(url)?.src).toContain('/embed/artist/');
  });

  it('still handles tracks and videos', () => {
    expect(embedForUrl('https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5')?.height).toBe(152);
    expect(embedForUrl('https://www.youtube.com/watch?v=IXQN1mv6CtI')?.height).toBeNull();
  });

  it('returns null for something with no embed at all', () => {
    expect(embedForUrl('https://example.com/song.mp3')).toBeNull();
  });
});

describe('parseSpotifyEmbed still accepts everything embeddable', () => {
  // Unchanged behaviour — /about embeds the name-origin album, and a
  // constellation's score is a playlist. Narrowing this would break both.
  it('takes a playlist', () => {
    expect(parseSpotifyEmbed('https://open.spotify.com/playlist/28ohILaOsYNo8vZlmkfFkf')).toEqual({
      kind: 'playlist',
      id: '28ohILaOsYNo8vZlmkfFkf',
    });
  });
});
