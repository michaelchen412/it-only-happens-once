// Host logic for the Fragment Manager (src/pages/admin/index.astro). The
// table/toolbar mechanics live in fragment-panel.ts (shared with the composer's
// browser sheet); this file adds what's unique to the page: the bulk-action
// bar, trash actions, the Add ▾ menu, and routing row-opens to the editor
// sheets (quote/song → FragmentSheet, writing → WritingSheet).
import { actions } from 'astro:actions';
import { confirmDialog } from './confirm-dialog';
import { wireFragmentPanel, wireAddMenu } from './fragment-panel';

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
  historyBase: '/admin',
  onOpen(row) {
    if (row.dataset.writing) {
      document.dispatchEvent(new CustomEvent('writing:edit', { detail: row.dataset.writing }));
    } else if (row.dataset.fragment) {
      document.dispatchEvent(new CustomEvent('fragment:edit', { detail: row.dataset.fragment }));
    }
  },
  onAction(act, id) {
    if (act === 'restore' || act === 'purge') void trashAction(act, id);
  },
  onSelectionChange(ids) {
    bulkbar.classList.toggle('is-open', ids.length > 0);
    bulkcount.textContent = `${ids.length} selected`;
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
    const op = btn.dataset.bulk as 'publish' | 'unpublish' | 'trash' | 'restore' | 'purge';
    const ids = panel.getSelected();
    if (!ids.length) return;
    if ((op === 'trash' || op === 'purge') && !(await confirmBulk(op, ids.length))) return;

    bulkBtns.forEach((b) => (b.disabled = true));
    bulkError.hidden = true;
    const fd = new FormData();
    fd.set('ids', ids.join(','));
    fd.set('op', op);
    const { error } = await actions.fragments.bulk(fd);
    if (error) {
      bulkBtns.forEach((b) => (b.disabled = false));
      showBulkError(error.message);
      return;
    }
    await panel.refresh();
    bulkBtns.forEach((b) => (b.disabled = false));
  }),
);

function confirmBulk(op: 'trash' | 'purge', n: number) {
  const noun = `${n} fragment${n === 1 ? '' : 's'}`;
  return op === 'purge'
    ? confirmDialog({ title: 'Delete forever', message: `Permanently delete ${noun}? This cannot be undone.`, confirmLabel: 'Delete forever', danger: true })
    : confirmDialog({ title: 'Move to trash', message: `Move ${noun} to trash?`, confirmLabel: 'Delete', danger: true });
}

// --- per-row trash actions --------------------------------------------------
async function trashAction(op: 'restore' | 'purge', id: string) {
  if (op === 'purge' && !(await confirmDialog({ title: 'Delete forever', message: 'Permanently delete this fragment? This cannot be undone.', confirmLabel: 'Delete forever', danger: true }))) return;
  const fd = new FormData();
  fd.set('id', id);
  const { error } = await (op === 'restore' ? actions.fragments.restore(fd) : actions.fragments.purge(fd));
  if (error) return showBulkError(error.message);
  await panel.refresh();
}

// --- empty trash ------------------------------------------------------------
document.getElementById('empty-trash')?.addEventListener('click', async () => {
  if (!(await confirmDialog({ title: 'Empty trash', message: 'Permanently delete everything in trash? This cannot be undone.', confirmLabel: 'Empty trash', danger: true }))) return;
  const { error } = await actions.fragments.emptyTrash(new FormData());
  if (error) return showBulkError(error.message);
  await panel.refresh();
});

// --- Add ▾ menu -------------------------------------------------------------
const addBtn = document.getElementById('add-btn');
const addMenu = document.getElementById('add-menu');
if (view !== 'trash' && addBtn && addMenu) wireAddMenu(addBtn, addMenu);
