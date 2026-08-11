// Query, or link? (plan 33 §6a)
//
// ⚠ THE VALUE OF THIS FILE IS MOSTLY IN WHAT IT REFUSES TO ASSERT. The function
// decides which round trip the Music tab makes, and NOT whether a song may cite
// something — that is `parseSongRef`'s job, on the server, once. Every test
// below is written to stay true if Spotify changes its URL shapes tomorrow,
// because a test here that knew about `intl-de/` paths would be the first half
// of the second parser this function exists to avoid.
import { describe, expect, it } from 'vitest';
import { looksLikeLink } from '../lib/song-link';

describe('looksLikeLink', () => {
  it('takes what a paste actually produces', () => {
    // Spotify's share sheet, the browser address bar, YouTube's Share dialog,
    // and the desktop app's own URI format. These four are the input.
    expect(looksLikeLink('https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5?si=abc')).toBe(true);
    expect(looksLikeLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(looksLikeLink('http://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(looksLikeLink('spotify:track:697MdxMbVWn1Ajbw8iaPv5')).toBe(true);
  });

  it('leaves a title or an artist alone', () => {
    expect(looksLikeLink('Last Birthday')).toBe(false);
    expect(looksLikeLink('Bob Reynolds')).toBe(false);
    expect(looksLikeLink('')).toBe(false);
    // The one that would be embarrassing: a blank field means "show me the most
    // recent", and sending whitespace to a Spotify lookup would answer a
    // deliberate no-op with an error.
    expect(looksLikeLink('   ')).toBe(false);
  });

  it('tolerates the whitespace a paste brings with it', () => {
    expect(looksLikeLink('  https://open.spotify.com/track/x  ')).toBe(true);
    expect(looksLikeLink('\nspotify:album:x')).toBe(true);
  });

  it('is case-insensitive about the scheme, because a clipboard is not', () => {
    expect(looksLikeLink('HTTPS://open.spotify.com/track/x')).toBe(true);
    expect(looksLikeLink('Spotify:Track:x')).toBe(true);
  });

  it('⚠ says yes to links a song may NOT cite, and that is correct', () => {
    // A playlist is not a song (ADR-0009 gives playlists to constellations as
    // scores), and neither is a news article. Both still take the LINK path,
    // because the alternative is worse in both directions: judging them here
    // duplicates `parseSongRef`, and treating them as search terms answers a
    // pasted URL with "no songs match" — which says nothing about why.
    //
    // `songs.lookup` refuses them with the sentence that names the real problem.
    expect(looksLikeLink('https://open.spotify.com/playlist/37i9dQZF1DX')).toBe(true);
    expect(looksLikeLink('https://example.com/an-article')).toBe(true);
  });

  it('⚠ says no to a bare domain, and that is the accepted cost', () => {
    // `open.spotify.com/track/x` with no scheme reads as a search term and finds
    // nothing. Accepted rather than patched: catching it needs either a
    // domain list — provider knowledge, i.e. the second parser — or a loose
    // "contains a dot and a slash" rule that would swallow ordinary titles.
    // Both real copy paths (the share sheet and the address bar) include the
    // scheme, so this is a shape nothing actually produces.
    expect(looksLikeLink('open.spotify.com/track/x')).toBe(false);
  });
});
