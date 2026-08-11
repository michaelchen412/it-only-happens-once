import { actions } from 'astro:actions';
import { confirmDialog } from './confirm-dialog';
import { callAction, formatActionError } from './action-error';
import { wireListReorder } from './list-reorder';
import { announceSkyChange } from './sky-changed';

const errBox = document.getElementById('cl-error') as HTMLParagraphElement;
const show = (m: string) => ((errBox.textContent = m), (errBox.hidden = false));

const list = document.getElementById('cl-list');
const listRows = () => [...(list?.querySelectorAll<HTMLElement>('li[data-id]') ?? [])];

/**
 * One field of one row, and NOTHING else on the wire.
 *
 * ⚠ THIS USED TO REBUILD THE WHOLE ROW, and the reason it stopped is worth
 * keeping. Both gestures on this page went through `constellations.save`, which
 * is a whole-card update — it rebuilds the slug from what it is given and
 * defaults `status` to draft — so a flip or a recolour had to resend the row's
 * `name`, `slug` and `status`, read back out of `data-` attributes rendered
 * when the page loaded. That made every click a chance to overwrite a rename
 * made in the composer next door, and it could never resend the two fields it
 * didn't have (the description and the score) — which is precisely why `save`
 * grew an "absent means leave as-is" sentinel that Astro's form coercion made
 * unreachable, and why clearing a playlist did nothing at all.
 * `setStatus`/`setColor` say only what the click said.
 */
function fieldForm(id: string, field: string, value: string): FormData {
  const fd = new FormData();
  fd.set('id', id);
  fd.set(field, value);
  return fd;
}

// create — the form stays folded away until asked for
const newForm = document.getElementById('new-constellation') as HTMLFormElement;
const newName = document.getElementById('cl-new-name') as HTMLInputElement;
document.getElementById('cl-new-btn')?.addEventListener('click', () => {
  newForm.hidden = !newForm.hidden;
  if (!newForm.hidden) newName.focus();
});
document.getElementById('cl-new-cancel')?.addEventListener('click', () => {
  newForm.hidden = true;
  newName.value = '';
});

newForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  // `callAction`, not a bare await: `astro:actions` THROWS on a dead network
  // rather than returning `{ error }`, so this used to be a button that
  // silently did nothing offline. Same defect 15 found in the composer.
  const { data, error } = await callAction(actions.constellations.save(new FormData(newForm)));
  if (error) return show(formatActionError(error));
  if (data) location.href = `/admin/constellations/${data.id}`; // straight into the composer
});

// ── the sky's authored order ────────────────────────────────────────────
// Drag, Alt+↑/↓ and the touch nudges, all from the module the composer's
// suite uses. Until now this page — the one that orders the sky the home page
// reads top to bottom — could only be reordered with two arrow buttons: no
// grip, no drag, no keyboard path. `constellations.reorder` already rewrote
// `sort` 1..n from an id list, so nothing on the server changed.
if (list) {
  wireListReorder(list, {
    rowSelector: 'li[data-id]',
    onCommit: async () => {
      const fd = new FormData();
      fd.set(
        'ids',
        listRows()
          .map((l) => l.dataset.id)
          .join(','),
      );
      const { error } = await callAction(actions.constellations.reorder(fd));
      // Loud rather than silently reverting: the rows are where you put them,
      // and a list that snaps back on its own is indistinguishable from a
      // list that ignored you. The message says which it was.
      if (error) show(formatActionError(error));
    },
  });
}

list?.addEventListener('click', async (e) => {
  const btn = (e.target as Element).closest('button');
  const row = (e.target as Element).closest('li[data-id]') as HTMLLIElement | null;
  if (!btn || !row) return;
  const id = row.dataset.id!;

  if (btn.hasAttribute('data-color-btn')) return void openColors(btn as HTMLButtonElement, row);

  if (btn.hasAttribute('data-toggle-status')) {
    const next = btn.dataset.toggleStatus === 'published' ? 'draft' : 'published';
    const { error } = await callAction(actions.constellations.setStatus(fieldForm(id, 'status', next)));
    if (error) return show(formatActionError(error));
    location.reload();
    return;
  }

  if (btn.hasAttribute('data-delete')) {
    const ok = await confirmDialog({
      title: 'Delete constellation',
      message: `Delete “${row.dataset.name}”? Its composition is lost; the fragments themselves are untouched.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('id', id);
    const { error } = await callAction(actions.constellations.remove(fd));
    if (error) return show(formatActionError(error));
    location.reload();
  }
});

// ── colour: the row's own star is the control ───────────────────────────
const pop = document.getElementById('cl-colors') as HTMLElement;
const slots = [...pop.querySelectorAll<HTMLButtonElement>('.cn-slot')];
let openRow: HTMLElement | null = null;
let openTrigger: HTMLButtonElement | null = null;

/** Which slots are taken, read off the DOM rather than the server's render —
 *  so the counts stay true after a recolour without needing a reload. */
function slotCounts(): Record<string, number> {
  const n: Record<string, number> = {};
  for (const r of listRows()) {
    const c = r.dataset.color;
    if (c) n[c] = (n[c] ?? 0) + 1;
  }
  return n;
}

function openColors(trigger: HTMLButtonElement, row: HTMLElement) {
  openRow = row;
  openTrigger = trigger;
  const counts = slotCounts();
  for (const b of slots) {
    const slot = b.dataset.slot!;
    const used = counts[slot] ?? 0;
    const mine = row.dataset.color === slot;
    b.setAttribute('aria-pressed', String(mine));
    b.classList.toggle('is-active', mine);
    b.querySelector<HTMLElement>('[data-count]')!.textContent = used ? String(used) : '';
    b.title = mine ? `${slot} — this one` : used ? `${slot} — ${used} already wearing it` : `${slot} — free`;
  }
  pop.showPopover();
  // Positioned against the star that opened it. The popover is in the top
  // layer, so these are viewport coordinates and no ancestor can clip them —
  // which is the whole reason it isn't an absolutely-positioned div inside
  // the row. Flipped above the trigger when it would fall off the bottom.
  const r = trigger.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const below = r.bottom + 6;
  pop.style.top = `${below + p.height > window.innerHeight - 8 ? Math.max(8, r.top - p.height - 6) : below}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - p.width - 8))}px`;
  trigger.setAttribute('aria-expanded', 'true');
  (slots.find((b) => b.classList.contains('is-active')) ?? slots[0]).focus();
}

pop.addEventListener('toggle', (e) => {
  if ((e as ToggleEvent).newState === 'open') return;
  // Escape and light-dismiss both land here. Focus only comes back when it
  // was inside the popover — otherwise you clicked somewhere on purpose and
  // yanking the caret back to the star would be the rude reading.
  const wasInside = pop.contains(document.activeElement);
  openTrigger?.setAttribute('aria-expanded', 'false');
  if (wasInside) openTrigger?.focus();
  openTrigger = null;
  openRow = null;
});

/** Repaint one row in a slot. The `cn-*` class is what carries `--cn`, so
 *  this is the whole of "the star changes colour". */
function paintRow(row: HTMLElement, slot: string) {
  if (row.dataset.color) row.classList.remove(`cn-${row.dataset.color}`);
  row.classList.add(`cn-${slot}`);
  row.dataset.color = slot;
  const star = row.querySelector<HTMLElement>('[data-color-btn]');
  star?.setAttribute('aria-label', `Star colour for ${row.dataset.name} — currently ${slot}`);
  if (star) star.title = `Star colour — ${slot}`;
}

/**
 * REPAINT ON CLICK, NOT ON ROUND TRIP. There is no form here and no Save
 * button — the click IS the commit, matching the status toggle in the same
 * row — so a preview that waits for the server would lag behind the gesture
 * that caused it. The reconcile path is written in the same breath rather
 * than afterwards: a colour left on screen that isn't in the database is a
 * worse failure than the save failing, because nothing on the page says so.
 */
async function chooseSlot(slot: string) {
  const row = openRow;
  if (!row) return;
  const prev = row.dataset.color!;
  pop.hidePopover();
  if (slot === prev) return;
  paintRow(row, slot);
  const { error } = await callAction(actions.constellations.setColor(fieldForm(row.dataset.id!, 'color', slot)));
  if (error) {
    paintRow(row, prev);
    return show(formatActionError(error));
  }
  errBox.hidden = true;
  // Nothing on THIS page listens yet — but the announcement is page-wide by
  // contract, and a composer or browser drawer mounted beside this list would
  // otherwise keep showing the colour the server rendered.
  announceSkyChange({
    id: row.dataset.id!,
    name: row.dataset.name ?? '',
    slug: row.dataset.slug ?? '',
    color: slot,
  });
}

for (const b of slots) b.addEventListener('click', () => void chooseSlot(b.dataset.slot!));
