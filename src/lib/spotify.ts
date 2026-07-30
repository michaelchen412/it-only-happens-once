/**
 * Song metadata via Spotify's keyless oEmbed endpoint (admin.md §6).
 *
 * What we get: the entity's title, the artwork, and the embed. What we DON'T
 * get: the artist or album — oEmbed simply doesn't return them, so those stay
 * manual. Full metadata would require the Spotify Web API (registered app +
 * secrets), deferred until manual entry becomes a real annoyance.
 */

const OEMBED = 'https://open.spotify.com/oembed';

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

/** Canonical embed iframe `src` for a parsed ref. `theme=0` follows the dark UI. */
export function spotifyEmbedSrc(ref: SpotifyEmbed): string {
  return `https://open.spotify.com/embed/${ref.kind}/${ref.id}?theme=0`;
}

/**
 * The iframe height for a kind. A track player is one row; everything with a
 * tracklist needs the taller frame. These are the numbers Spotify's own oEmbed
 * reports (verified live 2026-07-29: track 152, album & playlist 352) —
 * hardcoded because the public renderer embeds from a stored URL without
 * making a network call.
 */
export function spotifyEmbedHeight(kind: SpotifyEmbedKind): number {
  return kind === 'track' ? 152 : 352;
}

/**
 * What a `song` fragment is allowed to cite: one track, or one whole album
 * (ADR-0009 — "albums become a small extension, not a new idea"). Everything
 * else Spotify can embed — a playlist, an artist, a podcast episode — is not a
 * song: a playlist belongs to a constellation as its `score_url`.
 */
export type SongRefKind = 'track' | 'album';

export function parseSongRef(url: string): { kind: SongRefKind; id: string } | null {
  const ref = parseSpotifyEmbed(url);
  if (!ref) return null;
  return ref.kind === 'track' || ref.kind === 'album' ? { kind: ref.kind, id: ref.id } : null;
}

export interface SpotifyLookup {
  spotifyId: string;
  kind: SongRefKind;
  title: string;
  thumbnailUrl: string | null;
}

/**
 * Resolve a pasted Spotify link to the bits we can auto-fill. Returns null when
 * the URL isn't a track or album link, or Spotify doesn't answer — the caller
 * falls back to manual entry.
 */
export async function lookupSpotify(url: string): Promise<SpotifyLookup | null> {
  const ref = parseSongRef(url);
  if (!ref) return null;

  const canonical = `https://open.spotify.com/${ref.kind}/${ref.id}`;
  const res = await fetch(`${OEMBED}?url=${encodeURIComponent(canonical)}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { title?: string; thumbnail_url?: string };
  return {
    spotifyId: ref.id,
    kind: ref.kind,
    title: data.title ?? '',
    thumbnailUrl: data.thumbnail_url ?? null,
  };
}
