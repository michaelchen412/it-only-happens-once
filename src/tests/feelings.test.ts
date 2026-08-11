// The vocabulary of feelings (plan 33 §1, ruling 6).
//
// ⚠ WHY THREE PURE FUNCTIONS EARN A TEST FILE. Two of them only build strings —
// but one of those strings is the sole thing standing between a rename and a
// silently duplicated shelf, and the rule it explains is invisible everywhere
// else: a feeling's slug is FROZEN while its name is not, so a feeling can go on
// owning a link nobody can see it holding. Every other vocabulary in this repo
// resolves that collision by suffixing (`uniqueSlug`), and doing the same here
// would be a bug rather than a convenience. This file is where that difference
// is written down as an executable claim.
import { describe, expect, it } from 'vitest';
import { SORT_STEP, duplicateNameMessage, nextSort, slugTakenMessage } from '../lib/feelings';

describe('where a new word lands in the spectrum', () => {
  it('the first word starts the scale rather than sitting at zero', () => {
    // Zero would leave nowhere to insert something darker later, which is the
    // one direction the scale is guaranteed to need: `grieving` is the current
    // floor and it is not a claim that nothing is darker.
    expect(nextSort([])).toBe(SORT_STEP);
  });

  it('leaves a gap, so a word can be placed BETWEEN two others without renumbering', () => {
    // The gap is the whole reason `sort` is not a 1..n index. §6a: the moment
    // adding a word requires housekeeping is the moment it stops happening
    // mid-listen — and it would stop on exactly the songs that matter most,
    // the ones whose feeling is not in the list yet.
    expect(nextSort([10, 20, 30])).toBe(40);
    expect(nextSort([10, 20, 30]) - 30).toBeGreaterThan(1);
  });

  it('⚠ appends past the HIGHEST sort, not past the count', () => {
    // The bug this pins: `rows.length * 10` looks equivalent and is not. After a
    // single delete or merge the count falls behind the scale, so the "new" word
    // would be minted with a sort a living word already holds — two words at one
    // position, ordered by whatever the database felt like returning first.
    expect(nextSort([10, 300, 20])).toBe(310);
  });

  it('survives a scale that was hand-edited into non-contiguity', () => {
    // The Library exposes `sort` as a plain number field, so 7 and 41 are
    // reachable states and neither is wrong.
    expect(nextSort([7, 41])).toBe(51);
  });
});

describe('the two refusals, which are the only place the frozen slug is visible', () => {
  it('a duplicate name says which word is already there', () => {
    // Named rather than "that already exists": the match is case-insensitive, so
    // typing `Tender` when `tender` exists must not read like a bug in the form.
    expect(duplicateNameMessage('Tender')).toBe('There is already a feeling called Tender.');
  });

  it('trims, so a trailing space cannot produce a sentence with a hole in it', () => {
    expect(duplicateNameMessage('  hopeful ')).toBe('There is already a feeling called hopeful.');
  });

  it('⚠ the slug collision names BOTH the link and the row still holding it', () => {
    // The case name-uniqueness cannot catch. Rename `regretful` → `remorseful`
    // and nothing is NAMED regretful any more, so a brand-new `regretful` passes
    // the name check and then collides on a slug that appears nowhere in the
    // interface. "That name is taken" would be a lie about a name nothing is
    // using, so the sentence has to carry the address AND the current owner —
    // otherwise there is no way to find the row you are being refused by.
    const msg = slugTakenMessage('remorseful', 'regretful');
    expect(msg).toContain('regretful');
    expect(msg).toContain('remorseful');
    expect(msg).toMatch(/merge/i);
  });

  it('⚠ never offers a numbered twin as the way out', () => {
    // `uniqueSlug` — what subjects, authors and works do — would resolve this by
    // minting `regretful-2`. That is right for an address and wrong for a word
    // in a shared spectrum: it is a second invisible shelf with the same name on
    // the front, which is the drift §1 says kills a taxonomy, arriving through
    // the door built to prevent it.
    expect(slugTakenMessage('remorseful', 'regretful')).not.toMatch(/-2\b/);
  });
});
