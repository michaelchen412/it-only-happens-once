// Client logic for TaskSheet.astro (docs/plans/13-agenda.md §3a, §4).
//
// TWO LIVE MECHANICS, and they are the work of this piece — neither is
// decoration. Effort→lead and recurrence are rules whose whole effect is
// invisible until something appears on Today weeks later, so:
//
//   · the lead sentence names a real DATE, live, as you change either control
//   · a schedule shows the next three occurrences it actually produces
//
// ⚠ BOTH RUN THE SAME FUNCTIONS THE SERVER RUNS (src/lib/hq/tasks.ts and
// recurrence.ts). A lead computed one way here and another way in the action
// would be a rule nobody could trust, and this rule's entire problem is that it
// is unverifiable by eye.
//
// The DOM is the state, as everywhere else in HQ: the selected segment lives in
// `aria-pressed`, the date lives in the date input. There is no JavaScript copy
// of the form beside the form.
import { actions } from 'astro:actions';
import { leadFor, leadLine, type Effort, type Priority } from '../lib/hq/tasks';
import { nextOccurrences, presetLabel, rruleFor, PRESETS, type Preset } from '../lib/hq/recurrence';
import { ordinal } from '../lib/hq/dates';
import { ymdToUtc, type Ymd } from '../lib/hq/time';

const sheet = document.querySelector<HTMLDialogElement>('#task-sheet');
const form = document.querySelector<HTMLFormElement>('#task-form');

if (sheet && form) {
  const today = form.dataset.today as Ymd;
  const errorEl = document.querySelector<HTMLElement>('#task-error');
  const heading = document.querySelector<HTMLElement>('#task-sheet-title')!;
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const deleteBtn = form.querySelector<HTMLButtonElement>('[data-delete]')!;
  const titleInput = form.querySelector<HTMLInputElement>('input[name="title"]')!;
  const notesInput = form.querySelector<HTMLTextAreaElement>('textarea[name="notes"]')!;
  const dueInput = form.querySelector<HTMLInputElement>('[data-due]')!;
  const timeInput = form.querySelector<HTMLInputElement>('[data-time]')!;
  const anytime = form.querySelector<HTMLElement>('[data-anytime]')!;
  const overrideOn = form.querySelector<HTMLInputElement>('[data-override-on]')!;
  const overrideN = form.querySelector<HTMLInputElement>('[data-override-n]')!;
  const everyInput = form.querySelector<HTMLInputElement>('[data-every]')!;
  const presetSel = form.querySelector<HTMLSelectElement>('[data-preset]')!;
  const leadLineEl = form.querySelector<HTMLElement>('[data-lead-line]')!;
  const prevEl = form.querySelector<HTMLElement>('[data-prev]')!;

  /** The row's JSON — every column, so the form and the row cannot disagree. */
  interface TaskRow {
    id: string;
    title: string;
    notes: string | null;
    due_on: Ymd | null;
    due_time: string | null;
    priority: Priority;
    effort: Effort;
    lead_days: number | null;
    recur_mode: 'after_completion' | 'fixed' | null;
    /** Already resolved server-side — no RRULE string reaches the browser. */
    preset: Preset | null;
    recur_every: number | null;
    recur_unit: 'days' | 'weeks' | 'months' | null;
  }

  let editing: string | null = null;

  const showError = (message: string | null) => {
    if (!errorEl) return;
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
  };

  // ── segmented controls ────────────────────────────────────────────────────
  const group = (attr: string) => Array.from(form.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`));
  const pick = (attr: string, value: string) =>
    group(attr).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  const picked = (attr: string, fallback: string) =>
    group(attr).find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset[attr] ?? fallback;

  // ── the two live mechanics ────────────────────────────────────────────────

  /** `Fri, Aug 7th` — a date you can judge, not "7 days". */
  const pretty = (ymd: Ymd) => {
    const d = ymdToUtc(ymd);
    const dow = d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
    const month = d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });
    return `${dow}, ${month} ${ordinal(d.getUTCDate())}`;
  };

  const paintLead = () => {
    const due = dueInput.value;
    if (!due) return;
    const lead = leadFor({
      effort: picked('effort', 'sitting') as Effort,
      priority: picked('prio', 'normal') as Priority,
      lead_days: overrideOn.checked ? Math.max(0, Number(overrideN.value) || 0) : null,
    });
    const line = leadLine(due, lead, today);
    const days = `${line.days} day${line.days === 1 ? '' : 's'} ahead`;
    // A lead reaching back past today is the COMMON case for a project (21
    // days), and naming a date that has gone by reads as a bug. Say what is
    // true instead.
    leadLineEl.innerHTML = line.alreadyOn
      ? `<strong>Already on Today</strong> — ${days}`
      : `On Today from <strong>${pretty(line.from)}</strong> — ${days}`;
  };

  const paintRepeat = () => {
    const mode = picked('rep', 'none');
    form.querySelectorAll<HTMLElement>('[data-rep-panel]').forEach((p) => {
      p.hidden = p.dataset.repPanel !== mode;
    });
    const due = dueInput.value;
    if (!due) return;

    // The names are rebuilt from the date: "every Monday" is only true while
    // the date is a Monday, and a stale label is a rule you would pick wrongly.
    const chosen = presetSel.value as Preset;
    Array.from(presetSel.options).forEach((opt) => {
      opt.textContent = presetLabel(opt.value as Preset, due);
    });
    presetSel.value = chosen;

    if (mode !== 'fixed') return;
    const dates = nextOccurrences(rruleFor(chosen, due), due, 3);
    prevEl.textContent = dates.length ? `Next: ${dates.map(pretty).join('  ·  ')}` : '';
  };

  /** A lead and a recurrence are both functions of a date. No date, no section. */
  const paintDated = () => {
    const has = !!dueInput.value;
    form.querySelectorAll<HTMLElement>('[data-dated]').forEach((el) => (el.hidden = !has));
    anytime.hidden = !has || !!timeInput.value;
    timeInput.disabled = !has;
    if (!has) pick('rep', 'none');
  };

  const repaint = () => {
    paintDated();
    paintLead();
    paintRepeat();
  };

  // ── opening ───────────────────────────────────────────────────────────────

  /** Back to a blank sheet. Called on every open, so nothing leaks between tasks. */
  const reset = () => {
    editing = null;
    form.reset();
    titleInput.value = '';
    notesInput.value = '';
    dueInput.value = '';
    timeInput.value = '';
    pick('effort', 'sitting');
    pick('prio', 'normal');
    pick('rep', 'none');
    pick('unit', 'weeks');
    overrideOn.checked = false;
    overrideN.disabled = true;
    overrideN.value = '3';
    everyInput.value = '2';
    presetSel.selectedIndex = 0;
    heading.textContent = 'New task';
    submitBtn.textContent = 'Add task';
    deleteBtn.hidden = true;
  };

  const fill = (row: TaskRow) => {
    reset();
    editing = row.id;
    titleInput.value = row.title;
    notesInput.value = row.notes ?? '';
    dueInput.value = row.due_on ?? '';
    timeInput.value = row.due_time ? row.due_time.slice(0, 5) : '';
    pick('effort', row.effort);
    pick('prio', row.priority);
    if (row.lead_days != null) {
      overrideOn.checked = true;
      overrideN.disabled = false;
      overrideN.value = String(row.lead_days);
    }
    if (row.recur_mode === 'after_completion') {
      pick('rep', 'after');
      everyInput.value = String(row.recur_every ?? 2);
      pick('unit', row.recur_unit ?? 'weeks');
    } else if (row.recur_mode === 'fixed') {
      pick('rep', 'fixed');
      // Resolved on the server by generating all six rules and comparing — not
      // by parsing `BYDAY=-1FR` back, which is one more thing that can be
      // subtly wrong. No match leaves the first preset selected rather than
      // guessing at what the rule meant.
      if (row.preset) presetSel.value = row.preset;
    }
    heading.textContent = 'Edit task';
    submitBtn.textContent = 'Save';
    deleteBtn.hidden = false;
  };

  const open = (row?: TaskRow) => {
    showError(null);
    if (row) fill(row);
    else reset();
    repaint();
    sheet!.showModal();
    titleInput.focus();
  };

  document.querySelectorAll<HTMLElement>('[data-open-task-sheet]').forEach((btn) =>
    btn.addEventListener('click', () => open()),
  );
  // Delegated: the rows are re-rendered by a reload, and a listener per row
  // would need re-binding every time.
  document.addEventListener('click', (e) => {
    const trigger = (e.target as Element).closest<HTMLElement>('[data-edit-task]');
    if (!trigger) return;
    const raw = trigger.closest<HTMLElement>('[data-task]')?.dataset.task;
    if (raw) open(JSON.parse(raw) as TaskRow);
  });

  form.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => sheet.close()));

  // ── wiring ────────────────────────────────────────────────────────────────
  group('effort').forEach((b) => b.addEventListener('click', () => (pick('effort', b.dataset.effort!), paintLead())));
  group('prio').forEach((b) => b.addEventListener('click', () => (pick('prio', b.dataset.prio!), paintLead())));
  group('unit').forEach((b) => b.addEventListener('click', () => pick('unit', b.dataset.unit!)));
  group('rep').forEach((b) => b.addEventListener('click', () => (pick('rep', b.dataset.rep!), paintRepeat())));

  dueInput.addEventListener('input', repaint);
  timeInput.addEventListener('input', () => (anytime.hidden = !!timeInput.value));
  form.querySelector<HTMLButtonElement>('[data-clear-time]')!.addEventListener('click', () => {
    timeInput.value = '';
    anytime.hidden = !dueInput.value;
  });
  overrideOn.addEventListener('change', () => {
    overrideN.disabled = !overrideOn.checked;
    paintLead();
  });
  overrideN.addEventListener('input', paintLead);
  presetSel.addEventListener('change', paintRepeat);

  // ── saving ────────────────────────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(null);

    const repeat = picked('rep', 'none') as 'none' | 'after' | 'fixed';
    submitBtn.disabled = true;
    const label = submitBtn.textContent;
    submitBtn.textContent = 'Saving…';

    try {
      const { error } = await actions.tasks.save({
        id: editing ?? undefined,
        title: titleInput.value.trim(),
        notes: notesInput.value.trim(),
        dueOn: dueInput.value,
        dueTime: timeInput.value,
        priority: picked('prio', 'normal') as Priority,
        effort: picked('effort', 'sitting') as Effort,
        leadDays: overrideOn.checked ? overrideN.value : '',
        repeat,
        every: repeat === 'after' ? everyInput.value : '',
        unit: repeat === 'after' ? (picked('unit', 'weeks') as 'days' | 'weeks' | 'months') : undefined,
        preset: repeat === 'fixed' ? (presetSel.value as (typeof PRESETS)[number]) : undefined,
      });
      if (error) throw new Error(error.message);
      // Reload rather than patching: which GROUP a task belongs to, how late it
      // is, and the counts beside every heading are all functions of the row
      // that just changed. Re-deriving four of them by hand is four chances to
      // disagree with the database.
      location.reload();
    } catch (err) {
      // ⚠ `astro:actions` THROWS on a dead network rather than returning
      // `{ error }` — without this catch the button sticks on "Saving…" and the
      // sheet silently swallows the task.
      showError(err instanceof Error ? err.message : 'Couldn’t save that — check your connection.');
      submitBtn.disabled = false;
      submitBtn.textContent = label;
    }
  });

  // ── deleting ──────────────────────────────────────────────────────────────
  deleteBtn.addEventListener('click', async () => {
    if (!editing) return;
    // A real confirm: unlike a disposition, this one cannot be taken back, and
    // the dispositions go with it.
    const { confirmDialog } = await import('./confirm-dialog');
    const ok = await confirmDialog({
      title: 'Delete this task?',
      message: 'Its record of what you did and skipped goes with it.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    deleteBtn.disabled = true;
    try {
      const { error } = await actions.tasks.remove({ id: editing });
      if (error) throw new Error(error.message);
      location.reload();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Couldn’t delete that — check your connection.');
      deleteBtn.disabled = false;
    }
  });
}
