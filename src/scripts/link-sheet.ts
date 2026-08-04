// The link sheet and the Shared zone's unlink buttons (12 · Piece 3).
//
// Two modes over one dialog, a client-side filter over server-rendered rows,
// and a single-select. Everything reloads after a write for the same reason the
// About block does: the zone is rendered by the server, including the two-hop
// resolution of a work's fragments, and re-deriving any of that in the browser
// is how the saved shape and the shown shape start to disagree.
import { actions } from 'astro:actions';
import { formatActionError } from './action-error';
import { confirmDialog } from './confirm-dialog';

type Mode = 'work' | 'fragment';

const sheet = document.querySelector<HTMLDialogElement>('#link-sheet');
const zone = document.querySelector<HTMLElement>('[data-shared]');
const personId = zone?.dataset.personId;

/**
 * Two error targets, not one.
 *
 * ⚠ The sheet's own `#link-error` sits INSIDE a `<dialog>`, so an unlink
 * failure written there would be invisible: unlinking happens with the sheet
 * closed. A silent failure that leaves the row on screen reads as "it didn't
 * take", which is exactly the swallowed-save class of bug the check-in shipped.
 */
const sheetError = document.querySelector<HTMLElement>('#link-error');
const zoneError = document.querySelector<HTMLElement>('[data-shared-error]');

const show = (el: HTMLElement | null, msg: string) => {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
};
const clearError = () => {
  if (sheetError) sheetError.hidden = true;
  if (zoneError) zoneError.hidden = true;
};

if (sheet && personId) {
  const search = sheet.querySelector<HTMLInputElement>('[data-link-search]')!;
  const noteInput = sheet.querySelector<HTMLInputElement>('[data-link-note]')!;
  const saveBtn = sheet.querySelector<HTMLButtonElement>('[data-link-save]')!;
  const lists: Record<Mode, HTMLElement | null> = {
    work: sheet.querySelector('[data-list="work"]'),
    fragment: sheet.querySelector('[data-list="fragment"]'),
  };

  let mode: Mode = 'work';
  let picked: { id: string; label: string } | null = null;

  const setPicked = (next: typeof picked) => {
    picked = next;
    saveBtn.disabled = !next;
    // "Link Piranesi" rather than "Link" — the button names what it is about to
    // do, which is the only confirmation this action gets.
    saveBtn.textContent = next ? `Link ${next.label.slice(0, 24)}${next.label.length > 24 ? '…' : ''}` : 'Link';
  };

  /** Filter the VISIBLE list only; the hidden one is re-filtered when it shows. */
  function applyFilter() {
    const q = search.value.trim().toLowerCase();
    const list = lists[mode];
    if (!list) return;
    let shown = 0;
    list.querySelectorAll<HTMLElement>('[data-pick]').forEach((row) => {
      const hit = !q || (row.dataset.search ?? '').includes(q);
      row.hidden = !hit;
      if (hit) shown++;
    });
    const none = list.querySelector<HTMLElement>('[data-none]');
    if (none) none.hidden = shown > 0 || !q;
  }

  function setMode(next: Mode) {
    mode = next;
    sheet!.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.mode === next)),
    );
    for (const [key, el] of Object.entries(lists)) if (el) el.hidden = key !== next;
    // "Add a quote from them" belongs to the fragment mode only — a work is
    // created by the quote's own Work field, so offering it here would point
    // at the wrong door.
    const addQuote = sheet!.querySelector<HTMLElement>('[data-add-quote]');
    if (addQuote) addQuote.hidden = next !== 'fragment';
    // A selection does not survive a mode switch: the id would still be valid
    // and would link the wrong KIND of thing, silently.
    sheet!.querySelectorAll('.picker__row.is-on').forEach((r) => r.classList.remove('is-on'));
    setPicked(null);
    applyFilter();
  }

  sheet.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => setMode(btn.dataset.mode as Mode)),
  );

  search.addEventListener('input', applyFilter);

  sheet.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('[data-pick]');
    if (!row || !sheet.contains(row)) return;
    const already = row.classList.contains('is-on');
    sheet.querySelectorAll('.picker__row.is-on').forEach((r) => r.classList.remove('is-on'));
    // Clicking the chosen row again clears it, so a mis-tap has a way back that
    // is not "close the sheet and start over".
    if (already) return setPicked(null);
    row.classList.add('is-on');
    setPicked({ id: row.dataset.id!, label: row.dataset.label ?? 'this' });
  });

  document.querySelectorAll<HTMLElement>('[data-open-link-sheet]').forEach((btn) =>
    btn.addEventListener('click', () => {
      clearError();
      search.value = '';
      noteInput.value = '';
      setMode('work');
      sheet.showModal();
      search.focus();
    }),
  );

  sheet.querySelectorAll<HTMLElement>('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => sheet.close()),
  );

  saveBtn.addEventListener('click', async () => {
    if (!picked) return;
    clearError();
    const label = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Linking…';
    try {
      const note = noteInput.value.trim() || null;
      const { error } =
        mode === 'work'
          ? await actions.links.work({ personId, workId: picked.id, note })
          : await actions.links.fragment({ personId, fragmentId: picked.id, note });
      if (error) throw new Error(error.message);
      location.reload();
    } catch (err) {
      // `astro:actions` THROWS on a dead network rather than returning
      // `{ error }`, so the catch is not optional — a swallowed failure here
      // leaves the button stuck saying "Linking…" forever, which is the exact
      // bug the check-in shipped with and its own spec caught.
      show(sheetError, formatActionError(err));
      saveBtn.disabled = false;
      saveBtn.textContent = label;
    }
  });
}

// ── unlinking, from the shelf ─────────────────────────────────────────────
// Guarded, though nothing is destroyed: the work and the fragment are both
// untouched, and only the attribution goes. The confirm exists because that
// attribution is the part you cannot reconstruct — you will remember the book
// and not who gave it to you, which is the whole reason this table exists.
zone?.querySelectorAll<HTMLButtonElement>('[data-unlink]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    if (!personId) return;
    const kind = btn.dataset.unlink as Mode;
    const label = btn.dataset.label ?? 'this';
    const ok = await confirmDialog({
      title: 'Remove the link?',
      message: `“${label}” stays in the corpus exactly as it is. Only the connection to this person goes.`,
      confirmLabel: 'Unlink',
    });
    if (!ok) return;

    btn.disabled = true;
    try {
      const { error } =
        kind === 'work'
          ? await actions.links.unlinkWork({ personId, workId: btn.dataset.id! })
          : await actions.links.unlinkFragment({ personId, fragmentId: btn.dataset.id! });
      if (error) throw new Error(error.message);
      location.reload();
    } catch (err) {
      show(zoneError, formatActionError(err));
      btn.disabled = false;
    }
  }),
);
