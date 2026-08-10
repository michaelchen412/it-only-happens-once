// What a song is allowed to cite, and what we can learn about it.
//
// The parsing half is regex, which is exactly the kind of thing that looks
// right and isn't: a YouTube id is 11 chars of [A-Za-z0-9_-], which means `-`
// and `_` are legal and a greedy pattern happily eats a `?t=30` suffix. The
// lookup half has a fallback ladder — Web API, then oEmbed — whose whole job is
// to be invisible, so the only way to know which tier answered is to test it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  embedForUrl,
  lookupSong,
  parseSongRef,
  songEmbed,
  songRefUrl,
  spotifyEmbedHeight,
  parseSpotifyEmbed,
} from '../lib/media';

describe('parseSongRef — Spotify', () => {
  it('takes a track link', () => {
    expect(parseSongRef('https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5')).toEqual({
      provider: 'spotify',
      kind: 'track',
      id: '697MdxMbVWn1Ajbw8iaPv5',
    });
  });

  it('takes an album link', () => {
    expect(parseSongRef('https://open.spotify.com/album/3INiRYxzmmq04CYPbx5v6H')).toEqual({
      provider: 'spotify',
      kind: 'album',
      id: '3INiRYxzmmq04CYPbx5v6H',
    });
  });

  it('survives the ?si= tracking token the share sheet appends', () => {
    // Both songs already in the corpus were saved with one of these.
    const ref = parseSongRef('https://open.spotify.com/track/1ZNRJry28A7EsSgoMpW49Z?si=715df3742f3a4825');
    expect(ref).toEqual({ provider: 'spotify', kind: 'track', id: '1ZNRJry28A7EsSgoMpW49Z' });
  });

  it('survives the /intl-xx/ locale prefix', () => {
    expect(parseSongRef('https://open.spotify.com/intl-de/track/697MdxMbVWn1Ajbw8iaPv5')?.id).toBe(
      '697MdxMbVWn1Ajbw8iaPv5',
    );
  });

  it('takes a spotify: URI', () => {
    expect(parseSongRef('spotify:track:697MdxMbVWn1Ajbw8iaPv5')).toEqual({
      provider: 'spotify',
      kind: 'track',
      id: '697MdxMbVWn1Ajbw8iaPv5',
    });
  });

  // ADR-0009: a playlist belongs to a constellation as its score, not to a song.
  // This is the rule that keeps two of the imported pairings on the fallback path.
  it('REFUSES a playlist', () => {
    expect(parseSongRef('https://open.spotify.com/playlist/2wQlYWCZpxDvO7UAWEUSY5')).toBeNull();
  });

  it('refuses artists, shows and episodes', () => {
    expect(parseSongRef('https://open.spotify.com/artist/7blXVKBSxdFZsIqlhdViKc')).toBeNull();
    expect(parseSongRef('https://open.spotify.com/episode/4bZZ2sLZTGaQMRVfNJTHKz')).toBeNull();
    expect(parseSongRef('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk')).toBeNull();
  });

  it('refuses junk', () => {
    expect(parseSongRef('')).toBeNull();
    expect(parseSongRef('not a url')).toBeNull();
    expect(parseSongRef('https://example.com/track/abc')).toBeNull();
  });
});

describe('parseSongRef — YouTube', () => {
  // The three imported pairings that are videos, not Spotify tracks.
  it('takes a watch?v= link', () => {
    expect(parseSongRef('https://www.youtube.com/watch?v=IXQN1mv6CtI')).toEqual({
      provider: 'youtube',
      kind: 'video',
      id: 'IXQN1mv6CtI',
    });
  });

  it('takes a watch link with the id NOT first', () => {
    expect(parseSongRef('https://www.youtube.com/watch?list=PLabc&v=_qsjJu53ghc')?.id).toBe('_qsjJu53ghc');
  });

  it('keeps a leading underscore and does not eat a trailing param', () => {
    // `_qsjJu53ghc` is a real id from the corpus and starts with an underscore;
    // `?t=30` must not be swallowed into the 11-char window.
    expect(parseSongRef('https://youtu.be/_qsjJu53ghc?t=30')?.id).toBe('_qsjJu53ghc');
  });

  it('takes youtu.be, /embed/, /shorts/ and /live/', () => {
    expect(parseSongRef('https://youtu.be/gzFAR6aN20g')?.id).toBe('gzFAR6aN20g');
    expect(parseSongRef('https://www.youtube.com/embed/gzFAR6aN20g')?.id).toBe('gzFAR6aN20g');
    expect(parseSongRef('https://www.youtube.com/shorts/gzFAR6aN20g')?.id).toBe('gzFAR6aN20g');
    expect(parseSongRef('https://www.youtube.com/live/gzFAR6aN20g')?.id).toBe('gzFAR6aN20g');
  });

  it('refuses an id of the wrong length', () => {
    expect(parseSongRef('https://www.youtube.com/watch?v=tooshort')).toBeNull();
  });
});

describe('songRefUrl — the canonical form stored in source_url', () => {
  it('drops the ?si= tracking token', () => {
    const ref = parseSongRef('https://open.spotify.com/track/1ZNRJry28A7EsSgoMpW49Z?si=715df3742f3a4825')!;
    expect(songRefUrl(ref)).toBe('https://open.spotify.com/track/1ZNRJry28A7EsSgoMpW49Z');
  });

  it('normalises youtu.be to a watch URL', () => {
    expect(songRefUrl(parseSongRef('https://youtu.be/IXQN1mv6CtI')!)).toBe(
      'https://www.youtube.com/watch?v=IXQN1mv6CtI',
    );
  });

  it('round-trips: the canonical URL parses back to the same ref', () => {
    for (const url of [
      'https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5',
      'https://open.spotify.com/album/3INiRYxzmmq04CYPbx5v6H',
      'https://www.youtube.com/watch?v=IXQN1mv6CtI',
    ]) {
      const ref = parseSongRef(url)!;
      expect(parseSongRef(songRefUrl(ref))).toEqual(ref);
    }
  });
});

describe('songEmbed', () => {
  it('gives a Spotify track its one-row height', () => {
    const e = songEmbed({ provider: 'spotify', kind: 'track', id: 'abc' });
    expect(e.height).toBe(152);
    expect(e.src).toBe('https://open.spotify.com/embed/track/abc?theme=0');
  });

  it('gives an album the taller tracklist frame', () => {
    expect(songEmbed({ provider: 'spotify', kind: 'album', id: 'abc' }).height).toBe(352);
    expect(spotifyEmbedHeight('playlist')).toBe(352);
  });

  it('gives video a null height, so the caller uses a 16:9 box', () => {
    const e = songEmbed({ provider: 'youtube', kind: 'video', id: 'IXQN1mv6CtI' });
    expect(e.height).toBeNull();
    // -nocookie, and rel=0 so the end card stays in the same channel.
    expect(e.src).toContain('youtube-nocookie.com/embed/IXQN1mv6CtI');
    expect(e.src).toContain('rel=0');
  });
});

// This is a REGRESSION TEST for a bug that shipped as far as the dev server:
// PostArticle used parseSongRef to decide what to embed, so the two essays
// paired with a playlist rendered a caption and no player. "What may a song
// cite" and "what can we embed" are different questions.
describe('embedForUrl — wider than parseSongRef, on purpose', () => {
  it('embeds a playlist that parseSongRef refuses', () => {
    const url = 'https://open.spotify.com/playlist/2wQlYWCZpxDvO7UAWEUSY5';
    expect(parseSongRef(url)).toBeNull(); // a song fragment may not cite this
    const e = embedForUrl(url)!; // ...but the legacy pairing still has to play
    expect(e.src).toBe('https://open.spotify.com/embed/playlist/2wQlYWCZpxDvO7UAWEUSY5?theme=0');
    expect(e.height).toBe(352);
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

// --- the lookup ladder ------------------------------------------------------

const TRACK_JSON = {
  name: 'Last Birthday',
  artists: [{ name: 'Valley', id: '7blXVKBSxdFZsIqlhdViKc' }],
  album: {
    name: 'The After Party',
    id: '3RJi4CGEm5KVAdPxl2fWWa',
    release_date: '2022-01-12',
    images: [
      { url: 'https://i.example/640.jpg', width: 640 },
      { url: 'https://i.example/300.jpg', width: 300 },
      { url: 'https://i.example/64.jpg', width: 64 },
    ],
  },
  external_ids: { isrc: 'CAUM72100439' },
  duration_ms: 237230,
};

/** Route fetches by URL so a test can assert which tier was reached. */
function stubFetch(routes: Array<[RegExp, unknown, number?]>) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [re, body, status] of routes) {
      if (re.test(url)) {
        return new Response(JSON.stringify(body), {
          status: status ?? 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

describe('lookupSong', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('with credentials: reads the Web API and returns artist, album and year', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'id';
    process.env.SPOTIFY_CLIENT_SECRET = 'secret';
    const calls = stubFetch([
      [/accounts\.spotify\.com/, { access_token: 'tok', expires_in: 3600 }],
      [/api\.spotify\.com\/v1\/tracks\//, TRACK_JSON],
    ]);

    // Fresh module so the module-scope token cache starts empty.
    const { lookupSong: fresh } = await import('../lib/media');
    const got = await fresh('https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5?si=xyz');

    expect(got?.source).toBe('api');
    expect(got?.title).toBe('Last Birthday');
    expect(got?.artist).toBe('Valley'); // the thing oEmbed cannot give us
    expect(got?.album).toBe('The After Party');
    expect(got?.releaseYear).toBe(2022);
    expect(got?.artistIds).toEqual(['7blXVKBSxdFZsIqlhdViKc']);
    expect(got?.albumId).toBe('3RJi4CGEm5KVAdPxl2fWWa');
    expect(got?.isrc).toBe('CAUM72100439');
    // 300 is the smallest image at least 300 wide — not the 640.
    expect(got?.thumbnailUrl).toBe('https://i.example/300.jpg');
    // The stored URL is canonical, not what was pasted.
    expect(got?.url).toBe('https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5');
    // oEmbed was never asked.
    expect(calls.some((u) => u.includes('oembed'))).toBe(false);
  });

  it('caches the token across calls — one POST, two lookups', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'id';
    process.env.SPOTIFY_CLIENT_SECRET = 'secret';
    const calls = stubFetch([
      [/accounts\.spotify\.com/, { access_token: 'tok', expires_in: 3600 }],
      [/api\.spotify\.com/, TRACK_JSON],
    ]);
    const { lookupSong: fresh } = await import('../lib/media');
    await fresh('https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5');
    await fresh('https://open.spotify.com/track/1ZNRJry28A7EsSgoMpW49Z');
    expect(calls.filter((u) => u.includes('accounts.spotify.com')).length).toBe(1);
  });

  it('WITHOUT credentials: falls back to oEmbed, and says so', async () => {
    const calls = stubFetch([
      [/open\.spotify\.com\/oembed/, { title: 'Last Birthday', thumbnail_url: 'https://i/x.jpg' }],
    ]);
    const { lookupSong: fresh } = await import('../lib/media');
    const got = await fresh('https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5');

    expect(got?.source).toBe('oembed');
    expect(got?.title).toBe('Last Birthday');
    // The whole reason Piece 4 exists: Spotify's oEmbed has no artist field.
    expect(got?.artist).toBeNull();
    expect(got?.album).toBeNull();
    expect(got?.releaseYear).toBeNull();
    // No token was requested, because there was nothing to request it with.
    expect(calls.some((u) => u.includes('accounts.spotify.com'))).toBe(false);
  });

  it('falls back to oEmbed when the API refuses (a lapsed Premium looks like this)', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'id';
    process.env.SPOTIFY_CLIENT_SECRET = 'secret';
    stubFetch([
      [/accounts\.spotify\.com/, { error: 'invalid_client' }, 403],
      [/open\.spotify\.com\/oembed/, { title: 'Last Birthday' }],
    ]);
    const { lookupSong: fresh } = await import('../lib/media');
    const got = await fresh('https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5');
    expect(got?.source).toBe('oembed');
    expect(got?.title).toBe('Last Birthday');
  });

  it('YouTube uses oEmbed even with credentials — and gets a channel name for the artist', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'id';
    process.env.SPOTIFY_CLIENT_SECRET = 'secret';
    const calls = stubFetch([
      [/accounts\.spotify\.com/, { access_token: 'tok', expires_in: 3600 }],
      [
        /youtube\.com\/oembed/,
        { title: 'Ben Wendel Seasons Band // July', author_name: 'Ben Wendel - Saxophonist / Composer' },
      ],
    ]);
    const { lookupSong: fresh } = await import('../lib/media');
    const got = await fresh('https://www.youtube.com/watch?v=IXQN1mv6CtI');

    expect(got?.source).toBe('oembed');
    expect(got?.title).toBe('Ben Wendel Seasons Band // July');
    // YouTube's oEmbed DOES name the channel — better than Spotify's.
    expect(got?.artist).toBe('Ben Wendel - Saxophonist / Composer');
    expect(calls.some((u) => u.includes('api.spotify.com'))).toBe(false);
  });

  it('returns null for something a song may not cite', async () => {
    stubFetch([]);
    const { lookupSong: fresh } = await import('../lib/media');
    expect(await fresh('https://open.spotify.com/playlist/2wQlYWCZpxDvO7UAWEUSY5')).toBeNull();
  });

  it('⚠ a dead network is NOT “wrong kind of link” — it throws instead of returning null', async () => {
    // plans/30 §5. Only the API path sat in a `try`, so a throw from the LAST
    // tier escaped the action as a bare 500. The obvious tidy-up — catch it and
    // return null — is the trap this asserts against: null already means "not
    // something a song may cite", and the sheet renders that as *"Spotify
    // track/album or YouTube video, please"*. Answering a timeout with that
    // sends you off to re-check a link that was fine the whole time.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const { lookupSong: fresh, MediaUnreachable } = await import('../lib/media');

    await expect(fresh('https://www.youtube.com/watch?v=IXQN1mv6CtI')).rejects.toBeInstanceOf(MediaUnreachable);
  });

  it('⚠ every outbound call carries a deadline', async () => {
    // A fetch with no timeout is not a fetch, it is a hang — `gcal.ts` had the
    // only one in the tree. Asserted on the REQUEST rather than by waiting,
    // because the alternative is a test that sleeps for eight seconds to prove
    // something the argument list already says.
    process.env.SPOTIFY_CLIENT_ID = 'id';
    process.env.SPOTIFY_CLIENT_SECRET = 'secret';
    const inits: (RequestInit | undefined)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        inits.push(init);
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const { lookupSong: fresh } = await import('../lib/media');
    await fresh('https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5');

    // The token POST and the API GET, both bounded.
    expect(inits.length).toBeGreaterThan(0);
    expect(inits.every((i) => i?.signal instanceof AbortSignal)).toBe(true);
  });
});

// `lookupSong` is imported at the top so a rename breaks the file loudly rather
// than leaving the dynamic imports above silently testing nothing.
void lookupSong;
