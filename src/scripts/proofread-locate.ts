// Turning a `before` string into a ProseMirror range — the part of docs/plans/22
// that looks trivial and is not.
//
// ⚠ NOTHING IN HERE MAY TOUCH THE DOM, and the import list is the guarantee:
// only a TYPE from @tiptap/pm/model, which vanishes at runtime. That is what
// lets `src/tests/proofread-locate.test.ts` exercise it at all — vitest runs
// `environment: 'node'`, so a test that had to build a real TipTap `Editor`
// could not run, and this is the one piece here whose bugs are invisible to
// review, to the compiler and to a screenshot.
//
// ⚠ And this file must never import `src/lib/proofread.ts`, which pulls in the
// Anthropic SDK and the API key path. Same five-line `occurrences` helper lives
// in both on purpose; sharing it would drag the server module into the browser
// bundle to save five lines.
import type { Node as PMNode } from '@tiptap/pm/model';

export interface Range {
  from: number;
  to: number;
}

/**
 * ONE CHARACTER PER INLINE LEAF, and the same character on both sides.
 *
 * `node.textContent` skips non-text inline nodes while positions keep advancing
 * past them, so a single hard break above the typo silently shifts every mark
 * after it. `textBetween` with a one-character placeholder makes each leaf cost
 * exactly what it costs in positions.
 *
 * Hard breaks are the case that matters — NOT images, despite the obvious
 * guess. The composer configures `Image.configure({ inline: false })`, so an
 * image is its own block and never reaches the `isTextblock` branch below.
 *
 * `'\n'` rather than `'￼'`: same one-character property, and the text built
 * with it is also the text SENT to the model, where a line break reads as a line
 * break and an object-replacement glyph reads as noise. Two different renderings
 * of one document is how you get a `before` that exists in what the model read
 * and nowhere in what the editor holds.
 */
export const LEAF = '\n';

/** Non-overlapping occurrences of a literal. */
function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

/** Every textblock's text, in document order, rendered the one way. */
export function blockTexts(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    out.push(node.textBetween(0, node.content.size, undefined, LEAF));
    return false; // its inline children are already in that string
  });
  return out;
}

/**
 * What gets SENT. Built from the same walk the locator uses rather than from
 * `editor.getText()`, which applies its own block separator and gives inline
 * leaves nothing at all — so a fix spanning a hard break would exist in the text
 * the model read and be unfindable in the document, dropped without a word.
 */
export function documentText(doc: PMNode): string {
  return blockTexts(doc).join('\n\n');
}

/**
 * How many times `before` is findable — counted per block, because that is the
 * unit `locate` searches. A span crossing a block boundary counts zero, which is
 * correct: it is not locatable, so it is not a fix we can honour.
 */
export function countInDoc(doc: PMNode, before: string): number {
  return blockTexts(doc).reduce((n, t) => n + occurrences(t, before), 0);
}

/**
 * The first range whose text reads as `before`, or null.
 *
 * ⚠ `return false` DECLINES TO DESCEND — it does not end the walk. Siblings keep
 * coming, so without the `found` guard a second matching block would overwrite
 * the first and the locator would silently prefer the LAST match. The exact-once
 * gates make two matches rare, not impossible: the live document can have gained
 * an occurrence in the ~2s since the text was sent.
 */
export function locate(doc: PMNode, before: string): Range | null {
  let found: Range | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, LEAF);
    const i = text.indexOf(before);
    if (i < 0) return false;
    // Inline positions inside a textblock are contiguous, one per character,
    // and `pos` is the block itself — so its first child sits at pos + 1.
    found = { from: pos + 1 + i, to: pos + 1 + i + before.length };
    return false;
  });
  return found;
}

/**
 * Does this range still read as the words the mark was placed on? The staleness
 * rule for the decoration plugin: edit the text under a mark and the mark goes,
 * because it is pointing at something that no longer exists.
 */
export function readsAs(doc: PMNode, range: Range, before: string): boolean {
  if (range.to > doc.content.size) return false;
  return doc.textBetween(range.from, range.to, undefined, LEAF) === before;
}
