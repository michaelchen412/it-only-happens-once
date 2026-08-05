// Wiring for a ConstellationPicker instance — the fragment→constellation view
// inside an editor sheet. See the component for the design rationale.
//
// Contract:
//   setFragment(id | null, memberIds)  — call on every sheet open
//   flush(newId)                       — call right after a first save
//   changed()                          — did membership change while open?
import { actions } from 'astro:actions';
import { formatActionError } from './action-error';
import { announceSkyChange, onSkyChange, type SkyConstellation } from './sky-changed';

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
  const list = root.querySelector('.cn-list') as HTMLElement;
  const filter = root.querySelector<HTMLInputElement>('.cn-filter');
  const noneHint = root.querySelector<HTMLElement>('.cn-none');

  let fragmentId: string | null = null;
  let dirty = false;
  let inFlight: Promise<unknown> = Promise.resolve();

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

  // Filter — rendered always, hidden below the threshold, so a sky that GROWS
  // past it mid-session (which is now possible from the footer below) gets its
  // filter without a reload. Hidden rows keep their checkbox state: they're
  // still in the DOM, so selected() stays complete.
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

  /** Reveal the filter once the sky outgrows what you can scan at a glance. */
  function syncFilterVisibility() {
    if (!filter) return;
    const threshold = Number(filter.dataset.threshold ?? 8);
    filter.hidden = list.querySelectorAll('.cn-row').length <= threshold;
  }

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
         class="cn-open text-base-content/40 hover:text-base-content shrink-0 px-2 py-2 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
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
    syncFilterVisibility();
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

    newSave.disabled = true;
    const fd = new FormData();
    fd.set('name', name); // status defaults to draft; colour is auto-picked
    const { data, error } = await actions.constellations.save(fd);
    newSave.disabled = false;
    if (error || !data) return say(formatActionError(error), true);

    const made = { id: data.id, name, slug: data.slug };
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
