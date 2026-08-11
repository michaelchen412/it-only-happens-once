// What deleting a subject, author or work actually takes — as a sentence
// (docs/plans/30 · §6a).
//
// ⚠ THE OLD SENTENCE WAS TRUE AND STILL MISLED. *"Fragments themselves stay —
// only this label and its links are removed"* is accurate about all three
// entities; what it never said is that one of a WORK's links is somebody's
// shelf, and that the note written on that shelf goes with it by cascade. Plan
// 26 stopped `works.merge` doing that silently. `works.remove` still does it,
// and should — that is what a delete MEANS — so the fix is a sentence rather
// than a behaviour change.
//
// ⚠ REFUSING THE DELETE IS THE ALTERNATIVE THAT LOSES, and it is named here so
// nobody "improves" this later: a curation tool that will not let you remove a
// duplicate work because somebody once shelved it is a puzzle, not a tool. Say
// the number and let the person decide. That is also why the counts LEAD and
// the reassurance follows — a warning that opens by reassuring you is a warning
// you have already stopped reading.
//
// Pure and client-imported, so `/admin/library`'s inline script stays a wiring
// layer and the wording is reachable from a test.

export interface DeleteCost {
  entity: 'subject' | 'author' | 'work' | 'feeling';
  /** Shown in quotes so the dialog names the row you actually clicked. */
  name?: string;
  /** Live fragments tagged with / naming / citing it. */
  uses: number;
  /** `person_works` rows — works only. */
  shelves: number;
  /** How many of those shelf links carry a note — works only. */
  shelfNotes: number;
  /** The author's own `note` column — authors only. */
  ownNote: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function deleteWarning(c: DeleteCost): string {
  const costs: string[] = [];

  if (c.uses) {
    costs.push(
      c.entity === 'subject'
        ? `${plural(c.uses, 'fragment is', 'fragments are')} tagged with this`
        : c.entity === 'author'
          ? `${plural(c.uses, 'fragment names', 'fragments name')} this author`
          : // ⚠ A FEELING'S COUNT IS THE ONE THAT CANNOT BE RE-DERIVED. A subject
            // can be re-tagged from the text and a citation re-read off the page;
            // what a song did to somebody on a particular evening cannot be
            // recovered from anything but memory, and plan 33 ruling 1 forbids a
            // model guessing at it. So the sentence says *filed under* — the
            // shelf language the room is built in — and merge is the exit that
            // keeps the links.
            c.entity === 'feeling'
            ? `${plural(c.uses, 'song is', 'songs are')} filed under this`
            : `${plural(c.uses, 'fragment cites', 'fragments cite')} this work`,
    );
  }

  // ⚠ THE NOTES ARE COUNTED APART FROM THE LINKS, because only one of them is
  // recoverable. A shelf link is re-added from a profile in ten seconds; the
  // sentence somebody wrote about why that book is on that shelf is not.
  if (c.shelves) {
    costs.push(
      `${plural(c.shelves, 'person has', 'people have')} it on a shelf` +
        (c.shelfNotes ? `, ${c.shelfNotes === 1 ? 'one with a note' : `${c.shelfNotes} with notes`}` : ''),
    );
  }

  if (c.entity === 'author' && c.ownNote) costs.push('the note on it will go too');

  const subject = c.name?.trim() ? `Delete “${c.name.trim()}”?` : 'Delete this?';
  // The reassurance has to change when it stops being the whole truth.
  const tail = c.shelfNotes
    ? 'The fragments and the shelves’ owners stay; the label, its links and those notes are removed.'
    : 'Fragments themselves stay — only this label and its links are removed.';

  return costs.length ? `${subject} ${costs.join('; ')}. ${tail}` : `${subject} ${tail}`;
}
