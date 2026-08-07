// The locator (docs/plans/22 · Piece 3). This is the one piece of that plan
// whose bugs are invisible to review, to the compiler and to a screenshot: an
// off-by-N position puts a confident underline on the wrong word, and everything
// still renders.
//
// ⚠ NO `new Editor(…)` ANYWHERE HERE. vitest runs `environment: 'node'`, so
// there is no DOM to mount one into. `getSchema` and `Node.fromJSON` are pure,
// which is the whole reason `proofread-locate.ts` takes a `Node` rather than an
// editor.
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Node } from '@tiptap/pm/model';
import { blockTexts, countInDoc, documentText, locate, readsAs } from '../scripts/proofread-locate';

// Matches the composer's own extensions (rich-editor.ts), including
// `inline: false` — which is exactly why images cannot shift inline positions.
const schema = getSchema([StarterKit, Image.configure({ inline: false, allowBase64: false })]);

const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string) => ({ type: 'text', text: t });
const br = { type: 'hardBreak' };
const img = { type: 'image', attrs: { src: 'https://example.com/a.png', alt: '' } };

const build = (content: unknown[]) => Node.fromJSON(schema, { type: 'doc', content });

/**
 * THE FIXTURE THAT MATTERS: a typo sitting after an image block AND after a hard
 * break, so both of the things that could shift a position are upstream of it.
 */
const doc = build([
  p(text('She opened the door.')),
  img,
  p(text('first line'), br, text('the way that thier hands moved')),
]);

describe('the position of a fix', () => {
  it('finds a span that sits after both an image and a hard break', () => {
    const range = locate(doc, 'thier');
    expect(range).not.toBeNull();
    // Self-proving: slice the document at the range the locator returned and it
    // has to read as the word we asked for. This is the assertion that fails
    // when a leaf silently costs zero characters instead of one.
    expect(doc.textBetween(range!.from, range!.to)).toBe('thier');
  });

  it('is still right when the leaf is the only thing between block start and typo', () => {
    const d = build([p(text('a'), br, text('thier'))]);
    const range = locate(d, 'thier')!;
    expect(d.textBetween(range.from, range.to)).toBe('thier');
  });

  it('counts a hard break as exactly one character', () => {
    // 'a' + break + 'thier' → the break occupies one position, so the typo
    // starts two characters into the block's inline content.
    const d = build([p(text('a'), br, text('thier'))]);
    expect(blockTexts(d)).toEqual(['a\nthier']);
    expect(locate(d, 'thier')!.from).toBe(3); // block at 0, inline starts at 1
  });

  it('skips image blocks rather than counting them', () => {
    // Same paragraph, with and without an image block above it: identical text,
    // and the position shifts only by the image's own two positions — which is
    // what a block costs and has nothing to do with the inline arithmetic.
    const withImg = build([img, p(text('thier'))]);
    const range = locate(withImg, 'thier')!;
    expect(withImg.textBetween(range.from, range.to)).toBe('thier');
    expect(blockTexts(withImg)).toEqual(['thier']);
  });

  it('returns the FIRST match, not the last', () => {
    // The `found` guard. `return false` declines to descend; it does not stop
    // the walk, so without it the second block would overwrite the first.
    const d = build([p(text('thier one')), p(text('thier two'))]);
    const range = locate(d, 'thier')!;
    expect(range.from).toBeLessThan(10);
    expect(d.textBetween(range.from, range.to + 4)).toBe('thier one');
  });

  it('returns null for a span that is not there', () => {
    expect(locate(doc, 'nonexistent')).toBeNull();
  });
});

describe('how many times it is findable', () => {
  it('counts zero, one and two', () => {
    expect(countInDoc(doc, 'nope')).toBe(0);
    expect(countInDoc(doc, 'thier')).toBe(1);
    expect(countInDoc(build([p(text('thier')), p(text('thier'))]), 'thier')).toBe(2);
  });

  it('counts a span crossing a block boundary as zero', () => {
    // Not locatable, so not a fix that can be honoured — the client drops it
    // rather than marking something approximate.
    const d = build([p(text('the end')), p(text('and then'))]);
    expect(countInDoc(d, 'end\n\nand')).toBe(0);
  });
});

describe('the text that gets sent', () => {
  it('renders a hard break as one newline and joins blocks with two', () => {
    expect(documentText(doc)).toBe('She opened the door.\n\nfirst line\nthe way that thier hands moved');
  });

  it('is the same rendering the locator searches', () => {
    // The invariant the whole design rests on: anything the model can quote back
    // out of what we sent is either findable, or excluded by the block-boundary
    // rule above. Two alphabets is how a fix becomes unlocatable.
    for (const block of blockTexts(doc)) {
      expect(documentText(doc)).toContain(block);
    }
  });
});

describe('staleness', () => {
  it('still reads as itself before an edit, and not after', () => {
    const range = locate(doc, 'thier')!;
    expect(readsAs(doc, range, 'thier')).toBe(true);

    // Type a word in the paragraph ABOVE the mark: the range is now pointing at
    // different characters, which is exactly when a mark must drop itself.
    const edited = build([
      p(text('She opened the front door.')),
      img,
      p(text('first line'), br, text('the way that thier hands moved')),
    ]);
    expect(readsAs(edited, range, 'thier')).toBe(false);
  });

  it('does not read past the end of a shrunken document', () => {
    const range = locate(doc, 'thier')!;
    expect(readsAs(build([p(text('short'))]), range, 'thier')).toBe(false);
  });
});
