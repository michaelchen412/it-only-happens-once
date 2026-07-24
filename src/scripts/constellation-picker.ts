// Wiring for a ConstellationPicker instance — the fragment→constellation view
// inside an editor sheet. See the component for the design rationale.
//
// Contract:
//   setFragment(id | null, memberIds)  — call on every sheet open
//   flush(newId)                       — call right after a first save
//   changed()                          — did membership change while open?
import { actions } from 'astro:actions';
import { formatActionError } from './action-error';

export interface PickerHandle {
  /** Point the picker at a fragment (null = a new one, toggles get queued). */
  setFragment: (id: string | null, memberIds: string[]) => void;
  /** A new fragment just got its id — persist whatever was queued. */
  flush: (newId: string) => Promise<void>;
  /** True if membership changed since the last setFragment (host may refresh). */
  changed: () => boolean;
  /** Tick a constellation without user input (e.g. the composing context). */
  preselect: (id: string) => void;
}

export function wireConstellationPicker(root: HTMLElement): PickerHandle {
  const boxes = () => Array.from(root.querySelectorAll<HTMLInputElement>('.cn-check'));
  const status = root.querySelector('.cn-picker-status') as HTMLElement | null;

  let fragmentId: string | null = null;
  let dirty = false;
  let inFlight: Promise<unknown> = Promise.resolve();

  const selected = () => boxes().filter((b) => b.checked).map((b) => b.value);

  function say(msg: string, isError = false) {
    if (!status) return;
    status.textContent = msg;
    status.classList.toggle('text-error', isError);
    if (!isError && msg) window.setTimeout(() => (status.textContent === msg ? (status.textContent = '') : null), 2000);
  }

  /** Persist the current tick-state. Serialized so rapid toggles can't race. */
  function persist() {
    if (!fragmentId) return; // queued until the first save (see flush)
    const ids = selected();
    const id = fragmentId;
    inFlight = inFlight.then(async () => {
      const fd = new FormData();
      fd.set('fragment_id', id);
      fd.set('constellation_ids', ids.join(','));
      const { error } = await actions.constellations.setMembership(fd);
      if (error) return say(formatActionError(error), true);
      say(ids.length ? 'Saved' : 'Removed from all');
    });
  }

  root.addEventListener('change', (e) => {
    if (!(e.target as Element).classList?.contains('cn-check')) return;
    dirty = true;
    if (fragmentId) persist();
    else say('Will be added when you save');
  });

  // Filter (rendered only for a long sky). Hidden rows keep their checkbox
  // state — they're still in the DOM, so selected() stays complete.
  const filter = root.querySelector<HTMLInputElement>('.cn-filter');
  filter?.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    let shown = 0;
    root.querySelectorAll<HTMLElement>('.cn-row').forEach((row) => {
      const hit = !q || (row.dataset.search ?? '').includes(q);
      row.hidden = !hit;
      if (hit) shown++;
    });
    const empty = root.querySelector<HTMLElement>('.cn-empty');
    if (empty) empty.hidden = shown > 0;
  });

  return {
    setFragment(id, memberIds) {
      fragmentId = id;
      dirty = false;
      const want = new Set(memberIds);
      boxes().forEach((b) => (b.checked = want.has(b.value)));
      say('');
    },
    async flush(newId) {
      fragmentId = newId;
      if (!selected().length) return; // nothing queued
      persist();
      await inFlight;
    },
    changed: () => dirty,
    preselect(id) {
      const box = boxes().find((b) => b.value === id);
      if (box && !box.checked) {
        box.checked = true;
        dirty = true;
      }
    },
  };
}
