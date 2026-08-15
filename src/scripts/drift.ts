// The two drift dismissals (docs/plans/archive/12-people.md §8).
//
// One tap each, no dialog. Neither is destructive and neither is hard to
// reverse — "Reached out" writes an entry you can edit or delete from the
// profile, and "That's fine" moves a date you can move back — so a confirm in
// front of either would be a click charged for nothing, on the one surface
// whose whole argument is that clearing it must be cheap.
//
// THE ROW GOES ON SUCCESS, rather than the page reloading. This panel is a
// statement about state, and the state just changed; reloading would also
// scroll you back to the top of a room you were reading. When the last row
// goes, the panel goes with it — an empty warm box is furniture.
import { actions } from 'astro:actions';
import { formatActionError } from './action-error';

const panel = document.querySelector<HTMLElement>('[data-been-a-while]');
const errorEl = panel?.querySelector<HTMLElement>('[data-drift-error]');

function show(msg: string) {
  if (!errorEl) return;
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

/** Remove the row, and the panel too once it holds nothing. */
function retire(row: HTMLElement) {
  row.remove();
  if (!panel?.querySelector('[data-drift]')) panel?.remove();
}

panel?.addEventListener('click', async (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('[data-reached-out], [data-mute]');
  if (!btn) return;

  const row = btn.closest<HTMLElement>('[data-drift]');
  const personId = btn.dataset.reachedOut ?? btn.dataset.mute!;
  const reaching = !!btn.dataset.reachedOut;
  if (errorEl) errorEl.hidden = true;

  // Both buttons, not just the one pressed: they are opposite answers to the
  // same question, and letting the other stay live during the round trip means
  // a double-tap can log contact AND mute the same person.
  const both = row?.querySelectorAll<HTMLButtonElement>('.bw__b') ?? [];
  both.forEach((b) => (b.disabled = true));

  try {
    const { error } = reaching ? await actions.drift.reachedOut({ personId }) : await actions.drift.mute({ personId });
    if (error) throw new Error(error.message);
    if (row) retire(row);
  } catch (err) {
    // `astro:actions` THROWS on a dead network rather than returning
    // `{ error }`. Without this catch the row would simply sit there with two
    // dead buttons — the swallowed-save shape, twice paid for.
    show(formatActionError(err));
    both.forEach((b) => (b.disabled = false));
  }
});
