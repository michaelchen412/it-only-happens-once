// The confirm dialog's sentence (plans/30 · §6a).
//
// ⚠ WHY A PURE MODULE HAS A TEST AT ALL WHEN IT ONLY BUILDS A STRING: this
// string is the ONLY thing standing between pressing Delete and a shelf note
// somebody wrote disappearing by cascade. Plan 26 fixed the merge's version of
// that by changing behaviour; this one is fixed by changing what the dialog
// says, so the wording IS the feature and a silent regression in it is a silent
// regression in the fix.
import { describe, expect, it } from 'vitest';
import { deleteWarning } from '../lib/library-delete';

const base = { uses: 0, shelves: 0, shelfNotes: 0, ownNote: false };

describe('deleteWarning', () => {
  it('an unused label says only the reassuring half', () => {
    // Nothing is at stake, so nothing is claimed. A dialog that recites zeroes
    // teaches you to click through dialogs.
    expect(deleteWarning({ ...base, entity: 'subject', name: 'Grief' })).toBe(
      'Delete “Grief”? Fragments themselves stay — only this label and its links are removed.',
    );
  });

  it('⚠ names the shelves AND the notes on them — the sentence §6a exists for', () => {
    // The case the old copy was quiet about: `works.remove` cascades
    // `person_works`, and the note written on that link goes with it.
    expect(deleteWarning({ ...base, entity: 'work', name: 'Piranesi', uses: 12, shelves: 2, shelfNotes: 1 })).toBe(
      'Delete “Piranesi”? 12 fragments cite this work; 2 people have it on a shelf, one with a note. ' +
        'The fragments and the shelves’ owners stay; the label, its links and those notes are removed.',
    );
  });

  it('⚠ the reassurance CHANGES when it stops being the whole truth', () => {
    // With notes at stake, "only this label and its links are removed" is the
    // misleading half of the original sentence, so it must not be the tail.
    const withNotes = deleteWarning({ ...base, entity: 'work', shelves: 1, shelfNotes: 1 });
    const withoutNotes = deleteWarning({ ...base, entity: 'work', shelves: 1, shelfNotes: 0 });

    expect(withNotes).toContain('those notes are removed');
    expect(withNotes).not.toContain('only this label and its links');
    expect(withoutNotes).toContain('only this label and its links');
  });

  it('a shelf with no note is still worth saying, without inventing one', () => {
    expect(deleteWarning({ ...base, entity: 'work', name: 'Piranesi', shelves: 3 })).toBe(
      'Delete “Piranesi”? 3 people have it on a shelf. ' +
        'Fragments themselves stay — only this label and its links are removed.',
    );
  });

  it('an author’s own note is counted too — it is a different column, same loss', () => {
    const msg = deleteWarning({ ...base, entity: 'author', name: 'Ocean Vuong', uses: 1, ownNote: true });
    expect(msg).toContain('1 fragment names this author');
    expect(msg).toContain('the note on it will go too');
  });

  it('singular and plural are both real sentences', () => {
    // Written out because "1 fragments cite this work" is the kind of thing
    // that survives review and then reads as carelessness at the exact moment
    // somebody is deciding whether to trust the number.
    expect(deleteWarning({ ...base, entity: 'work', uses: 1 })).toContain('1 fragment cites this work');
    expect(deleteWarning({ ...base, entity: 'work', uses: 2 })).toContain('2 fragments cite this work');
    expect(deleteWarning({ ...base, entity: 'subject', uses: 1 })).toContain('1 fragment is tagged');
    expect(deleteWarning({ ...base, entity: 'subject', uses: 2 })).toContain('2 fragments are tagged');
    expect(deleteWarning({ ...base, entity: 'author', uses: 1 })).toContain('1 fragment names');
    expect(deleteWarning({ ...base, entity: 'work', shelves: 1 })).toContain('1 person has it');
    expect(deleteWarning({ ...base, entity: 'work', shelves: 2, shelfNotes: 2 })).toContain('2 with notes');
  });

  it('falls back to “this” rather than printing an empty pair of quotes', () => {
    expect(deleteWarning({ ...base, entity: 'work', name: '  ' })).toMatch(/^Delete this\?/);
    expect(deleteWarning({ ...base, entity: 'work' })).toMatch(/^Delete this\?/);
  });
});
