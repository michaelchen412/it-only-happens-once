// `src/lib/slug.ts` turns a title into a fragment's URL identity, and it had no
// unit test. Added 2026-08-07 during a quality audit.
//
// It is worth pinning because a slug is a PROMISE: once a piece is published,
// `/blog/<slug>` is a link somebody may have saved. A change here that quietly
// alters the output for existing titles breaks those links without breaking a
// build. Uniqueness is enforced separately, at save time — see `uniqueSlug` in
// src/tests/actions-shared.test.ts.
import { describe, it, expect } from 'vitest';
import { slugify } from '../lib/slug';

describe('slugify', () => {
  it('lowercases and joins words with a single hyphen', () => {
    expect(slugify('Forgiveness Is Not Forgetting')).toBe('forgiveness-is-not-forgetting');
  });

  it("does not turn don't into don-t", () => {
    // Both apostrophes, because a title typed in a word processor carries the
    // curly one and a title typed in a terminal carries the straight one.
    expect(slugify("Don't Look Back")).toBe('dont-look-back');
    expect(slugify('Don’t Look Back')).toBe('dont-look-back');
  });

  it('folds accents to their base letters rather than dropping the word', () => {
    // Without the NFKD pass these become empty separators and "café" vanishes.
    expect(slugify('Café Society')).toBe('cafe-society');
    expect(slugify('naïve résumé')).toBe('naive-resume');
  });

  it('collapses runs of punctuation and whitespace into one separator', () => {
    expect(slugify('one   two')).toBe('one-two');
    expect(slugify('one -- two')).toBe('one-two');
    expect(slugify('what?! really...')).toBe('what-really');
  });

  it('never leads or trails with a separator', () => {
    expect(slugify('  hello  ')).toBe('hello');
    expect(slugify('!!!hello!!!')).toBe('hello');
    expect(slugify('— a dash to open')).toBe('a-dash-to-open');
  });

  it('returns empty for text with nothing sluggable in it', () => {
    // The caller decides what to do with this; `uniqueSlug` turns it into
    // "untitled" rather than letting an empty URL through.
    expect(slugify('')).toBe('');
    expect(slugify('!!!')).toBe('');
    expect(slugify('日本語')).toBe('');
  });

  it('caps the length, and the cap is applied last', () => {
    const long = slugify('word '.repeat(60));
    expect(long.length).toBeLessThanOrEqual(80);
  });

  it('keeps digits, which titles genuinely use', () => {
    expect(slugify('Notes on 1984')).toBe('notes-on-1984');
  });

  it('is idempotent — slugifying a slug changes nothing', () => {
    // Re-saving a piece runs its stored slug through here again in some paths;
    // if this ever stops holding, a slug would walk on every save.
    for (const t of ['Forgiveness Is Not Forgetting', "Don't Look Back", 'Café Society', 'Notes on 1984']) {
      const once = slugify(t);
      expect(slugify(once)).toBe(once);
    }
  });
});
