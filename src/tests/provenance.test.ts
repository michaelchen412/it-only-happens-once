// The quote matrix, executable. Every row of the table in
// docs/plans/archive/17a-quote-matrix.md is a case here, in the same order and with the
// same numbering, so the specification and the tests can be read side by side.
//
// ⚠ This is the file that stops the rule from acquiring special cases. The
// previous model needed a hardcoded `/\d+\s*:\s*\d+/` to stop "Matthew 5:43-48"
// being mistaken for a person's name — the regex was the diagnosis, not the fix.
// Under this rule a locator can never be mistaken for a name, because a locator
// is never stored where a name goes. Rows 3, 4, 5, 8, 10 and 13 are six
// different citation traditions and none of them is detected.
import { describe, expect, it } from 'vitest';
import { deriveProvenance, mergePage, provenanceLine, SELF_NAME } from '../lib/provenance';

describe('the matrix — all fourteen ways a quote arrives', () => {
  it('1 · a book, plainly', () => {
    expect(deriveProvenance({ who: 'Seth Godin', from: 'The Practice' })).toEqual({
      line: 'Seth Godin',
      reveal: 'The Practice',
    });
  });

  it('2 · a book, by page', () => {
    expect(deriveProvenance({ who: 'Ocean Vuong', from: 'On Earth We’re Briefly Gorgeous', where: 'p. 62' })).toEqual({
      line: 'Ocean Vuong',
      reveal: 'On Earth We’re Briefly Gorgeous, p. 62',
    });
  });

  it('3 · a book with internal numbering', () => {
    expect(deriveProvenance({ who: 'Marcus Aurelius', from: 'Meditations', where: 'Book 2:2' })).toEqual({
      line: 'Marcus Aurelius',
      reveal: 'Meditations, Book 2:2',
    });
  });

  it('4 · letters — a two-level locator, in one free-text field', () => {
    expect(deriveProvenance({ who: 'Seneca', from: 'Letters to Lucilius', where: 'Letter 24:19–20' })).toEqual({
      line: 'Seneca',
      reveal: 'Letters to Lucilius, Letter 24:19–20',
    });
  });

  // The case Michael raised first: "I don't want to say the Bible because that
  // sounds awkward. I would much rather just say John 3:16." It needs no rule of
  // its own — with no author to lead with, the locator is the only thing the
  // line could be. And the work still files all the verses together.
  it('5 · scripture — the locator leads because there is no Who', () => {
    expect(deriveProvenance({ from: 'The Bible', where: 'John 3:16' })).toEqual({
      line: 'John 3:16',
      reveal: 'The Bible',
    });
  });

  it('6 · your own words — silent, but the reveal answers "who do I attribute?"', () => {
    expect(deriveProvenance({ isSelf: true })).toEqual({ line: '', reveal: SELF_NAME });
  });

  it('7 · a person, no work at all', () => {
    expect(deriveProvenance({ who: 'Ada Chen' })).toEqual({ line: 'Ada Chen', reveal: '' });
  });

  it('8 · something said to you — the circumstance is a locator too', () => {
    expect(deriveProvenance({ who: 'Ada Chen', where: 'in conversation' })).toEqual({
      line: 'Ada Chen',
      reveal: 'in conversation',
    });
  });

  it('9 · a poem — filed under the poem, not the collection', () => {
    expect(deriveProvenance({ who: 'Mary Oliver', from: 'Wild Geese' })).toEqual({
      line: 'Mary Oliver',
      reveal: 'Wild Geese',
    });
  });

  it('10 · a play', () => {
    expect(deriveProvenance({ who: 'Shakespeare', from: 'Hamlet', where: 'Act 3, sc. 1' })).toEqual({
      line: 'Shakespeare',
      reveal: 'Hamlet, Act 3, sc. 1',
    });
  });

  it('11 · an essay', () => {
    expect(deriveProvenance({ who: 'Paul Graham', from: 'How to Do Great Work' })).toEqual({
      line: 'Paul Graham',
      reveal: 'How to Do Great Work',
    });
  });

  // No Who and no Where, so the work IS the line — and the reveal would only
  // repeat it, so there is nothing to open.
  it('12 · a film, nobody to name', () => {
    expect(deriveProvenance({ from: 'Arrival' })).toEqual({ line: 'Arrival', reveal: '' });
  });

  // The hardest provenance problem in the set, and free text absorbs it with no
  // new field and no new decision. A structured locator could not.
  it('13 · a quote of a quote', () => {
    expect(
      deriveProvenance({
        who: 'Epicurus',
        from: 'Letters to Lucilius',
        where: 'quoted in Seneca, Letter 24:19–20',
      }),
    ).toEqual({
      line: 'Epicurus',
      reveal: 'Letters to Lucilius, quoted in Seneca, Letter 24:19–20',
    });
  });

  it('14 · anonymous — silence, and no control to open', () => {
    expect(deriveProvenance({})).toEqual({ line: '', reveal: '' });
  });
});

// Rows 6 and 14 produce the same line and mean opposite things. THIS is the
// whole reason `is_self` is a stored column rather than an inference from a
// blank field, and it is the precise answer to Michael's "how does the UI know
// to list it or not?" — you told it, by picking Me. Blank is not Me.
describe('the two silences', () => {
  it('are identical on the line', () => {
    expect(provenanceLine({ isSelf: true })).toBe('');
    expect(provenanceLine({})).toBe('');
  });

  it('and opposite behind it', () => {
    expect(deriveProvenance({ isSelf: true }).reveal).toBe(SELF_NAME);
    expect(deriveProvenance({}).reveal).toBe('');
  });

  // Me is not an author, so a Who alongside it would be a contradiction. If one
  // ever arrives, silence wins: `is_self` was set deliberately and a stale
  // author_id is the likelier accident.
  it('self-authorship outranks a stray author', () => {
    expect(deriveProvenance({ isSelf: true, who: 'Seneca', from: 'Letters' })).toEqual({
      line: '',
      reveal: SELF_NAME,
    });
  });
});

describe('the edges', () => {
  it('treats whitespace as absence', () => {
    expect(deriveProvenance({ who: '  ', from: '\t', where: '\n' })).toEqual({ line: '', reveal: '' });
  });

  it('tolerates nulls from the database', () => {
    expect(deriveProvenance({ who: null, from: null, where: null, isSelf: null })).toEqual({
      line: '',
      reveal: '',
    });
  });

  // Spending a field on the line is tracked by FIELD, not by value — otherwise a
  // work whose title equalled its locator would delete both and reveal nothing.
  it('does not lose a fact just because two of them read the same', () => {
    expect(deriveProvenance({ from: 'Ecclesiastes', where: 'Ecclesiastes' })).toEqual({
      line: 'Ecclesiastes',
      reveal: 'Ecclesiastes',
    });
  });
});

// Michael's call (17a, decision 6): keep both rather than choose. His Seneca row
// carries a letter reference AND a page, and dropping either loses real
// information he took the trouble to record.
describe('mergePage', () => {
  it('appends to an existing locator', () => {
    expect(mergePage('Letter 2:3', 19)).toBe('Letter 2:3, p. 19');
  });
  it('stands alone when there is no other locator', () => {
    expect(mergePage(null, 62)).toBe('p. 62');
  });
  it('leaves the locator untouched when there is no page', () => {
    expect(mergePage('Book 8:22a', null)).toBe('Book 8:22a');
  });
  it('reads a page that arrived from JSON as a string', () => {
    expect(mergePage('', '175')).toBe('p. 175');
  });
  it('is empty when there is neither', () => {
    expect(mergePage(null, undefined)).toBe('');
  });
});
