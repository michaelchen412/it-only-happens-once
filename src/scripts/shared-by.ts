// Wiring for a SharedByField instance — the corpus's side of the person link
// (docs/plans/archive/12-people.md §5). See the component for the design rationale.
//
// The contract is deliberately IDENTICAL to constellation-picker.ts, because it
// is the same problem: a relationship, applied immediately, except on a
// fragment that does not have an id yet.
//
//   setFragment(id | null, personIds)  — call on every sheet open
//   flush(newId)                       — call right after a first save
//   preselect(id)                      — tick somebody without user input
import { actions } from 'astro:actions';
import { callAction, formatActionError } from './action-error';
import { wireFilterFields } from './filter-field';

export interface SharedByHandle {
  setFragment: (id: string | null, personIds: string[]) => void;
  /** Resolves `false` if the queued write failed — see PickerHandle.flush. */
  flush: (newId: string) => Promise<boolean>;
  preselect: (personId: string) => void;
}

export function wireSharedBy(root: HTMLElement): SharedByHandle {
  const boxes = () => Array.from(root.querySelectorAll<HTMLInputElement>('.sby-check'));
  const status = root.querySelector('.sby-status') as HTMLElement | null;
  const who = root.querySelector('[data-sby-who]') as HTMLElement | null;

  let fragmentId: string | null = null;
  let inFlight: Promise<unknown> = Promise.resolve();
  /** Did the most recent trip through the chain fail? Read by `flush`. */
  let failed = false;

  const selected = () =>
    boxes()
      .filter((b) => b.checked)
      .map((b) => b.value);

  function say(msg: string, isError = false) {
    if (!status) return;
    status.textContent = msg;
    status.classList.toggle('text-error', isError);
    if (!isError && msg) window.setTimeout(() => (status.textContent === msg ? (status.textContent = '') : null), 2000);
  }

  /**
   * The summary line, so the CLOSED state still answers the question.
   *
   * Names rather than a count: "2 people" tells you there is something to open
   * and nothing else, which on a field this small is the whole answer withheld.
   */
  function refreshWho() {
    if (!who) return;
    // ⚠ `dataset.name`, NOT the row's textContent: the row also holds the
    // monogram, so reading it rendered "MMarisol Quint".
    const names = boxes()
      .filter((b) => b.checked)
      .map((b) => b.dataset.name ?? '')
      .filter(Boolean);
    who.textContent = names.length === 0 ? 'nobody' : names.join(', ');
  }

  /**
   * Persist the current tick-state. Serialized so rapid toggles cannot race.
   *
   * ⚠ THE CHAIN MUST ALWAYS SETTLE **RESOLVED** — the identical rule the
   * constellation picker carries, written out there at length because it is the
   * same defect in the same shape: one rejected persist poisons `inFlight` and
   * every later tick is silently dropped for the rest of the sheet's session.
   * `astro:actions` throws on a dead network, so that was one lost connection
   * away until 2026-08-08.
   */
  function persist() {
    if (!fragmentId) return; // queued until the first save (see flush)
    const ids = selected();
    const id = fragmentId;
    inFlight = inFlight
      .then(async () => {
        const { error } = await callAction(actions.links.setPeople({ fragmentId: id, personIds: ids }));
        if (error) {
          failed = true;
          return say(formatActionError(error), true);
        }
        failed = false;
        say('Saved');
      })
      .catch((e) => {
        failed = true;
        say(formatActionError(e), true);
      });
  }

  root.addEventListener('change', (e) => {
    if (!(e.target as Element).classList?.contains('sby-check')) return;
    refreshWho();
    if (fragmentId) persist();
    else say('Will be linked when you save');
  });

  // The pass is `filter-field.ts` now (plan 42 · §4.B.2) — the same six lines
  // stood here, in `event-sheet.ts` and in `tag-sheet.ts`, and none of the
  // three ever said "nobody by that name".
  const [filter] = wireFilterFields(root);

  return {
    setFragment(id, personIds) {
      fragmentId = id;
      const want = new Set(personIds);
      boxes().forEach((b) => (b.checked = want.has(b.value)));
      // ⚠ ONE CALL WHERE THERE WERE TWO, and the second was the bug waiting to
      // happen: clearing the box without unhiding the rows leaves an empty
      // query over a filtered list. `clear()` cannot do one without the other.
      filter?.clear();
      // Open when there is something to see, closed when there is not — the
      // one place this field earns the space it takes.
      (root as HTMLDetailsElement).open = want.size > 0;
      if (status) status.textContent = '';
      refreshWho();
    },

    async flush(newId) {
      fragmentId = newId;
      // Nothing ticked means nothing to write. Calling anyway would be a
      // pointless round trip on every new quote in a roster-less corpus.
      if (selected().length === 0) return true;
      failed = false;
      persist();
      await inFlight;
      return !failed;
    },

    preselect(personId) {
      const box = boxes().find((b) => b.value === personId);
      if (!box || box.checked) return;
      box.checked = true;
      (root as HTMLDetailsElement).open = true;
      refreshWho();
      say('Will be linked when you save');
    },
  };
}
