// How long a piece takes to read — the arithmetic, alone in its own module.
//
// Two surfaces need this and they count words from different sources: the
// public side from stored Markdown (`readingMinutes` in ./markdown), and the
// writing composer from TipTap's live document, in the browser. If the composer
// imported ./markdown for it, `marked` and `sanitize-html` would land in the
// client bundle — that module calls `marked.setOptions` at import time, so a
// bundler can't shake them out. Keeping the rule here, dependency-free, is what
// lets both share it instead of quietly disagreeing about how long a piece is.

/** ~220 wpm. The one number both the public read time and the composer's live
 *  gauge divide by; change it here and both move together. */
export const WORDS_PER_MINUTE = 220;

/** Words in an already-plain-text string. Whitespace-only is 0, not 1. */
export function countWords(plain: string): number {
  const trimmed = plain.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Minutes to read `words` — rounded, never below 1, because "0 min read" is a
 *  stranger thing to print under a title than "1 min read". */
export function minutesForWords(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
