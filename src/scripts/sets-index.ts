// The sets list: open the sheet, reorder, and the one-click writes behind ⋯
// (plan 42 · §4.D.2, §4.D.3, §4.D.7, §4.D.8).
//
// ⚠ THIS PAGE USED TO HAVE NO SCRIPT AT ALL, and every gesture was a form POST
// that reloaded the room. What that cost is written at length in `sets.astro`
// and `SetSheet.astro`; the short version is that the PAGE was the commit unit,
// so a reorder discarded unsaved text in every other card.
//
// The shape here is `constellations-index.ts`'s, deliberately — the two rooms
// are siblings by construction (the `sets` migration says it was "shaped after
// `constellations`"), and a reader who knows one should not have to learn the
// other.
import { actions } from 'astro:actions';
import { confirmDialog } from './confirm-dialog';
import { callAction, formatActionError } from './action-error';
import { wireListReorder } from './list-reorder';
import { anchorPopover } from './pop-anchor';

const errBox = document.getElementById('sets-error') as HTMLParagraphElement | null;
const show = (m: string) => {
  if (!errBox) return;
  errBox.textContent = m;
  errBox.hidden = false;
};

const list = document.getElementById('sets-list');
const rows = () => [...(list?.querySelectorAll<HTMLElement>('li[data-id]') ?? [])];

// ── open the sheet ──────────────────────────────────────────────────────────
// The row carries its own columns; the sheet fills from them. `set:edit` rather
// than a direct call so the row never names a surface — the same seam
// `open-editor.ts` uses for fragments, so if this ever becomes a popover
// instead of a drawer, no row changes.
list?.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLElement>('[data-edit-set]');
  const row = (e.target as Element).closest<HTMLElement>('li[data-id]');
  if (!btn || !row) return;
  document.dispatchEvent(new CustomEvent('set:edit', { detail: JSON.parse(row.dataset.set!) }));
});

// ── reorder ─────────────────────────────────────────────────────────────────
// ⚠ THE WHOLE ORDER GOES ON THE WIRE, because `sets.reorder` rewrites `sort`
// 1..n rather than nudging one row — the same rule constellations follow, and
// the reason the old page's arrows had to post every id too. What changed is
// that this no longer navigates: the DOM has already moved the row, and the
// action is told afterwards.
if (list) {
  wireListReorder(list, {
    rowSelector: 'li[data-id]',
    onCommit: async () => {
      const fd = new FormData();
      fd.set(
        'ids',
        rows()
          .map((r) => r.dataset.id!)
          .join(','),
      );
      const { error } = await callAction(actions.sets.reorder(fd));
      if (error) show(formatActionError(error));
    },
  });
}

// ── the row menu ────────────────────────────────────────────────────────────
const menu = document.getElementById('sets-row-menu');
const statusRow = menu?.querySelector<HTMLButtonElement>('[data-act="status"]');
const statusLabel = menu?.querySelector<HTMLElement>('[data-status-label]');
const iconPublish = menu?.querySelector<HTMLElement>('[data-icon-publish]');
const iconUnpublish = menu?.querySelector<HTMLElement>('[data-icon-unpublish]');

let menuRow: HTMLElement | null = null;
let menuTrigger: HTMLButtonElement | null = null;

if (menu) {
  anchorPopover(menu, () => menuTrigger);
  menu.addEventListener('toggle', (e) => {
    if ((e as ToggleEvent).newState === 'closed') menuTrigger?.setAttribute('aria-expanded', 'false');
  });
}

function openRowMenu(trigger: HTMLButtonElement, row: HTMLElement) {
  if (!menu || !statusRow || !statusLabel) return;
  menuRow = row;
  menuTrigger = trigger;
  // The verb depends on the row, so it cannot be server-rendered into a menu the
  // whole list shares. `data-status` on the TRIGGER is the source — reading the
  // chip's text would be one relabelling away from breaking.
  const published = trigger.dataset.status === 'published';
  statusLabel.textContent = published ? 'Unpublish' : 'Publish';
  statusRow.title = published ? 'Take it off the music page — it stays here as a draft' : 'Put it on the music page';
  if (iconPublish) iconPublish.hidden = published;
  if (iconUnpublish) iconUnpublish.hidden = !published;
  menu.showPopover();
  trigger.setAttribute('aria-expanded', 'true');
  statusRow.focus();
}

/**
 * Publish ⇄ unpublish. THE CLICK IS THE COMMIT here, where the sheet's switch
 * waits for Save — two screens, one fact, which is the constellations shape.
 * Plan 41 · §5a's finding was two controls for one fact on ONE screen.
 *
 * Reloads rather than repainting: the chip, the row's own line and the menu's
 * verb are three views of the flip, and re-deriving each by hand is three
 * chances to disagree with the database on a page that changes rarely.
 */
async function toggleStatus(row: HTMLElement, current: string) {
  const fd = new FormData();
  fd.set('id', row.dataset.id!);
  fd.set('status', current === 'published' ? 'draft' : 'published');
  const { error } = await callAction(actions.sets.setStatus(fd));
  if (error) return show(formatActionError(error));
  location.reload();
}

async function removeRow(row: HTMLElement) {
  const { title } = JSON.parse(row.dataset.set!) as { title: string };
  const ok = await confirmDialog({
    title: 'Delete this set?',
    message: `Delete “${title}”? The playlist on Spotify is untouched, and the quote stays in the corpus. This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const fd = new FormData();
  fd.set('id', row.dataset.id!);
  const { error } = await callAction(actions.sets.remove(fd));
  if (error) return show(formatActionError(error));
  location.reload();
}

list?.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLElement>('[data-row-menu]');
  const row = (e.target as Element).closest<HTMLElement>('li[data-id]');
  if (!btn || !row) return;
  openRowMenu(btn as HTMLButtonElement, row);
});

menu?.addEventListener('click', (e) => {
  const act = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
  const row = menuRow;
  if (!act || !row) return;
  menu.hidePopover();

  const set = JSON.parse(row.dataset.set!) as { status: string; playlist_url: string };
  if (act === 'status') return void toggleStatus(row, set.status);
  if (act === 'delete') return void removeRow(row);
  // The one field you cannot check by reading it — a playlist id is 22 opaque
  // characters, and the only other way to find out it is the wrong one is to
  // publish the page and press play.
  if (act === 'open') window.open(set.playlist_url, '_blank', 'noreferrer');
});
