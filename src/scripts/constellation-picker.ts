// Wiring for a ConstellationPicker instance — the fragment→constellation view
// inside an editor sheet. See the component for the design rationale.
//
// Contract:
//   setFragment(id | null, memberIds)  — call on every sheet open
//   flush(newId)                       — call right after a first save
//   changed()                          — did membership change while open?
import { actions } from 'astro:actions';
import { callAction, formatActionError, submitAction } from './action-error';
import { announceSkyChange, onSkyChange, type SkyConstellation } from './sky-changed';
import { wireFilterField } from './filter-field';

export interface PickerHandle {
  /** Point the picker at a fragment (null = a new one, toggles get queued). */
  setFragment: (id: string | null, memberIds: string[]) => void;
  /** A new fragment just got its id — persist whatever was queued. Resolves
   *  `false` if that write failed, so the host can hold its sheet open rather
   *  than reporting a save that only half landed. */
  flush: (newId: string) => Promise<boolean>;
  /** True if membership changed since the last setFragment (host may refresh). */
  changed: () => boolean;
  /** Tick a constellation without user input (e.g. the composing context). */
  preselect: (id: string) => void;
}

export function wireConstellationPicker(root: HTMLElement): PickerHandle {
  const boxes = () => Array.from(root.querySelectorAll<HTMLInputElement>('.cn-check'));
  const status = root.querySelector('.cn-picker-status') as HTMLElement | null;
  const list = root.querySelector('.cn-list') as HTMLElement;
  const noneHint = root.querySelector<HTMLElement>('.cn-none');

  let fragmentId: string | null = null;
  let dirty = false;
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
   * Persist the current tick-state. Serialized so rapid toggles can't race.
   *
   * ⚠ THE CHAIN MUST ALWAYS SETTLE **RESOLVED**, and that is the whole reason
   * this block looks over-defended. `inFlight` is the serializer for every
   * toggle in the sheet: one rejection poisons it, and then every subsequent
   * tick is silently dropped for the rest of the session — the swallowed save,
   * this codebase's named worst failure, arrived at from a direction no amount
   * of care inside the callback would have caught. `astro:actions` THROWS on a
   * dead network rather than returning `{ error }`, so before 2026-08-08 that
   * took exactly one lost connection.
   *
   * Two defences, deliberately, because they guard different things:
   * `callAction` makes the *failure legible* — a thrown `TypeError` and a
   * returned error reach `say` as the same sentence — while the trailing
   * `.catch` makes settling-resolved a property of the CHAIN rather than
   * something that stays true only while nothing else in here ever throws.
   */
  function persist() {
    if (!fragmentId) return; // queued until the first save (see flush)
    const ids = selected();
    const id = fragmentId;
    inFlight = inFlight
      .then(async () => {
        const fd = new FormData();
        fd.set('fragment_id', id);
        fd.set('constellation_ids', ids.join(','));
        const { error } = await callAction(actions.constellations.setMembership(fd));
        if (error) {
          failed = true;
          return say(formatActionError(error), true);
        }
        failed = false;
        say(ids.length ? 'Saved' : 'Removed from all');
      })
      .catch((e) => {
        failed = true;
        say(formatActionError(e), true);
      });
  }

  root.addEventListener('change', (e) => {
    if (!(e.target as Element).classList?.contains('cn-check')) return;
    dirty = true;
    if (fragmentId) persist();
    else say('Will be added when you save');
  });

  // ⚠ THE PASS ITSELF IS `filter-field.ts` NOW (plan 42 · §4.B.2), and what it
  // kept is this one's behaviour: hidden rows keep their checkbox state — they
  // are still in the DOM, so `selected()` stays complete. What is left here is
  // the one thing the component cannot know: that this picker MINTS rows, so
  // the threshold has to be re-checked after the footer makes one.
  const filter = wireFilterField(root);

  // --- the footer: making a constellation from in here ------------------------

  const newBtn = root.querySelector<HTMLButtonElement>('.cn-new-btn');
  const newForm = root.querySelector<HTMLElement>('.cn-new-form');
  const newName = root.querySelector<HTMLInputElement>('.cn-new-name');
  const newSave = root.querySelector<HTMLButtonElement>('.cn-new-save');
  const newCancel = root.querySelector<HTMLButtonElement>('.cn-new-cancel');

  function foldForm(open: boolean) {
    if (!newForm || !newName) return;
    newForm.hidden = !open;
    if (open) newName.focus();
    else newName.value = '';
  }
  newBtn?.addEventListener('click', () => foldForm(!!newForm?.hidden));
  newCancel?.addEventListener('click', () => foldForm(false));

  /** Build a row for a constellation that wasn't in the server's list. */
  function addRow(c: SkyConstellation): HTMLElement {
    const li = document.createElement('li');
    li.className = 'cn-row group rounded-field hover:bg-base-200 flex items-start';
    li.dataset.id = c.id;
    li.dataset.name = c.name;
    li.dataset.search = c.name.toLowerCase();
    // Appended, never inserted: `save` gives a new constellation sort = max+1,
    // so the end of this list IS its position in the sky's authored order.
    li.innerHTML = `
      <label class="flex min-w-0 grow cursor-pointer items-start gap-2.5 py-2 pl-2">
        <input type="checkbox" class="cn-check checkbox checkbox-xs mt-0.5 shrink-0" />
        <span class="min-w-0 grow"><span class="block truncate text-sm leading-snug"></span></span>
      </label>
      <a target="_blank" rel="noopener"
         class="cn-open text-whisper hover:text-base-content shrink-0 px-2 py-2 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
        <span aria-hidden="true">↗</span><span class="sr-only"></span>
      </a>`;
    // Set the untrusted parts as TEXT and as properties, never through the
    // template above — a constellation named `<img onerror=…>` is a name a
    // human typed, and it goes in as characters or not at all.
    li.querySelector<HTMLInputElement>('.cn-check')!.value = c.id;
    li.querySelector('.truncate')!.textContent = c.name;
    const link = li.querySelector<HTMLAnchorElement>('.cn-open')!;
    link.href = `/admin/constellations/${c.id}`;
    link.title = `Open ${c.name} in a new tab`;
    link.querySelector('.sr-only')!.textContent = `Open ${c.name} in a new tab`;
    list.appendChild(li);
    if (noneHint) noneHint.hidden = true;
    filter?.sync();
    return li;
  }

  const rowNamed = (name: string) =>
    Array.from(list.querySelectorAll<HTMLElement>('.cn-row')).find(
      (r) => (r.dataset.name ?? '').trim().toLowerCase() === name.trim().toLowerCase(),
    );

  /** Tick a row as though a human had clicked it — the `change` event matters:
   *  the host sheet's own count badge listens for it, and setting `.checked`
   *  from script fires nothing. */
  function tick(li: HTMLElement) {
    const box = li.querySelector<HTMLInputElement>('.cn-check');
    if (!box || box.checked) return;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function createConstellation() {
    if (!newName || !newSave) return;
    const name = newName.value.trim();
    if (!name) return; // an empty name isn't an error, it's a non-action

    // De-dupe on NAME, client-side, because the server doesn't. `save` de-dupes
    // SLUGS (a second "Grief" becomes `grief-2`), which is right for URLs and
    // wrong for this: typing a name you already have would silently give you
    // two identical-looking constellations, and you'd only find out later when
    // half your fragments were in the wrong one. Ticking the existing row is
    // what you meant, so do that and say so.
    const existing = rowNamed(name);
    if (existing) {
      tick(existing);
      say('Already in the sky — ticked it');
      foldForm(false);
      return;
    }

    const fd = new FormData();
    fd.set('name', name); // status defaults to draft; colour is auto-picked
    // The button used to be disabled before an unguarded await, so a dead
    // network took the footer's Create away for the life of the sheet and said
    // nothing about why. `submitAction` owns both halves of that lifecycle.
    const res = await submitAction(() => actions.constellations.save(fd), {
      button: newSave,
      onError: (m) => say(m, true),
      reusable: true, // the footer stays on screen; it is not replaced by a save
    });
    if (!res.ok) return;
    if (!res.data) return say('Something went wrong.', true);

    const made = { id: res.data.id, name, slug: res.data.slug };
    tick(addRow(made));
    foldForm(false);
    // `tick` fired `change`, which ran the persist/queue path above — so this
    // only has to name what happened. A brand-new fragment has no id yet and
    // the tick is queued; `flush` writes it the moment the first save mints one.
    if (!fragmentId) say('Will be added when you save');

    // Tell the rest of the page. Every other control built from "all
    // constellations" — the sibling picker, the browser's filter select — is
    // server-rendered once and would otherwise not know this exists until a
    // reload, which is the exact complaint this piece answers.
    announceSkyChange(made);
  }

  newSave?.addEventListener('click', () => void createConstellation());
  // Enter submits. This is a <div>, not a <form> (it is mounted inside the
  // sheet's form), so there is no implicit submission to inherit — and the
  // keydown must be stopped or it would submit the FRAGMENT instead.
  newName?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void createConstellation();
  });

  // The other half of the broadcast: a constellation made in the SIBLING sheet's
  // picker has to appear here too, or the two pickers disagree about what the
  // sky contains and only one of them is right.
  onSkyChange((c) => {
    if (list.querySelector(`.cn-row[data-id="${CSS.escape(c.id)}"]`)) return;
    addRow(c);
  });

  return {
    setFragment(id, memberIds) {
      fragmentId = id;
      dirty = false;
      const want = new Set(memberIds);
      boxes().forEach((b) => (b.checked = want.has(b.value)));
      foldForm(false);
      say('');
    },
    async flush(newId) {
      fragmentId = newId;
      if (!selected().length) return true; // nothing queued
      failed = false;
      persist();
      await inFlight;
      return !failed;
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
