// Disposition, in the room (docs/plans/13-agenda.md §4; 10-hq.md §10f;
// ADR-0013).
//
// THE ROW STAYS, and that is the whole interaction. One click ticks a task off
// in place — no menu, no dialog — and it sits there struck through until
// midnight, because a task that vanishes gives no sense of progress and no way
// back from a mis-tap. The same click undoes it.
//
// A PAST-DUE ROW GETS THE CHOICE INSTEAD OF A CIRCLE. There are two honest
// answers to something that has gone past its date, and a tick beside a
// "Did it" chip is two paths to one outcome while saying nothing about the
// other. Both answers are recorded; both advance the schedule.
//
// NOTHING RELOADS. The state that just changed is the row's, and a reload would
// also scroll you back to the top of a list you were reading — on the one
// surface designed for a sweep down the page.
import { actions } from 'astro:actions';

const list = document.querySelector<HTMLElement>('[data-task-list]');

if (list) {
  const errorEl = document.querySelector<HTMLElement>('[data-task-error]');

  const show = (msg: string | null) => {
    if (!errorEl) return;
    errorEl.textContent = msg ?? '';
    errorEl.hidden = !msg;
  };

  /** Every control on the row, so an in-flight answer cannot be double-sent. */
  const controls = (row: HTMLElement) =>
    Array.from(row.querySelectorAll<HTMLButtonElement>('.tick, .chip--act'));

  list.addEventListener('click', async (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('[data-dispose], [data-undo]');
    if (!btn) return;
    const row = btn.closest<HTMLElement>('[data-task]');
    if (!row) return;

    const id = row.dataset.id!;
    const undoing = btn.hasAttribute('data-undo');
    const outcome = (btn.dataset.dispose ?? 'done') as 'done' | 'skipped';
    show(null);

    const buttons = controls(row);
    buttons.forEach((b) => (b.disabled = true));

    try {
      const { error } = undoing
        ? await actions.tasks.undo({ id })
        : await actions.tasks.dispose({ id, outcome });
      if (error) throw new Error(error.message);

      // The row's own record of what it is now. `data-undo` is what the next
      // click reads, so flipping it here is what makes the same control undo.
      row.classList.toggle('task--done', !undoing && outcome === 'done');
      row.classList.toggle('task--skipped', !undoing && outcome === 'skipped');
      const tick = row.querySelector<HTMLButtonElement>('.tick');
      if (tick) {
        if (undoing) tick.setAttribute('data-dispose', 'done');
        else tick.removeAttribute('data-dispose');
        tick.toggleAttribute('data-undo', !undoing);
      }
      // On a past-due row the two chips ARE the question, so once it is
      // answered they become the way back — one control, not two.
      row.querySelectorAll<HTMLElement>('[data-answered]').forEach((el) => (el.hidden = !undoing));
      row.querySelectorAll<HTMLElement>('[data-unanswered]').forEach((el) => (el.hidden = undoing));
    } catch (err) {
      // ⚠ `astro:actions` THROWS on a dead network rather than returning
      // `{ error }`. Without this the row would sit there with dead controls
      // and a tick that never happened — the swallowed-save shape.
      show(err instanceof Error ? err.message : 'Couldn’t save that — check your connection.');
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
}
