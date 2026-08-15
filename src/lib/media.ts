/**
 * The embeddable media a song can cite, and the metadata we can learn about it.
 *
 * Was `spotify.ts` until paired media grew a YouTube branch (docs/plans/04
 * Piece 3): three of the fifty imported pairings are YouTube videos, and they
 * are songs — just not on Spotify. The module kept its shape and changed its
 * name.
 *
 * Two tiers of lookup, and the difference is the whole point of Piece 4:
 *
 *   • oEmbed — keyless, always available, returns a TITLE and artwork and, on
 *     Spotify, no artist at all. This is what the site ran on until now, and
 *     it is why the song form had manual artist/album fields.
 *   • the Spotify Web API — client credentials, returns artist names AND ids,
 *     album, release date, artwork at 640/300/64, ISRC.
 *
 * The API is the preferred path and oEmbed is the fallback, so a missing
 * credential — or the lapsed Premium subscription that Development Mode now
 * requires of the app owner — degrades to the old behaviour instead of
 * breaking song entry.
 *
 * SERVER ONLY: `astro:env/server` is imported below. Nothing in `src/scripts/`
 * may import this file. (The one-off backfill in `scripts/` is plain Node and
 * deliberately reimplements the few lines it needs, as `backfill-vocab.mjs`
 * does with slugify.)
 */
import { getSecret } from 'astro:env/server';

const OEMBED_SPOTIFY = 'https://open.spotify.com/oembed';
const OEMBED_YOUTUBE = 'https://www.youtube.com/oembed';
const ACCOUNTS = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

/**
 * ⚠ A FETCH WITH NO TIMEOUT IS NOT A FETCH, IT IS A HANG. `gcal.ts` says it
 * first and it is exactly as true here: every call below runs inside a request,
 * so a connection Spotify or YouTube never answers holds the action — and the
 * sheet, and the person watching it — until the platform kills the invocation.
 * Three of these fetches had no bound at all (plans/30 · §5).
 *
 * Shorter than `gcal.ts`'s ten seconds ON PURPOSE, and the difference is who is
 * waiting. That one is a background sync nobody is timing; this one is behind a
 * button somebody just pressed with a pasted link, and eight seconds of a dead
 * Paste field is already longer than anyone will sit through. There is no retry
 * to go with it, also on purpose: `lookupSong` already has a second tier to try
 * (oEmbed), which is a better answer than the same tier twice.
 */
const TIMEOUT_MS = 8_000;

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
 * What a `song` fragment is allowed to cite: one Spotify track, one whole
 * Spotify album (ADR-0009 — "albums become a small extension, not a new idea"),
 * or one YouTube video.
 *
 * A PLAYLIST is still not a song, on either provider: it belongs to a
 * constellation as its `score_url`, or to a single essay as its
 * `paired_playlist_url` (plan 40 §1b). That rule is what kept the two imported
 * playlist pairings out of `fragments` — see `PairedMedia` in `blog.ts`.
 */
export type SongRef =
  { provider: 'spotify'; kind: 'track' | 'album'; id: string } | { provider: 'youtube'; kind: 'video'; id: string };

/** YouTube ids are exactly 11 chars of [A-Za-z0-9_-]. */
const YT_ID = '([A-Za-z0-9_-]{11})';

export function parseSongRef(url: string): SongRef | null {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;

  // youtu.be/ID · youtube.com/watch?v=ID · /embed/ID · /shorts/ID · /live/ID
  const yt =
    trimmed.match(new RegExp(`youtu\\.be/${YT_ID}`)) ??
    trimmed.match(new RegExp(`youtube\\.com/(?:watch\\?(?:[^#]*&)?v=|embed/|shorts/|live/|v/)${YT_ID}`));
  if (yt) return { provider: 'youtube', kind: 'video', id: yt[1] };

  const sp = parseSpotifyEmbed(trimmed);
  if (sp && (sp.kind === 'track' || sp.kind === 'album')) {
    return { provider: 'spotify', kind: sp.kind, id: sp.id };
  }
  return null;
}

/** The canonical, tracking-free URL for a ref — what we store in `source_url`. */
export function songRefUrl(ref: SongRef): string {
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
 * `parseSongRef`, and the distinction is load-bearing:
 *
 *   • `parseSongRef` answers "may a SONG FRAGMENT cite this?" — no playlists,
 *     because ADR-0009 gives playlists to constellations as scores.
 *   • this answers "can we embed what's already stored?" — and two imported
 *     essays are paired with a playlist, from years before that rule existed.
 *
 * Conflating the two renders those two essays with a caption and no player,
 * which is how this was first written and how it was caught.
 */
export function embedForUrl(url: string): MediaEmbed | null {
  const song = parseSongRef(url);
  if (song) return songEmbed(song);
  const sp = parseSpotifyEmbed(url);
  if (sp) {
    return { src: spotifyEmbedSrc(sp), height: spotifyEmbedHeight(sp.kind), allow: SPOTIFY_ALLOW };
  }
  return null;
}

/** The iframe a song ref renders as, whichever provider it came from. */
export function songEmbed(ref: SongRef): MediaEmbed {
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

// ---------------------------------------------------------------------------
// The Spotify Web API — client credentials (docs/plans/04 Piece 4)
// ---------------------------------------------------------------------------

/**
 * Cached bearer token. Client Credentials returns one valid for 3600s and has
 * no refresh token — you simply ask again. Module scope is the right lifetime:
 * a warm serverless instance reuses it, a cold start refetches, and that is
 * harmless (one extra POST, ~100ms, on an admin action nobody is timing).
 *
 * `inFlight` collapses concurrent misses onto one request, which matters for
 * the backfill's burst rather than for interactive use.
 */
let cached: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string | null> | null = null;

/** Refresh this many ms before the stated expiry, so a token can't die mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

export function spotifyApiConfigured(): boolean {
  return Boolean(getSecret('SPOTIFY_CLIENT_ID') && getSecret('SPOTIFY_CLIENT_SECRET'));
}

async function accessToken(): Promise<string | null> {
  const clientId = getSecret('SPOTIFY_CLIENT_ID');
  const clientSecret = getSecret('SPOTIFY_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;

  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(ACCOUNTS, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      if (!res.ok) {
        cached = null;
        return null;
      }
      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;
      cached = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - EXPIRY_MARGIN_MS,
      };
      return cached.token;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Shape of the bits of Spotify's track/album objects we actually read. */
interface SpotifyArtist {
  name?: string;
  id?: string;
}
interface SpotifyImage {
  url?: string;
  width?: number;
}
interface SpotifyEntity {
  name?: string;
  artists?: SpotifyArtist[];
  images?: SpotifyImage[];
  release_date?: string;
  external_ids?: { isrc?: string };
  duration_ms?: number;
  album?: {
    name?: string;
    id?: string;
    images?: SpotifyImage[];
    release_date?: string;
  };
}

/**
 * Artwork at roughly `want` px. Spotify returns 640/300/64 for tracks and
 * albums; we take the smallest image that is still at least `want` wide, and
 * the largest available if none reaches it.
 */
function pickImage(images: SpotifyImage[] | undefined, want: number): string | null {
  const sized = (images ?? []).filter((i): i is { url: string; width: number } =>
    Boolean(i.url && typeof i.width === 'number'),
  );
  if (sized.length === 0) return images?.[0]?.url ?? null;
  const big = sized.filter((i) => i.width >= want).sort((a, b) => a.width - b.width)[0];
  return (big ?? sized.sort((a, b) => b.width - a.width)[0]).url;
}

/** `2022-01-12` / `2022-01` / `2022` → 2022. */
function releaseYear(date: string | undefined): number | null {
  const year = Number((date ?? '').slice(0, 4));
  return Number.isInteger(year) && year > 1000 ? year : null;
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

export interface SongLookup {
  ref: SongRef;
  /** Canonical URL for `source_url`, stripped of `?si=` tracking params. */
  url: string;
  title: string;
  /** Joined artist names — editable in the sheet; a five-artist track is a mouthful. */
  artist: string | null;
  album: string | null;
  releaseYear: number | null;
  thumbnailUrl: string | null;
  /** Spotify ids, so provenance can be exact rather than name-string matching. */
  artistIds: string[];
  albumId: string | null;
  isrc: string | null;
  durationMs: number | null;
  /**
   * Which tier answered. `oembed` means artist/album/year came back null and
   * the human has to type them — the pre-Piece-4 experience, and what a missing
   * credential or a lapsed Premium degrades to.
   */
  source: 'api' | 'oembed';
}

/** Keyless fallback: a title, artwork, and (on YouTube only) the channel name. */
async function lookupViaOembed(ref: SongRef): Promise<SongLookup | null> {
  const url = songRefUrl(ref);
  const endpoint =
    ref.provider === 'youtube'
      ? `${OEMBED_YOUTUBE}?format=json&url=${encodeURIComponent(url)}`
      : `${OEMBED_SPOTIFY}?url=${encodeURIComponent(url)}`;

  const res = await fetch(endpoint, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { title?: string; thumbnail_url?: string; author_name?: string };

  return {
    ref,
    url,
    title: data.title ?? '',
    // YouTube's oEmbed names the channel; Spotify's returns no artist at all.
    artist: ref.provider === 'youtube' ? (data.author_name ?? null) : null,
    album: null,
    releaseYear: null,
    thumbnailUrl: data.thumbnail_url ?? null,
    artistIds: [],
    albumId: null,
    isrc: null,
    durationMs: null,
    source: 'oembed',
  };
}

/** The Web API path — Spotify only, and only when credentials are configured. */
async function lookupViaApi(ref: SongRef): Promise<SongLookup | null> {
  if (ref.provider !== 'spotify') return null;
  const token = await accessToken();
  if (!token) return null;

  const res = await fetch(`${API}/${ref.kind}s/${ref.id}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // A 401 means our cached token went stale early; drop it so the next call
  // refetches rather than looping on a dead credential.
  if (res.status === 401) cached = null;
  if (!res.ok) return null;

  const d = (await res.json()) as SpotifyEntity;
  const artists = (d.artists ?? []).filter((a) => a.name);
  const isTrack = ref.kind === 'track';

  return {
    ref,
    url: songRefUrl(ref),
    title: d.name ?? '',
    artist: artists.length ? artists.map((a) => a.name).join(', ') : null,
    // A track cites its album; an album IS the work, so it doesn't cite itself.
    album: isTrack ? (d.album?.name ?? null) : null,
    releaseYear: releaseYear(isTrack ? d.album?.release_date : d.release_date),
    thumbnailUrl: pickImage(isTrack ? d.album?.images : d.images, 300),
    artistIds: artists.map((a) => a.id).filter((id): id is string => Boolean(id)),
    albumId: isTrack ? (d.album?.id ?? null) : ref.id,
    isrc: d.external_ids?.isrc ?? null,
    durationMs: d.duration_ms ?? null,
    source: 'api',
  };
}

/**
 * Neither tier answered, and the reason was the NETWORK rather than the link.
 *
 * ⚠ ITS OWN CLASS BECAUSE `null` ALREADY MEANS SOMETHING ELSE — "that is not a
 * thing a song may cite", which the sheet reports as *"Spotify track/album or
 * YouTube video, please"*. Collapsing a timeout into that would answer a
 * network fault by telling somebody their perfectly good Spotify link is the
 * wrong kind of link, which is the same confident-wrong-sentence fault
 * `links.assertExists` was carrying (plans/30 · §2).
 */
export class MediaUnreachable extends Error {
  constructor() {
    super('Couldn’t reach Spotify or YouTube just now — paste it again in a moment.');
    this.name = 'MediaUnreachable';
  }
}

/**
 * Resolve a pasted track / album / video link to everything we can learn about
 * it. Tries the Web API first and falls back to oEmbed, so the caller never has
 * to know which tier is available — only `source` says, and only so the sheet
 * can explain why the artist field is still empty.
 *
 * Returns null when the URL isn't something a song may cite; throws
 * `MediaUnreachable` when it is and nobody answered.
 */
export async function lookupSong(url: string): Promise<SongLookup | null> {
  const ref = parseSongRef(url);
  if (!ref) return null;
  try {
    const viaApi = await lookupViaApi(ref);
    if (viaApi) return viaApi;
  } catch {
    // Network trouble on the API path is not fatal — oEmbed may still answer.
  }
  // ⚠ AND THE FALLBACK IS WRAPPED TOO, which it was not: only the API path sat
  // in a `try`, so a dead network on the LAST tier threw straight out of the
  // action and surfaced as a bare 500 (plans/30 · §5). The two tiers now fail
  // the same way — the difference between them is a cost, not a contract.
  try {
    return await lookupViaOembed(ref);
  } catch {
    throw new MediaUnreachable();
  }
}
