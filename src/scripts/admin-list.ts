// Host logic for the Fragment Manager (src/pages/admin/fragments.astro). The
// table/toolbar mechanics live in fragment-panel.ts (shared with the composer's
// browser sheet); this file adds what's unique to the page: the bulk-action
// bar, trash actions, the Add ▾ menu, and routing row-opens to the editor
// sheets (quote/song → FragmentSheet, writing → WritingSheet).
import { actions } from 'astro:actions';
import { callAction, formatActionError } from './action-error';
import { confirmDialog } from './confirm-dialog';
import { onFragmentsChanged } from './fragments-changed';
import { wireFragmentPanel, wireAddMenu } from './fragment-panel';
import { openEditorFor } from './open-editor';

const root = document.querySelector('.fpanel') as HTMLElement;
const bulkbar = document.getElementById('bulkbar') as HTMLElement;
const bulkcount = document.getElementById('bulkcount') as HTMLElement;
const bulkError = document.getElementById('bulk-error') as HTMLParagraphElement;
const view = root.dataset.view === 'trash' ? 'trash' : 'list';

const showBulkError = (msg: string) => {
  bulkError.textContent = msg;
  bulkError.hidden = false;
};

const panel = wireFragmentPanel(root, {
  historyBase: '/admin/fragments',
  onOpen(row) {
    openEditorFor(row);
  },
  onAction(act, id, row) {
    if (act === 'restore' || act === 'purge') return void trashAction(act, id);
    // The membership cell — the same editor, opened on its Constellations tab.
    // Deliberately the SAME door for all three types rather than a lighter one
    // for quotes: you shouldn't have to know a row's type to predict what a
    // click does, and a badge that behaved differently on writing rows would
    // make the `none` chip beside it a dead label.
    if (act === 'constellations') openEditorFor(row, 'constellations');
  },
  // The selection is a CART now (see fragment-panel.ts): it survives filter
  // and search changes rather than being thrown away by them. One behaviour
  // for one component — the manager and the composer's browser sheet share
  // this panel, and a flag to make them differ would be two behaviours to keep
  // straight for no reason anybody could state.
  onSelectionChange(ids, shown) {
    bulkbar.classList.toggle('is-open', ids.length > 0);
    // ⚠ The load-bearing half. A cart that outlives its filter can hold rows
    // you cannot see, and the actions on this bar include DELETE. Saying "3
    // selected · 1 shown here" is what stops that being a trap; the confirm
    // dialog names the count for the same reason.
    bulkcount.textContent =
      shown === ids.length ? `${ids.length} selected` : `${ids.length} selected · ${shown} shown here`;
    syncRemovableConstellations(ids);
  },
  onSwap(doc) {
    // trash count + empty-trash state live outside the panel
    const tc = document.getElementById('trash-count');
    const tcSrc = doc.getElementById('trash-count');
    if (tc && tcSrc) tc.textContent = tcSrc.textContent;
    const emptyTrash = document.getElementById('empty-trash') as HTMLButtonElement | null;
    if (emptyTrash) emptyTrash.disabled = !root.querySelector('.row-check');
  },
});

// --- bulk actions (floating bar; not swapped) -------------------------------
const bulkBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-bulk]'));
bulkBtns.forEach((btn) =>
  btn.addEventListener('click', async () => {
    const op = btn.dataset.bulk as 'publish' | 'draft' | 'note' | 'trash' | 'restore' | 'purge';
    const ids = panel.getSelected();
    if (!ids.length) return;
    if ((op === 'trash' || op === 'purge') && !(await confirmBulk(op, ids.length))) return;

    bulkBtns.forEach((b) => (b.disabled = true));
    bulkError.hidden = true;
    const fd = new FormData();
    fd.set('ids', ids.join(','));
    fd.set('op', op);
    // ⚠ NOT `submitAction`, because the control here is the WHOLE BAR rather
    // than one button — six buttons go down together and have to come back
    // together. `callAction` is the half that matters: `astro:actions` throws
    // on a dead network, and that rejection used to skip the re-enable, so an
    // offline bulk op left every action on this bar dead for the rest of the
    // session with nothing on screen to say why.
    const { error } = await callAction(actions.fragments.bulk(fd));
    if (error) {
      bulkBtns.forEach((b) => (b.disabled = false));
      // `error.message` printed `Failed to fetch` at a human on exactly the
      // failure the friendly sentence was written for.
      showBulkError(formatActionError(error));
      return;
    }
    // Every op on this bar can move rows OUT of the current view — a trashed
    // fragment, a published one under a draft filter, a note under the list
    // view. Leaving them in the cart would strand a count that says "3
    // selected · 0 shown here" for the rest of the session, about three
    // fragments the op has already dealt with. The constellation menu below
    // deliberately does NOT clear: those rows stay, and adding one selection
    // to two constellations in a row is a real thing to want.
    panel.clearSelection();
    await panel.refresh();
    bulkBtns.forEach((b) => (b.disabled = false));
  }),
);

/**
 * ⚠ Names the COUNT, and does so because the selection is a cart. Before Piece
 * 4 the number on the bar was always the number of ticked boxes in front of
 * you; now it can include rows scrolled out of view under a filter you have
 * since changed. "Delete 7 fragments" is the last chance to notice that 7 is
 * not the 2 you can see — which is also why the bar carries "· n shown here".
 */
function confirmBulk(op: 'trash' | 'purge', n: number) {
  const noun = `${n} fragment${n === 1 ? '' : 's'}`;
  return op === 'purge'
    ? confirmDialog({
        title: 'Delete forever',
        message: `Permanently delete ${noun}? This cannot be undone.`,
        confirmLabel: `Delete ${noun} forever`,
        danger: true,
      })
    : confirmDialog({
        title: 'Move to trash',
        message: `Move ${noun} to trash?`,
        confirmLabel: `Delete ${noun}`,
        danger: true,
      });
}

document.getElementById('bulk-clear')?.addEventListener('click', () => panel.clearSelection());

// An editor sheet saved, trashed, or changed a membership. `panel.refresh` is
// `applyFilters` — it refetches the fragments-panel partial and swaps the table
// in place, which is exactly what the reload used to accomplish and nothing
// more. There was genuinely nothing to build here; the capability was already
// on the handle, and since Piece 3 the same call also re-syncs the toolbar.
// The whole thing waits on the sheet's exit rather than fetching early like the
// composer does: this partial is a table, not a page, and the ~0.28s head start
// isn't worth the extra branch. The swap is what must not land mid-slide.
onFragmentsChanged(({ settled }) => {
  void settled.then(() => panel.refresh());
  return true;
});

// --- per-row trash actions --------------------------------------------------
async function trashAction(op: 'restore' | 'purge', id: string) {
  if (
    op === 'purge' &&
    !(await confirmDialog({
      title: 'Delete forever',
      message: 'Permanently delete this fragment? This cannot be undone.',
      confirmLabel: 'Delete forever',
      danger: true,
    }))
  )
    return;
  const fd = new FormData();
  fd.set('id', id);
  const { error } = await callAction(op === 'restore' ? actions.fragments.restore(fd) : actions.fragments.purge(fd));
  if (error) return showBulkError(formatActionError(error));
  await panel.refresh();
}

// --- empty trash ------------------------------------------------------------
document.getElementById('empty-trash')?.addEventListener('click', async () => {
  if (
    !(await confirmDialog({
      title: 'Empty trash',
      message: 'Permanently delete everything in trash? This cannot be undone.',
      confirmLabel: 'Empty trash',
      danger: true,
    }))
  )
    return;
  const { error } = await callAction(actions.fragments.emptyTrash(new FormData()));
  if (error) return showBulkError(formatActionError(error));
  await panel.refresh();
});

// --- Add ▾ menu -------------------------------------------------------------
const addBtn = document.getElementById('add-btn');
const addMenu = document.getElementById('add-menu');
if (view !== 'trash' && addBtn && addMenu) wireAddMenu(addBtn, addMenu);

// --- bulk membership: elevate (or drop) a whole selection --------------------
const cnBtn = document.getElementById('bulk-cn-btn');
const cnMenu = document.getElementById('bulk-cn-menu');
if (cnBtn && cnMenu) wireAddMenu(cnBtn, cnMenu);

/**
 * "Remove from" only lists constellations the selection actually belongs to —
 * offering to remove something from a suite it was never in is noise. Read off
 * each row's data-constellations, which the server rendered.
 *
 * ⚠ With a cart, a selected fragment may not have a row on screen, and its
 * memberships are then simply unknown here. The list UNDER-offers in that
 * case, which is the safe direction: you can't be shown a "remove from" you
 * didn't mean, only miss one you did (change the filter back and it returns).
 * Fetching memberships for off-screen ids would be a round trip to decide the
 * contents of a menu, which is not worth it in a room with one user.
 */
function syncRemovableConstellations(ids: string[]) {
  if (!cnMenu) return;
  const present = new Set<string>();
  for (const id of ids) {
    const row = root.querySelector<HTMLElement>(`tr.fragment-row[data-id="${id}"]`);
    for (const cid of (row?.dataset.constellations || '').split(',').filter(Boolean)) present.add(cid);
  }
  let any = false;
  cnMenu.querySelectorAll<HTMLElement>('[data-cn-remove]').forEach((el) => {
    const on = present.has(el.dataset.cnRemove!);
    el.hidden = !on;
    if (on) any = true;
  });
  const label = document.getElementById('bulk-cn-remove-label');
  if (label) label.hidden = !any;
}

cnMenu?.addEventListener('click', async (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-cn-add], [data-cn-remove]');
  if (!el) return;
  const add = el.hasAttribute('data-cn-add');
  const ids = panel.getSelected();
  if (!ids.length) return;
  const fd = new FormData();
  fd.set('constellation_id', (add ? el.dataset.cnAdd : el.dataset.cnRemove)!);
  fd.set('fragment_ids', ids.join(','));
  fd.set('op', add ? 'add' : 'remove');
  const { error } = await callAction(actions.constellations.bulkMembership(fd));
  if (error) return showBulkError(formatActionError(error));
  await panel.refresh(); // the membership column is now stale
});
