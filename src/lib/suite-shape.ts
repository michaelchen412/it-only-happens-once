// The two shape tests a composed suite is read against — the numbers behind
// the composer's hint line (design.md §13).
//
// WHY ITS OWN FILE, and not a few lines inside constellations.ts where the rest
// of the suite logic lives: the composer's ✕ removes a row in the browser now,
// so the hints have to be recomputed CLIENT-side, and `constellations.ts`
// transitively imports `marked` and `sanitize-html` (through markdown.ts, which
// calls `marked.setOptions` at module scope and so cannot be tree-shaken away).
// Importing it from a `<script>` would ship a Markdown renderer and an HTML
// sanitizer to the browser to decide whether five is fewer than five. A leaf
// module with no imports at all is the whole fix.
//
// The alternative — writing `< 5` / `> 15` / `< 3` once in the page frontmatter
// and again in its script — is what this exists to prevent. That drift would be
// SILENT: the badge would simply stop agreeing with the sentence beneath it,
// and only on a constellation someone had edited without reloading.

/**
 * What the suite's size and subject spread are worth noticing, said in words.
 *
 * These are INSTRUMENTS, never police: an empty string means "nothing to say",
 * which is the normal case. Nothing here disables anything, nothing turns red,
 * and the hint appears only off-band — the same contract the publish preflight
 * keeps in the writing sheet.
 */
export function suiteHints(placed: number, spread: number): { size: string; spread: string } {
  return {
    size:
      placed === 0
        ? ''
        : placed < 5
          ? 'thin — a constellation usually holds ~5–15'
          : placed > 15
            ? 'heavy — two constellations fused? (~5–15)'
            : '',
    spread: placed > 0 && spread < 3 ? 'narrow — a way of seeing usually crosses ≥3 subjects' : '',
  };
}
