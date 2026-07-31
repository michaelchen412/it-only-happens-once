// `src/lib/reading.ts` exists to stop two surfaces disagreeing about how long a
// piece is: the public read time (from stored Markdown) and the composer's live
// gauge (from TipTap's plain text, in the browser). They can only stay in step
// while both go through this arithmetic, so these tests pin the arithmetic AND
// the property that matters — that `readingMinutes` still routes through it.
import { describe, it, expect } from 'vitest';
import { countWords, minutesForWords, WORDS_PER_MINUTE } from '../lib/reading';
import { readingMinutes } from '../lib/markdown';

describe('countWords', () => {
  it('counts on any whitespace, and nothing is 0', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('one\ntwo\t three')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(countWords('   \n  ')).toBe(0);
  });

  it('ignores leading and trailing whitespace rather than counting it as a word', () => {
    expect(countWords('  hello  ')).toBe(1);
  });
});

describe('minutesForWords', () => {
  it('never returns less than 1 — "0 min read" is a stranger claim', () => {
    expect(minutesForWords(0)).toBe(1);
    expect(minutesForWords(5)).toBe(1);
  });

  it('rounds to the nearest minute at the shared rate', () => {
    expect(minutesForWords(WORDS_PER_MINUTE)).toBe(1);
    expect(minutesForWords(WORDS_PER_MINUTE * 6)).toBe(6);
    expect(minutesForWords(WORDS_PER_MINUTE * 2 + 100)).toBe(2); // rounds down
  });
});

describe('readingMinutes — the public side agrees with the composer', () => {
  it('is the same answer as counting the plain text by hand', () => {
    const body = Array.from({ length: 660 }, (_, i) => `word${i}`).join(' ');
    expect(readingMinutes(body)).toBe(3);
    expect(readingMinutes(body)).toBe(minutesForWords(countWords(body)));
  });

  it('does not count Markdown syntax as words', () => {
    // Formatting marks, a link target and a heading hash must not inflate it.
    expect(readingMinutes('## A [link](https://example.com) and *stress*')).toBe(1);
  });

  it('still returns 1 for nothing at all', () => {
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes(null)).toBe(1);
    expect(readingMinutes(undefined)).toBe(1);
  });
});
