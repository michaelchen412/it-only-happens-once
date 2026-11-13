/**
 * The music an essay can carry, and how it embeds.
 *
 * An essay's music is ONE LINK in `fragments.music_url` (ADR 0044): a Spotify
 * track, album or playlist, or a YouTube video. There is no song row behind it
 * and nothing to look up — the player prints its own title, artist and artwork,
 * so the link is the whole of what the site needs.
 *
 * ⚠ PURE, AND THAT IS NEW. This module used to read `astro:env/server` for the
 * Spotify Web API (title/artist/album lookup for the songs table) and said in
 * this header that nothing in `src/scripts/` might import it. With the table
 * gone the lookup went too, so the browser can now parse and preview a pasted
 * link with the SAME parser the server validates it with — one answer to "can
 * this play?", asked in both places, rather than a second copy in the client.
 */

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** The Spotify entity kinds we can embed. */
export type SpotifyEmbedKind = 'track' | 'album' | 'playlist' | 'episode' | 'show' | 'artist';

export interface SpotifyEmbed {
  kind: SpotifyEmbedKind;
  id: string;
}

/**
 * Parse ANY Spotify URL/URI into `{ kind, id }` for embedding — track, album,
 * playlist, etc. Used by the About builder (the name-origin album) and anywhere
 * we accept a pasted Spotify link. We store just kind+id, never raw iframe HTML.
 */
export function parseSpotifyEmbed(url: string): SpotifyEmbed | null {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;
  // spotify:album:ID
  const uri = trimmed.match(/^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]+)$/);
  if (uri) return { kind: uri[1] as SpotifyEmbedKind, id: uri[2] };
  // https://open.spotify.com/[intl-xx/]album/ID?...
  const web = trimmed.match(
    /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/,
  );
  if (web) return { kind: web[1] as SpotifyEmbedKind, id: web[2] };
  return null;
}

/**
 * What an essay's music may be: one Spotify track, album or playlist, or one
 * YouTube video (ADR 0044).
 *
 * ⚠ PLAYLISTS ARE IN, and they were out for as long as music was a song row.
 * ADR 0009 kept a playlist off a song because a song is ONE recording — so the
 * two imported essays paired with a playlist had to ride a column of their own
 * (`paired_playlist_url`). With no row there is no such rule to keep: a track
 * and a playlist are both "music that plays above this piece", and one column
 * holds either.
 *
 * Episodes, shows and artists stay out. They embed (`embedForUrl` below still
 * takes them, for the About page), but none of them is music you play while
 * reading, and a podcast under an essay is a different thing to decide.
 */
export type MusicRef =
  | { provider: 'spotify'; kind: 'track' | 'album' | 'playlist'; id: string }
  | { provider: 'youtube'; kind: 'video'; id: string };

/** YouTube ids are exactly 11 chars of [A-Za-z0-9_-]. */
const YT_ID = '([A-Za-z0-9_-]{11})';

export function parseMusicRef(url: string): MusicRef | null {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;

  // youtu.be/ID · youtube.com/watch?v=ID · /embed/ID · /shorts/ID · /live/ID
  const yt =
    trimmed.match(new RegExp(`youtu\\.be/${YT_ID}`)) ??
    trimmed.match(new RegExp(`youtube\\.com/(?:watch\\?(?:[^#]*&)?v=|embed/|shorts/|live/|v/)${YT_ID}`));
  if (yt) return { provider: 'youtube', kind: 'video', id: yt[1] };

  const sp = parseSpotifyEmbed(trimmed);
  if (sp && (sp.kind === 'track' || sp.kind === 'album' || sp.kind === 'playlist')) {
    return { provider: 'spotify', kind: sp.kind, id: sp.id };
  }
  return null;
}

/**
 * The canonical, tracking-free URL for a ref — what `music_url` stores.
 *
 * Spotify's share sheet appends a `?si=` tracking token, a German browser adds
 * `intl-de/`, and the desktop app copies `spotify:track:…`. All of them are one
 * piece of music, and none of that has any business on a public page.
 */
export function musicRefUrl(ref: MusicRef): string {
  return ref.provider === 'youtube'
    ? `https://www.youtube.com/watch?v=${ref.id}`
    : `https://open.spotify.com/${ref.kind}/${ref.id}`;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/**
 * The iframe height for a Spotify kind. A track player is one row; everything
 * with a tracklist needs the taller frame. These are the numbers Spotify's own
 * oEmbed reports (verified live 2026-07-29: track 152, album & playlist 352) —
 * hardcoded because the public renderer embeds from a stored URL without making
 * a network call.
 */
export function spotifyEmbedHeight(kind: SpotifyEmbedKind): number {
  return kind === 'track' ? 152 : 352;
}

/** Canonical embed iframe `src` for a parsed Spotify ref. `theme=0` follows the dark UI. */
export function spotifyEmbedSrc(ref: SpotifyEmbed): string {
  return `https://open.spotify.com/embed/${ref.kind}/${ref.id}?theme=0`;
}

/**
 * The permissions each provider's OWN embed code delegates — copied from
 * Spotify's oEmbed response and YouTube's share dialog rather than invented.
 * See `MediaEmbed.allow` for why `autoplay` is load-bearing.
 */
const SPOTIFY_ALLOW = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
const YOUTUBE_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

export interface MediaEmbed {
  src: string;
  /**
   * Fixed pixel height — Spotify's own numbers, since its player is a fixed-height
   * row rather than a scalable surface. `null` means the frame is 16:9 video and
   * the caller should use an aspect-ratio box instead.
   */
  height: number | null;
  /**
   * `allow` attribute: what the frame is permitted to do.
   *
   * ⚠ `autoplay` IS NOT OPTIONAL, AND ITS ABSENCE FAILS INTERMITTENTLY.
   * Chrome's Feature Policy blocks `autoplay` and `encrypted-media` in
   * cross-origin iframes unless the EMBEDDER delegates them — a user gesture
   * inside the frame is not enough, because the gesture is the frame's and the
   * permission is ours. Spotify documents both requirements directly:
   * removing `encrypted-media` "restricts the player to preview mode only",
   * and the Web Playback docs name Feature Policy as the thing that blocks
   * `encrypted-media` and `autoplay` by default.
   *
   * We shipped `encrypted-media` alone until 2026-08-10, when Michael hit a
   * play button that did nothing: "some embeds play button (play button only)
   * is broken... I can't reproduce it reliably." Unreproducible is the
   * signature — Chrome also weighs its per-origin Media Engagement Index, so
   * the same page fails on one profile and works on another, and starts
   * working on yours once you have played enough. These strings now match what
   * each provider's own embed code ships.
   */
  allow: string;
}

/**
 * The iframe ANY stored media URL renders as — deliberately wider than
 * `parseMusicRef`. That answers "may an essay carry this?"; this answers "can
 * we embed it?", which the About page also asks of an artist or a show.
 */
export function embedForUrl(url: string): MediaEmbed | null {
  const music = parseMusicRef(url);
  if (music) return musicEmbed(music);
  const sp = parseSpotifyEmbed(url);
  if (sp) {
    return { src: spotifyEmbedSrc(sp), height: spotifyEmbedHeight(sp.kind), allow: SPOTIFY_ALLOW };
  }
  return null;
}

/** The iframe a music ref renders as, whichever provider it came from. */
export function musicEmbed(ref: MusicRef): MediaEmbed {
  if (ref.provider === 'youtube') {
    return {
      // `rel=0` keeps the end-card suggestions within the same channel rather
      // than throwing the reader out into YouTube's recommendation engine.
      src: `https://www.youtube-nocookie.com/embed/${ref.id}?rel=0`,
      height: null,
      allow: YOUTUBE_ALLOW,
    };
  }
  return {
    src: spotifyEmbedSrc({ kind: ref.kind, id: ref.id }),
    height: spotifyEmbedHeight(ref.kind),
    allow: SPOTIFY_ALLOW,
  };
}
