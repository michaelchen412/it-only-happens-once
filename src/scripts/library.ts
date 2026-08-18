import { actions } from 'astro:actions';
import { confirmDialog } from './confirm-dialog';
import { submitAction } from './action-error';
import { deleteWarning } from '../lib/library-delete';
import { closeWithExit, openDialog } from './dialog-close';
import { wireSheetDismiss } from './sheet-dismiss';
import { wireFilterFields } from './filter-field';

const A: Record<string, any> = {
  subject: actions.subjects,
  author: actions.authors,
  work: actions.works,
};

const err = document.getElementById('lib-error') as HTMLParagraphElement;
const showErr = (m: string) => {
  err.textContent = m;
  err.hidden = false;
  err.scrollIntoView({ block: 'nearest' });
};

/* ⚠ THIS PAGE PUTS ~100 LIVE `<input>`s ON SCREEN AT ONCE and every write
   below ends in `location.reload()`. Until 2026-08-12 that meant: correct
   three subject definitions, press Save on the first, and the other two were
   gone — nothing asked, nothing said. [ADR
   0032](../../../docs/adr/0032-a-sheet-is-dismissible-and-says-what-that-costs.md)
   closed exactly this class across nine dialogs (*"one stray click silently
   destroys everything typed into the sheet"*) and never reached the in-page
   edit surfaces; this room holds more editable state at once than any sheet
   in the building.

   ONE DELEGATED LISTENER, NOT `dirtyTracker` PER ROW. That helper answers
   "is this root dirty" with a boolean, and the question here is "WHICH of a
   hundred rows are dirty" — a Map of a hundred trackers to answer what one
   listener and an attribute answer. `data-dirty` is also readable from the
   elements panel, which matters in the one room that has no other state.

   ⚠ `[data-field]` ONLY, AND THAT IS NOT A DETAIL. The other control in a
   row is the merge `<select>`, which fires `change` on arrow-key — the same
   fault §1.2 is about — and it is not an edit to anything Save submits. Mark
   on it and tabbing past three rows would report three rows of "unsaved
   edits" that do not exist, which teaches you to click through the guard.
   The set that can be dirty is exactly the set `.lib-save` puts in the
   FormData below: `[data-field]`. */
const markDirty = (e: Event) => {
  const el = (e.target as Element)?.closest?.('[data-field]');
  el?.closest('.lib-row')?.setAttribute('data-dirty', '');
};
document.addEventListener('input', markDirty);
document.addEventListener('change', markDirty);

/* ⚠ THE GUARD ASKS AFTER THE WRITE, NOT BEFORE IT, AND THAT ORDER IS THE
   WHOLE DESIGN. Asking first can only ever inform you — whichever row you
   then save still reloads the page and still discards the rest, so a
   warn-before is a dialog that makes you choose which two edits to lose.
   Asking after means the save has already landed and refusing only DEFERS
   the refresh: save one, keep editing, save the next, keep editing, and the
   last one (nothing else dirty) refreshes for you. All three survive.

   ⚠ THE RELOAD ITSELF IS NOT THE BUG AND MUST NOT BE "FIXED". A rename
   changes the row and every "Merge into…" menu at once, so the refresh is
   what keeps them honest. What was missing was the guard, not the refresh.

   THE ALTERNATIVE THAT LOST IS SAVE-ALL — one Save writing every dirty row.
   It is friendlier and it is probably where this ends up, but it changes
   what a per-row button on a hundred-row page MEANS, and `library.spec.ts`
   pins the current meaning (fill one field, press that row's Save, expect
   that row's write). Warn is one predicate and closes the data loss today;
   save-all is a shape decision and Michael's to take. */
async function reloadUnless(mine: HTMLElement) {
  const others = [...document.querySelectorAll<HTMLElement>('.lib-row[data-dirty]')].filter((r) => r !== mine);
  if (others.length) {
    const ok = await confirmDialog({
      title: 'Saved',
      message:
        others.length === 1
          ? 'One other row has edits you haven’t saved. Refreshing the table now would discard them — cancel to keep editing and save that row too.'
          : `${others.length} other rows have edits you haven’t saved. Refreshing the table now would discard them — cancel to keep editing and save those rows too.`,
      confirmLabel: 'Refresh anyway',
      danger: true,
    });
    if (!ok) return;
  }
  location.reload();
}

document.querySelectorAll<HTMLElement>('.lib-row').forEach((row) => {
  const entity = row.dataset.entity!;
  const id = row.dataset.id!;
  const api = A[entity];

  /* ⚠ `submitAction`, NOT A BARE AWAIT — and the reason this file went four
     years' worth of audits without it is written into
     `src/tests/action-guard.test.ts:21-24`, which names its own blind spots.
     The first is "an action awaited through an alias", and `A[entity]` above
     is precisely that: the tripwire matches the literal TEXT of a direct
     `actions.x.y()` await, so `await api.update(fd)` is invisible to it and
     `verify` stayed green.

     ⚠ AND DO NOT SPELL THAT PATTERN OUT IN PROSE HERE. This comment quoted
     it verbatim on the first draft and `action-guard.test.ts` went red on
     its own explanation — its line filter only skips a line that BEGINS
     with a comment marker, and the wrapped body of a block comment does
     not. `src/tests/` is excluded from the walk for exactly this reason;
     nothing else is.

     What was actually happening: `astro:actions` THROWS on a dead network
     rather than returning `{ error }`, so the rejection skipped the
     re-enable one line down and this row's Save stayed disabled for the life
     of the page with nothing on screen. Same class
     [25](docs/plans/archive/25-the-save-survives.md) closed everywhere else,
     and the helper was already imported into this file. The paste reached the
     new handler and not the three old ones.

     ⚠ DO NOT DELETE THESE AS REDUNDANT. `action-guard.test.ts` will stay
     green if you do; it cannot see this file. */
  row.querySelector('.lib-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const fd = new FormData();
    fd.set('id', id);
    row
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]')
      .forEach((el) => fd.set(el.dataset.field!, el.value));
    const res = await submitAction(() => api.update(fd), { button: btn, onError: showErr });
    if (res.ok) await reloadUnless(row);
  });

  row.querySelector('.lib-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete',
      // The counts are rendered onto the row above; this reads them back
      // rather than re-querying, so the number in the dialog is exactly the
      // number in the "Used" column beside the button you pressed.
      message: deleteWarning({
        entity: row.dataset.entity as 'subject' | 'author' | 'work',
        name: row.dataset.name,
        uses: Number(row.dataset.uses ?? 0),
        shelves: Number(row.dataset.shelves ?? 0),
        shelfNotes: Number(row.dataset.shelfNotes ?? 0),
        ownNote: !!row.dataset.ownNote,
      }),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('id', id);
    // `submitAction` for the same reason as Save above — the alias hides
    // this await from the tripwire, and a delete that silently does nothing
    // after you have answered a destructive confirm is the worst of the
    // three to leave unguarded.
    const res = await submitAction(() => api.remove(fd), {
      button: row.querySelector<HTMLButtonElement>('.lib-delete'),
      onError: showErr,
    });
    if (res.ok) await reloadUnless(row);
  });
});

/* ══ MERGE — a BUTTON and a picker, not a `<select>` (plan 38 · §1.2) ═══════
   ⚠ THE OLD CONTROL FIRED ON ARROW-KEY. The merge hung on a `<select>`'s
   `change` event, so tabbing to "Merge into…" and pressing ↓ changed the value,
   fired `change`, and opened a confirm proposing to merge the row you were
   standing on into the first alphabetical entity. Merge reassigns every link and
   HARD-DELETES the loser; the dialog's own words are "This can't be undone."
   The decline path reset the value so it recovered, but a `<select>` is a value
   control and this is an action. A button cannot be triggered by an arrow key.

   ⚠ AND THE CONFIRM NAMES BOTH SIDES NOW, which the old one could not: it said
   "Move everything onto the target and delete this one?" without ever saying
   WHICH target, because the value was read straight off the select and no name
   was ever in hand — on the one action here that cannot be undone.

   ⚠ ONE PAYLOAD, NOT ONE LIST PER ROW. Every row used to render every OTHER row
   as an `<option>` — 11,309 elements, 86% of this page's DOM by plan 19's count,
   and O(n²) in the size of a vocabulary. The dialog reads one JSON blob per
   vocabulary, so the same list serves every row and the cost is linear. Three
   plans wanted this control replaced; it waited for `VocabTable` so it could be
   built once instead of four times. */
const mergeOptions: Record<string, { id: string; name: string }[]> = JSON.parse(
  document.getElementById('merge-options')?.textContent || '{}',
);
const mergeDialog = document.getElementById('merge-dialog') as HTMLDialogElement | null;
const mergeQ = document.getElementById('merge-q') as HTMLInputElement | null;
const mergeList = document.getElementById('merge-list');
const mergeLede = document.getElementById('merge-lede');
const mergeEmpty = document.getElementById('merge-empty');

if (mergeDialog && mergeQ && mergeList && mergeLede && mergeEmpty) {
  let source: { entity: string; id: string; name: string } | null = null;

  const paint = () => {
    if (!source) return;
    const self = source;
    const q = mergeQ.value.trim().toLowerCase();
    const all = (mergeOptions[self.entity] ?? []).filter((o) => o.id !== self.id);
    const hits = q ? all.filter((o) => o.name.toLowerCase().includes(q)) : all;
    mergeEmpty.hidden = hits.length > 0;
    mergeList.replaceChildren(
      ...hits.map((o) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'hover:bg-base-200 w-full rounded px-2 py-1.5 text-left';
        b.textContent = o.name;
        b.dataset.target = o.id;
        b.dataset.targetName = o.name;
        li.append(b);
        return li;
      }),
    );
  };

  document.querySelectorAll<HTMLElement>('[data-lib-merge]').forEach((btn) =>
    btn.addEventListener('click', () => {
      source = { entity: btn.dataset.entity!, id: btn.dataset.id!, name: btn.dataset.name ?? 'this one' };
      mergeLede.textContent = `Everything filed under \u201c${source.name}\u201d moves onto the word you pick, and \u201c${source.name}\u201d is deleted.`;
      mergeQ.value = '';
      paint();
      openDialog(mergeDialog);
      mergeQ.focus();
    }),
  );

  mergeQ.addEventListener('input', paint);

  /* All three exits through one door (ADR 0032), and the tripwire in
     `sheet-dismiss.test.ts` is what caught this being missed — the first draft
     wired the ✕ by hand and left Escape half-native and the backdrop dead.

     ⚠ NO GUARD, AND THAT IS THE POINT OF THE ADR RATHER THAN AN EXEMPTION FROM
     IT. The rule is that a sheet must ANSWER what dismissal costs, and here it
     costs nothing: this picker holds no pending state — a search string that
     exists to be thrown away, and a pick that does not commit anything on its
     own (it opens a confirm, which owns the destructive half). So all three
     gestures close it outright, with nothing asked. */
  wireSheetDismiss(mergeDialog, () => void closeWithExit(mergeDialog), '[data-merge-close]');

  mergeList.addEventListener('click', async (e) => {
    const hit = (e.target as Element).closest<HTMLButtonElement>('[data-target]');
    if (!hit || !source) return;
    const from = source;
    const into = hit.dataset.target!;
    const intoName = hit.dataset.targetName ?? 'it';
    await closeWithExit(mergeDialog);
    const ok = await confirmDialog({
      title: 'Merge',
      message: `Move everything from \u201c${from.name}\u201d onto \u201c${intoName}\u201d and delete \u201c${from.name}\u201d? This can\u2019t be undone.`,
      confirmLabel: 'Merge',
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('from', from.id);
    fd.set('into', into);
    const res = await submitAction(() => A[from.entity].merge(fd), { onError: showErr });
    const row = document.querySelector<HTMLElement>(`.lib-row[data-id="${from.id}"]`);
    if (res.ok && row) await reloadUnless(row);
  });
}

// ⚠ WIRED LAST, AND IT MUST SURVIVE THE RELOAD ABOVE. Every per-row Save on this
// page ends in `reloadUnless(row)` — a navigation, and ADR 0036 says that is
// correct. So on the one page whose purpose is *filter to the duplicate, then
// groom it*, the browser restores the query text across that reload while
// `input` never fires again. `wireFilterField` re-applies from the field's own
// value precisely so the filter you were working in is still there afterwards.
wireFilterFields();
