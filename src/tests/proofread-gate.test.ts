// The exact-once gate (docs/plans/22 · Piece 2) — the five lines between "the
// model said so" and "we are willing to underline it".
//
// Two jobs, and they are separate: a hallucinated quote dies here because it
// isn't in the text at all, and an ambiguous one dies because "which of the two"
// has no answer a locator could give.
import { describe, expect, it } from 'vitest';
import { keepLocatable, type Fix } from '../lib/proofread';

const fix = (over: Partial<Fix> = {}): Fix => ({
  where: 'body',
  before: 'thier',
  after: 'their',
  kind: 'typo',
  ...over,
});

describe('the exact-once gate', () => {
  const body = 'the way that thier hands moved';

  it('keeps a fix that appears exactly once', () => {
    expect(keepLocatable([fix()], '', body)).toHaveLength(1);
  });

  it('drops a fix that appears nowhere — the hallucination case', () => {
    expect(keepLocatable([fix({ before: 'nevermind' })], '', body)).toHaveLength(0);
  });

  it('drops a fix that appears twice — the ambiguous case', () => {
    expect(keepLocatable([fix()], '', 'thier hands and thier feet')).toHaveLength(0);
  });

  it('checks each fix against the field it claims to be from', () => {
    // The word is in the body and NOT in the title, so a fix claiming the title
    // is wrong about where it is — and a title fix routed to the body's marks
    // would be an underline on an unrelated word.
    expect(keepLocatable([fix({ where: 'title' })], 'A quiet morning', body)).toHaveLength(0);
    expect(keepLocatable([fix({ where: 'title' })], 'thier morning', body)).toHaveLength(1);
  });

  it('drops a no-op', () => {
    expect(keepLocatable([fix({ after: 'thier' })], '', body)).toHaveLength(0);
    expect(keepLocatable([fix({ before: '' })], '', body)).toHaveLength(0);
  });

  it('counts occurrences without overlapping', () => {
    // 'aa' in 'aaa' is one non-overlapping match plus a leftover, not two — so
    // this stays locatable rather than being dropped as ambiguous.
    expect(keepLocatable([fix({ before: 'aa', after: 'ab' })], '', 'aaa')).toHaveLength(1);
  });
});
