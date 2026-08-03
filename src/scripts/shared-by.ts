// Wiring for a SharedByField instance — the corpus's side of the person link
// (docs/plans/12-people.md §5). See the component for the design rationale.
//
// The contract is deliberately IDENTICAL to constellation-picker.ts, because it
// is the same problem: a relationship, applied immediately, except on a
// fragment that does not have an id yet.
//
//   setFragment(id | null, personIds)  — call on every sheet open
//   flush(newId)                       — call right after a first save
//   preselect(id)                      — tick somebody without user input
import { actions } from 'astro:actions';
import { formatActionError } from './action-error';

export interface SharedByHandle {
  setFragment: (id: string | null, personIds: string[]) => void;
  flush: (newId: string) => Promise<void>;
  preselect: (personId: string) => void;
}

export function wireSharedBy(root: HTMLElement): SharedByHandle {
  const boxes = () => Array.from(root.querySelectorAll<HTMLInputElement>('.sby-check'));
  const status = root.querySelector('.sby-status') as HTMLElement | null;
  const who = root.querySelector('[data-sby-who]') as HTMLElement | null;
  const filter = root.querySelector('.sby-filter') as HTMLInputElement | null;

  let fragmentId: string | null = null;
  let inFlight: Promise<unknown> = Promise.resolve();

  const selected = () => boxes().filter((b) => b.checked).map((b) => b.value);

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

  /** Persist the current tick-state. Serialized so rapid toggles cannot race. */
  function persist() {
    if (!fragmentId) return; // queued until the first save (see flush)
    const ids = selected();
    const id = fragmentId;
    inFlight = inFlight.then(async () => {
      const { error } = await actions.links.setPeople({ fragmentId: id, personIds: ids });
      if (error) return say(formatActionError(error), true);
      say('Saved');
    });
  }

  root.addEventListener('change', (e) => {
    if (!(e.target as Element).classList?.contains('sby-check')) return;
    refreshWho();
    if (fragmentId) persist();
    else say('Will be linked when you save');
  });

  filter?.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    root.querySelectorAll<HTMLElement>('.sby__row').forEach((row) => {
      row.hidden = !!q && !(row.dataset.search ?? '').includes(q);
    });
  });

  return {
    setFragment(id, personIds) {
      fragmentId = id;
      const want = new Set(personIds);
      boxes().forEach((b) => (b.checked = want.has(b.value)));
      if (filter) filter.value = '';
      root.querySelectorAll<HTMLElement>('.sby__row').forEach((row) => (row.hidden = false));
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
      if (selected().length === 0) return;
      persist();
      await inFlight;
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
