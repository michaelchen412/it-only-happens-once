// Client logic for LogSheet.astro — a brain dump becoming a log entry
// (14 · Piece 2).
//
// THE DOM IS THE STATE, as in the profile's log box: the kind lives in the
// chip's `is-on` row, the date in its label, the people in the picker's ticks.
// There is no JavaScript copy of the entry beside the entry.
//
// ⚠ IT ANNOUNCES RATHER THAN TIDIES. On a successful save this dispatches
// `hq:note-filed` and stops. Removing the card, consuming the note and offering
// the way back all belong to the pile (`notes.ts`), which owns those things for
// every motion — so there is exactly one implementation of "a dump left the
// pile" rather than one per destination.
import { actions } from 'astro:actions';
import { formatActionError } from './action-error';
import { anchorPopover } from './pop-anchor';
import { shiftYmd } from '../lib/hq/time';

const root = document.querySelector<HTMLElement>('[data-log-sheet]');
const sheet = document.getElementById('log-sheet') as HTMLDialogElement | null;

if (root && sheet) {
  const today = root.dataset.today!;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const $$ = <T extends HTMLElement>(sel: string) => Array.from(root.querySelectorAll<T>(sel));

  const body = $<HTMLTextAreaElement>('[data-log-body]')!;
  const saveBtn = $<HTMLButtonElement>('[data-log-save]')!;
  const errorEl = $<HTMLElement>('[data-log-error]')!;
  const whoLabel = $<HTMLElement>('[data-who-label]')!;
  const kindLabel = $<HTMLElement>('[data-kind-label]')!;
  const kindIcon = $<HTMLElement>('[data-kind-icon]')!;
  const dateLabel = $<HTMLElement>('[data-date-label]')!;

  /** The dump being filed. Null when the sheet is not open for one. */
  let noteId: string | null = null;
  let occurredOn = today;
  const chosen = new Set<string>();

  const pops = $$<HTMLElement>('[data-pop]');
  const closePops = () => pops.forEach((p) => p.matches(':popover-open') && p.hidePopover());
  for (const pop of pops) {
    anchorPopover(pop, () => root.querySelector<HTMLElement>(`[popovertarget="${pop.id}"]`));
  }

  function showError(msg: string | null) {
    errorEl.textContent = msg ?? '';
    errorEl.hidden = !msg;
  }

  // ── who ───────────────────────────────────────────────────────────────────
  // Multi-select, and the label COUNTS rather than listing — three names would
  // push the meta row past the box at 390px, which is the same reasoning the
  // log box's `with` picker records.
  function syncWho() {
    const names = [...chosen].map((id) => $<HTMLElement>(`[data-who="${id}"]`)?.dataset.name ?? '');
    whoLabel.textContent =
      names.length === 0 ? 'Who?' : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
    $('[data-who-open]')?.classList.toggle('lchip--on', names.length > 0);
    // The one required field, enforced by the control rather than by a sentence.
    saveBtn.disabled = chosen.size === 0 || !body.value.trim();
  }

  $$<HTMLButtonElement>('[data-who]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.who!;
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      btn.classList.toggle('is-on', chosen.has(id));
      syncWho();
    }),
  );

  // ── kind ──────────────────────────────────────────────────────────────────
  $$<HTMLButtonElement>('[data-kind]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('[data-kind]').forEach((o) => o.classList.toggle('is-on', o === btn));
      kindLabel.textContent = btn.textContent!.trim();
      // The glyph is cloned INTO a wrapper that stays. Replacing the element
      // would destroy the `[data-kind-icon]` hook, so the second choice you
      // made would silently do nothing — a bug the log box already paid for.
      const svg = btn.querySelector('svg');
      if (svg) kindIcon.replaceChildren(svg.cloneNode(true));
      closePops();
    }),
  );

  // ── date ──────────────────────────────────────────────────────────────────
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
    const el = e.target as HTMLInputElement;
    const value = el.value;
    if (!value) return;
    // ⚠ The same half-typed-year trap the log box paid for: a date input fires
    // `change` on every segment, so the first digit of the year reads as 0002
    // and used to close this picker mid-typing. The input's `min` makes those
    // partial years range errors; we wait them out. See log-box.ts.
    if (el.validity.rangeUnderflow) return;
    $$('[data-day]').forEach((o) => o.classList.remove('is-on'));
    const d = new Date(`${value}T00:00:00Z`);
    setDate(value, `${d.getUTCMonth() + 1}/${d.getUTCDate()}`);
    closePops();
  });

  body.addEventListener('input', syncWho);

  // ── opening ───────────────────────────────────────────────────────────────
  function reset() {
    chosen.clear();
    occurredOn = today;
    $$('[data-who]').forEach((o) => o.classList.remove('is-on'));
    $$('[data-kind]').forEach((o, i) => o.classList.toggle('is-on', i === 0));
    $$('[data-day]').forEach((o, i) => o.classList.toggle('is-on', i === 0));
    kindLabel.textContent = 'Hangout';
    dateLabel.textContent = 'Today';
    const first = $<HTMLElement>('[data-kind="hangout"] svg');
    if (first) kindIcon.replaceChildren(first.cloneNode(true));
    showError(null);
    syncWho();
  }

  /** Opened by the pile's chooser, with the dump's words already in the box. */
  document.addEventListener('hq:log-open', (e) => {
    const detail = (e as CustomEvent<{ noteId: string; text: string }>).detail;
    noteId = detail.noteId;
    reset();
    body.value = detail.text;
    syncWho();
    sheet!.showModal();
    // NOT focusing the textarea: the words are already there, and the thing
    // still missing is who it was about.
    $<HTMLElement>('[data-who-open]')?.focus();
  });

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => sheet.close()));
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.close();
  });

  // ── saving ────────────────────────────────────────────────────────────────
  saveBtn.addEventListener('click', async () => {
    const [personId, ...withIds] = [...chosen];
    if (!personId || !body.value.trim() || !noteId) return;

    saveBtn.disabled = true;
    const label = saveBtn.textContent;
    saveBtn.textContent = 'Saving…';
    showError(null);

    try {
      // `personId` is "whose profile this was logged from" — from the pile
      // there is no profile, so the first person picked stands in. The action
      // makes every id a participant either way, so which one leads changes
      // nothing about the row.
      const { data, error } = await actions.interactions.save({
        personId,
        withIds,
        occurredOn,
        kind: ($('[data-kind].is-on')?.dataset.kind ?? 'hangout') as 'hangout',
        body: body.value.trim(),
      });
      if (error || !data) throw new Error(error?.message ?? 'Couldn’t save that.');

      sheet!.close();
      document.dispatchEvent(
        new CustomEvent('hq:note-filed', {
          detail: { noteId, what: 'a log entry', href: null, undo: { kind: 'interaction', id: data.id } },
        }),
      );
      noteId = null;
    } catch (err) {
      // ⚠ `astro:actions` THROWS on a dead network rather than returning
      // `{ error }` — without this catch the button sticks on "Saving…" and the
      // sheet silently swallows the entry.
      showError(formatActionError(err));
      saveBtn.disabled = false;
      saveBtn.textContent = label;
    }
  });
}
