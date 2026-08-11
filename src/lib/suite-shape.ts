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
 * What publishing this constellation would actually put in front of a stranger.
 *
 * ⚠ THE ONE THING THE COMPOSER COULD NOT SEE. A suite holds drafts — the Read
 * view shows them on purpose — but `getConstellation` is published-only, so a
 * six-piece composition with four drafts in it is a two-piece page to everyone
 * who isn't Michael. /admin/constellations has always known this ("6 placed ·
 * 3 public"); the room where you actually press publish did not, and the gap
 * was widest in the case that matters most: every piece a draft, and a live
 * page with nothing on it.
 *
 * Phrased as "a reader WOULD see", not "the public page shows", because this
 * line has to be true while the constellation is still a draft too — where the
 * count is a forecast rather than a fact.
 *
 * Empty in, empty out: an unplaced constellation has its own empty state
 * saying so, and a suite with nothing to warn about should say nothing at all.
 * Instruments, never police — same contract as the hints below.
 */
export function publicShapeHint(placed: number, drafts: number): string {
  if (placed === 0 || drafts === 0) return '';
  const shown = placed - drafts;
  return shown === 0
    ? `Every one of the ${placed} placed is a draft — a reader would find this page empty.`
    : `${drafts} of the ${placed} placed ${drafts === 1 ? 'is a draft' : 'are drafts'} — a reader would see ${shown}.`;
}

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
