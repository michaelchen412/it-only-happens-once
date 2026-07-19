/**
 * Song metadata via Spotify's keyless oEmbed endpoint (admin.md §6).
 *
 * What we get: the track title, the artwork, and the embed. What we DON'T get:
 * the artist or album — oEmbed simply doesn't return them, so those stay manual.
 * Full metadata would require the Spotify Web API (registered app + secrets),
 * deferred until manual entry becomes a real annoyance.
 */

const OEMBED = 'https://open.spotify.com/oembed';

/** Pull the track id out of any Spotify track URL (open.spotify.com or spotify: URI). */
export function parseSpotifyTrackId(url: string): string | null {
  const trimmed = url.trim();
  // spotify:track:ID
  const uri = trimmed.match(/^spotify:track:([A-Za-z0-9]+)$/);
  if (uri) return uri[1];
  // https://open.spotify.com/track/ID?...  (also intl-xx/track/ID)
  const web = trimmed.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]+)/);
  if (web) return web[1];
  return null;
}

export interface SpotifyLookup {
  spotifyId: string;
  title: string;
  thumbnailUrl: string | null;
}

/**
 * Resolve a pasted Spotify link to the bits we can auto-fill. Returns null when
 * the URL isn't a recognizable track or Spotify doesn't answer — the caller
 * falls back to manual entry.
 */
export async function lookupSpotifyTrack(url: string): Promise<SpotifyLookup | null> {
  const id = parseSpotifyTrackId(url);
  if (!id) return null;

  const canonical = `https://open.spotify.com/track/${id}`;
  const res = await fetch(`${OEMBED}?url=${encodeURIComponent(canonical)}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { title?: string; thumbnail_url?: string };
  return {
    spotifyId: id,
    title: data.title ?? '',
    thumbnailUrl: data.thumbnail_url ?? null,
  };
}
