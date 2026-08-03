// Client logic for TimelineZone.astro — the log box (12 · Piece 2).
//
// THE DOM IS THE STATE, as everywhere else in HQ: the kind lives in the chip's
// `is-on` row, the date in its label, the participants in the picker's ticks.
// There is no JavaScript copy of the entry beside the entry.
//
// ONE EDITOR, TWO JOBS. Editing an existing entry loads it back into the same
// box rather than opening a second one. A profile with two places to type is a
// profile where you have to decide which one to use, and the box is meant to
// cost fifteen seconds.
//
// AND SAVING IS EXPLICIT, unlike the check-in. That surface autosaves because it
// is one row per day that you return to; an entry is a discrete thing you
// finish, and a debounce would mean a half-typed sentence became a row every
// time the phone locked.
import { actions } from 'astro:actions';
import { confirmDialog } from './confirm-dialog';

const zone = document.querySelector<HTMLElement>('[data-timeline]');

if (zone) {
  const personId = zone.dataset.personId!;
  const today = zone.dataset.today!;

  const $ = <T extends HTMLElement>(sel: string) => zone.querySelector<T>(sel);
  const $$ = <T extends HTMLElement>(sel: string) => Array.from(zone.querySelectorAll<T>(sel));

  const input = $<HTMLTextAreaElement>('[data-log-input]')!;
  const meta = $<HTMLElement>('[data-log-meta]')!;
  const saveBtn = $<HTMLButtonElement>('[data-log-save]')!;
  const cancelBtn = $<HTMLButtonElement>('[data-log-cancel]')!;
  const errorEl = $<HTMLElement>('[data-log-error]')!;
  const kindLabel = $<HTMLElement>('[data-kind-label]')!;
  const kindIcon = $<HTMLElement>('[data-kind-icon]')!;
  const dateLabel = $<HTMLElement>('[data-date-label]')!;
  const withLabel = $<HTMLElement>('[data-with-label]');

  /** The entry being corrected, or null when writing a new one. */
  let editingId: string | null = null;
  /** The chosen date, as a local `YYYY-MM-DD`. */
  let occurredOn = today;

  const shiftYmd = (ymd: string, n: number) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  function showError(message: string | null) {
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
  }

  /** One line until there are two. Reset first, or it can only ever grow. */
  function grow() {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }

  function syncControls() {
    const has = input.value.trim().length > 0;
    meta.hidden = !has && !editingId;
    saveBtn.hidden = !has && !editingId;
    cancelBtn.hidden = !editingId;
  }

  input.addEventListener('input', () => {
    grow();
    syncControls();
  });

  // ── the pickers ──────────────────────────────────────────────────────────
  // Opening, closing, Escape, light-dismiss and one-at-a-time all belong to the
  // browser (`popovertarget` + `popover="auto"`). All that is left is putting
  // it in the right place, because the top layer has no idea what it is
  // anchored to. See trap 7 in app.css for why it has to be the top layer.
  const pops = $$<HTMLElement>('[data-pop]');
  const closePops = () => pops.forEach((p) => p.matches(':popover-open') && p.hidePopover());

  const GAP = 6;
  for (const pop of pops) {
    // ⚠ TWO EVENTS, AND IT HAS TO BE TWO. `beforetoggle` fires while the
    // popover is still `display: none`, so measuring it there returns 0×0 —
    // and a clamp computed against a width of zero does nothing at all. That is
    // not a theoretical worry: it put the people picker 23px off the right edge
    // at 390px, and the version of this code in the lab passed its own mobile
    // spec by luck, because that trigger happened to sit further left.
    //
    // So: hide it before it opens, measure and place it once it HAS opened,
    // then reveal. `visibility` rather than `hidden`, because the element must
    // still take part in layout to have a size worth measuring.
    pop.addEventListener('beforetoggle', (e) => {
      if ((e as ToggleEvent).newState === 'open') pop.style.visibility = 'hidden';
    });

    pop.addEventListener('toggle', (e) => {
      if ((e as ToggleEvent).newState !== 'open') return;
      const trigger = zone.querySelector<HTMLElement>(`[popovertarget="${pop.id}"]`);
      if (!trigger) return;
      const t = trigger.getBoundingClientRect();
      const { width, height } = pop.getBoundingClientRect();

      // Below by default; above only when below genuinely does not fit.
      const below = t.bottom + GAP;
      const fits = below + height <= window.innerHeight - GAP;
      pop.style.top = `${fits ? below : Math.max(GAP, t.top - GAP - height)}px`;
      // Clamped horizontally, or the people picker runs off the edge at 390px.
      pop.style.left = `${Math.min(Math.max(GAP, t.left), Math.max(GAP, window.innerWidth - width - GAP))}px`;
      pop.style.visibility = '';
    });
  }

  // kind
  $$<HTMLButtonElement>('[data-kind]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('[data-kind]').forEach((o) => o.classList.toggle('is-on', o === btn));
      kindLabel.textContent = btn.textContent!.trim();
      // The glyph is copied out of the chosen row into a wrapper that STAYS —
      // replacing the element itself would destroy the `[data-kind-icon]` hook,
      // so the second choice you made would silently do nothing.
      const svg = btn.querySelector('svg');
      if (svg) kindIcon.replaceChildren(svg.cloneNode(true));
      closePops();
    }),
  );

  // date
  const setDate = (ymd: string, label: string) => {
    occurredOn = ymd;
    dateLabel.textContent = label;
  };
  $$<HTMLButtonElement>('[data-day]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('[data-day]').forEach((o) => o.classList.toggle('is-on', o === btn));
      setDate(shiftYmd(today, -Number(btn.dataset.day)), btn.textContent!.trim());
      closePops();
    }),
  );
  $<HTMLInputElement>('[data-date-input]')?.addEventListener('change', (e) => {
    const value = (e.target as HTMLInputElement).value;
    if (!value) return;
    $$('[data-day]').forEach((o) => o.classList.remove('is-on'));
    const d = new Date(`${value}T00:00:00Z`);
    setDate(value, `${d.getUTCMonth() + 1}/${d.getUTCDate()}`);
    closePops();
  });

  // with — multi-select. The label COUNTS rather than listing, so three names
  // cannot push the meta row past the box at 390px.
  const chosen = new Set<string>();
  function syncWith() {
    if (!withLabel) return;
    const names = [...chosen].map((id) => $<HTMLElement>(`[data-with="${id}"]`)?.dataset.name ?? '');
    withLabel.textContent =
      names.length === 0 ? 'with' : names.length === 1 ? `with ${names[0]}` : `with ${names[0]} +${names.length - 1}`;
    $('[data-with-open]')?.classList.toggle('lchip--on', names.length > 0);
  }
  $$<HTMLButtonElement>('[data-with]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.with!;
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      btn.classList.toggle('is-on', chosen.has(id));
      syncWith();
    }),
  );

  // ── writing, and correcting ──────────────────────────────────────────────
  function reset() {
    editingId = null;
    input.value = '';
    occurredOn = today;
    chosen.clear();
    $$('[data-with]').forEach((o) => o.classList.remove('is-on'));
    $$('[data-kind]').forEach((o, i) => o.classList.toggle('is-on', i === 0));
    $$('[data-day]').forEach((o, i) => o.classList.toggle('is-on', i === 0));
    kindLabel.textContent = 'Hangout';
    dateLabel.textContent = 'Today';
    const first = $<HTMLElement>('[data-kind="hangout"] svg');
    if (first) kindIcon.replaceChildren(first.cloneNode(true));
    syncWith();
    showError(null);
    grow();
    syncControls();
  }

  cancelBtn.addEventListener('click', () => {
    reset();
    zone.querySelectorAll('.tl').forEach((r) => r.classList.remove('is-editing'));
  });

  $$<HTMLButtonElement>('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const row = btn.closest<HTMLElement>('.tl')!;
      reset();
      editingId = row.dataset.entry!;
      input.value = row.dataset.body ?? '';

      const on = row.dataset.entryOn!;
      const label = on === today ? 'Today' : on === shiftYmd(today, -1) ? 'Yesterday' : null;
      const d = new Date(`${on}T00:00:00Z`);
      setDate(on, label ?? `${d.getUTCMonth() + 1}/${d.getUTCDate()}`);
      $$('[data-day]').forEach((o) => o.classList.remove('is-on'));

      const kindBtn = $<HTMLButtonElement>(`[data-kind="${row.dataset.entryKind}"]`);
      kindBtn?.click(); // reuses the same label + glyph swap
      closePops();

      for (const id of (row.dataset.entryWith ?? '').split(',').filter(Boolean)) {
        chosen.add(id);
        $(`[data-with="${id}"]`)?.classList.add('is-on');
      }
      syncWith();

      zone.querySelectorAll('.tl').forEach((r) => r.classList.toggle('is-editing', r === row));
      grow();
      syncControls();
      input.focus();
    }),
  );

  saveBtn.addEventListener('click', async () => {
    const body = input.value.trim();
    if (!body) return;
    showError(null);
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const { error } = await actions.interactions.save({
        id: editingId ?? undefined,
        personId,
        withIds: [...chosen],
        occurredOn,
        kind: ($('[data-kind].is-on') as HTMLElement | null)?.dataset.kind as never,
        body,
      });
      if (error) throw new Error(error.message);
      // Reload rather than patching: the count, the ordering, the last-contact
      // fact in the header and the card on the roster are all functions of the
      // row that just changed, and re-deriving four of them by hand is four
      // chances to disagree with the database.
      location.reload();
    } catch (err) {
      // ⚠ `astro:actions` THROWS on a dead network rather than returning
      // `{ error }` — the trap that once left a button stuck on "Thinking…"
      // for the life of the page.
      showError(err instanceof Error ? err.message : 'Couldn’t save — check your connection.');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  $$<HTMLButtonElement>('[data-delete]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const row = btn.closest<HTMLElement>('.tl')!;
      const ok = await confirmDialog({
        title: 'Delete this entry?',
        message: 'It is removed for good — there is no trash for log entries.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;

      const { error } = await actions.interactions.remove({ id: row.dataset.entry! });
      if (error) {
        showError(error.message);
        return;
      }
      location.reload();
    }),
  );

  grow();
  syncControls();
}
