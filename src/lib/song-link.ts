/**
 * Is this text a LINK, or is it something to search for?
 *
 * One question, asked in one place, so the Music tab's single field can take
 * both (plan 33 §6a: *"if I'm trying to pair a song that doesn't already exist
 * in the corpus, then I have to stop what I'm doing, create a new fragment, go
 * back to the piece of writing"*).
 *
 * ⚠ IT DELIBERATELY KNOWS NOTHING ABOUT SPOTIFY OR YOUTUBE, and that is the
 * whole design. "May a song cite this?" is a different and much harder question
 * — track vs album vs playlist vs episode, `?si=` tokens, `intl-xx/` paths,
 * eleven-character video ids — and it is already answered, exactly once, by
 * `parseSongRef` in `src/lib/media.ts`. Repeating any part of that here would
 * create a second parser to drift against the first, and the browser's copy
 * would be the one nobody notices is wrong.
 *
 * So this decides only WHICH ROUND TRIP TO MAKE: search the corpus, or ask the
 * server to read a link. A false positive is harmless — `songs.lookup` answers
 * with *"Spotify track/album or YouTube video, please"*, which is the true
 * sentence about a link a song may not cite. A false negative is the one that
 * costs, so the shapes below are the ones a paste actually produces.
 *
 * ⚠ If the client ever needs the AUTHORITATIVE answer rather than this one, the
 * fix is to split `media.ts`'s pure half into its own module — it is server-only
 * because of the Spotify Web API section, not because of the parsing — and NOT
 * to grow provider knowledge here.
 */
export function looksLikeLink(text: string): boolean {
  const trimmed = text.trim();
  // `https://…` covers every real paste: Spotify's share sheet, the browser's
  // address bar, and YouTube's Share dialog all copy a full absolute URL.
  // `spotify:track:…` is the desktop app's own copy format, which is not a URL
  // at all and would otherwise read as a search term.
  return /^https?:\/\//i.test(trimmed) || /^spotify:/i.test(trimmed);
}
