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
// `aria-checked`, the date lives in the date input. There is no JavaScript copy
// of the form beside the form.
import { actions } from 'astro:actions';
import { wireRadioGroups } from './radio-group';
import { submitAction } from './action-error';
import { closeWithExit, openDialog } from './dialog-close';
import { confirmDiscard, dirtyTracker, wireSheetDismiss } from './sheet-dismiss';
import { sheetError } from './sheet-error';
import { leadFor, leadLine, type Effort, type Priority } from '../lib/hq/tasks';
import { nextOccurrences, presetLabel, rruleFor, PRESETS, type Preset } from '../lib/hq/recurrence';
import { ordinal } from '../lib/hq/dates';
import { ymdToUtc, type Ymd } from '../lib/hq/time';
import { mountKindBar, showFrom, timeValue, type FilingDetail } from './kind-bar';

const sheet = document.querySelector<HTMLDialogElement>('#task-sheet');
const form = document.querySelector<HTMLFormElement>('#task-form');

if (sheet && form) {
  /** Every gesture that leaves this sheet routes through `requestClose` below. */
  const dirty = dirtyTracker(sheet);

  const today = form.dataset.today as Ymd;
  // BY ROLE, NOT BY THE NAME SOMEBODY GAVE IT (plan 29 · §6 + plan 38 · §3).
  // Twenty distinct element ids existed for this one job across the admin, which
  // is the reason there were 35 copies of the markup — every new sheet had to
  // mint a twenty-first. `SheetError.astro` owns the markup and this finds it
  // without needing to know what it is called.
  const errorEl = sheetError(sheet);
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
  /** Absent until goals exist — 13 · Piece 1 shipped with no goal field at all. */
  const goalSel = form.querySelector<HTMLSelectElement>('[data-goal-id]');

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
    goal_id?: string | null;
  }

  let editing: string | null = null;
  /**
   * The brain dump this task is being made out of, when the sheet was opened
   * from the notes room (14 · Piece 2). Null everywhere else, which is what
   * keeps the agenda room's behaviour — save, then reload — exactly as it was.
   */
  let filingNote: string | null = null;

  /**
   * The bar that says which row this is and offers the other in one tap.
   * The switch goes back to the pile rather than to the event sheet directly:
   * this file has no business knowing that an event sheet exists.
   */
  // ⚠ CLOSE FIRST, THEN ANNOUNCE — see `mountKindBar`'s note. The pile answers
  // the switch by opening the event sheet, and a second `showModal()` stacks
  // instead of replacing: without this line "make it an event instead" left
  // this sheet sitting underneath, still holding the same sentence.
  //
  // ⚠ AND "FIRST" IS NOW A PROMISE, NOT A STATEMENT ORDER — see the identical
  // note in `event-sheet.ts`. `closeWithExit` keeps this sheet open for the
  // length of its slide, so the announce has to wait for the slide.
  const setKindBar = mountKindBar(form, (detail, to) => {
    void closeWithExit(sheet!).then(() =>
      document.dispatchEvent(new CustomEvent('hq:kind-switch', { detail: { ...detail, to } })),
    );
  });

  const showError = (message: string | null) => {
    if (!errorEl) return;
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
  };

  // ── segmented controls ────────────────────────────────────────────────────
  const group = (attr: string) => Array.from(form.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`));
  const pick = (attr: string, value: string) =>
    group(attr).forEach((b) => b.setAttribute('aria-checked', String(b.dataset[attr] === value)));
  const picked = (attr: string, fallback: string) =>
    group(attr).find((b) => b.getAttribute('aria-checked') === 'true')?.dataset[attr] ?? fallback;

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
    if (goalSel) goalSel.value = '';
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
    if (goalSel) goalSel.value = row.goal_id ?? '';
    heading.textContent = 'Edit task';
    submitBtn.textContent = 'Save';
    deleteBtn.hidden = false;
  };

  const open = (row?: TaskRow) => {
    showError(null);
    if (row) fill(row);
    else reset();
    repaint();
    dirty.reset(); // populating is not editing — see dirtyTracker
    openDialog(sheet!);
    titleInput.focus();
  };

  document.querySelectorAll<HTMLElement>('[data-open-task-sheet]').forEach((btn) =>
    btn.addEventListener('click', () => {
      open();
      // On a goal's page, a new task belongs to that goal until you say
      // otherwise: it is the only reason you would press New from there.
      const preset = btn.dataset.openTaskSheet;
      if (preset && goalSel) goalSel.value = preset;
    }),
  );

  /**
   * Opened from the notes room with a brain dump in hand (14 · Piece 2).
   *
   * The whole sheet rather than a one-tap create, because a dump that says
   * *"call the dentist Friday"* wants Friday set in the same motion — and this
   * is the form where a date, an effort and a lead already live. Until
   * [14 · Piece 3] exists to read the sentence, you type them; after it, this
   * is the form it fills in.
   *
   * **The dump's FIRST LINE becomes the title and the rest becomes the notes.**
   * A task title is a row you scan on a Tuesday morning; a five-line thought
   * pasted into it would make the agenda unreadable, and dropping the rest
   * would lose what you actually wrote.
   */
  document.addEventListener('hq:task-open', (e) => {
    const detail = (e as CustomEvent<FilingDetail>).detail;
    open();
    filingNote = detail.noteId;
    heading.textContent = 'Make a task';

    const p = detail.parsed;
    // ⚠ THE FALLBACK IS THE SHIPPED BEHAVIOUR, not an error state. No key, a
    // dead model, a slow network — you get Piece 2's naive split and no message
    // about it, because a parser that makes the motion worse when it is absent
    // has failed at the one thing §6.4 asks of it.
    const [first, ...rest] = detail.text.split('\n');
    titleInput.value = (p?.title ?? first.trim()).slice(0, 200);
    notesInput.value = (p?.notes ?? rest.join('\n')).trim();

    if (p) {
      dueInput.value = p.due_on?.value ?? '';
      timeInput.value = timeValue(p.due_time);
      if (p.effort) pick('effort', p.effort.value);
      if (p.priority) pick('prio', p.priority.value);

      // ⚠ THE LEAD IS A PAIR, AND FILLING ONLY THE NUMBER DOES NOTHING. The
      // override is a checkbox AND a count; without the tick, `leadDays` is
      // sent blank and effort's default lead silently wins. "Warn me one day
      // ahead" would have warned three days ahead, for ever, with nothing on
      // screen disagreeing.
      if (p.lead_days) {
        overrideOn.checked = true;
        overrideN.disabled = false;
        overrideN.value = String(p.lead_days.value);
      }

      // A preset, never a rule string — 13 · Piece 1's contract, and the reason
      // the model was given the preset names as an enum rather than asked for
      // an RRULE it could invent.
      if (p.recurrence) {
        pick('rep', 'fixed');
        presetSel.value = p.recurrence.value;
      }

      showFrom(form, 'due_on', p.due_on);
      showFrom(form, 'due_time', p.due_time);
      const warn = form.querySelector<HTMLElement>('[data-parsed-warn]');
      if (warn) {
        // One line, not two: the schedule it could not express and the phrase
        // that reads two ways are both "this is not quite what you said".
        const note = p.unschedulable ? `Couldn’t schedule “${p.unschedulable}”` : p.ambiguous ? p.ambiguous : '';
        warn.textContent = note;
        warn.hidden = !note;
      }
      repaint(); // the lead sentence and the schedule preview are now stale
    }

    setKindBar(detail);
    titleInput.select(); // the likeliest thing to fix is the title it read
  });
  // Delegated: the rows are re-rendered by a reload, and a listener per row
  // would need re-binding every time.
  document.addEventListener('click', (e) => {
    const trigger = (e.target as Element).closest<HTMLElement>('[data-edit-task]');
    if (!trigger) return;
    const raw = trigger.closest<HTMLElement>('[data-task]')?.dataset.task;
    if (raw) open(JSON.parse(raw) as TaskRow);
  });

  /*
    ⚠ THE ✕, ESCAPE AND THE BACKDROP ALL MEAN "I WANT OUT" (ADR 0032). This
    sheet answered only the first for its whole life — clicking away did
    nothing at all, which reads as stuck and sends the reader to the browser's
    Back button, where far more is lost than the sheet would have cost.
  
    It guards because it has something to lose: an explicit-save form holds
    everything typed into it until you press the button. The confirm cannot
    fire on a sheet nobody edited — `dirtyTracker` is reset after every
    populate — so the cost of this is zero on the common path.
  */
  async function requestClose() {
    if (dirty.get() && !(await confirmDiscard('This task'))) return;
    dirty.reset();
    // `!` because a hoisted `async function` cannot inherit the narrowing
    // from the `if (sheet && …)` around it — the same reason this file already
    // writes `sheet!` at its other exits.
    void closeWithExit(sheet!);
  }
  wireSheetDismiss(sheet, requestClose);
  // ⚠ Abandoning the sheet must forget the dump it was opened for. Without
  // this, closing on a note and later saving an unrelated task from the same
  // page would consume a note nobody filed — a thought deleted by a save that
  // had nothing to do with it. `close` fires for Escape and the backdrop too.
  sheet.addEventListener('close', () => {
    filingNote = null;
    setKindBar(null);
  });

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
    // The disable/label/format/restore lifecycle is `submitAction` now
    // (docs/plans/25 · §2). `reusable`, because the notes-room ending below
    // CLOSES this sheet rather than replacing the page — and it is reopened for
    // the next dump, with the same button.
    const res = await submitAction(
      () =>
        actions.tasks.save({
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
          goalId: goalSel?.value ?? '',
        }),
      { button: submitBtn, busy: 'Saving…', onError: showError, reusable: true },
    );
    if (!res.ok) return;

    // ⚠ TWO ENDINGS, because the two rooms need opposite things.
    //
    // In the agenda room: reload. Which GROUP a task belongs to, how late it
    // is, and the counts beside every heading are all functions of the row
    // that just changed, and re-deriving four of them by hand is four chances
    // to disagree with the database.
    //
    // In the notes room: DON'T. A reload there would throw away the pile's
    // undo strip at the exact moment it has something to offer — and nothing
    // on that page is derived from the task at all. So the sheet announces
    // what happened and lets the pile do the tidying (scripts/notes.ts).
    if (filingNote) {
      const noteId = filingNote;
      filingNote = null;
      void closeWithExit(sheet!);
      document.dispatchEvent(
        new CustomEvent('hq:note-filed', {
          detail: { noteId, what: 'a task', href: '/admin/agenda/tasks', undo: { kind: 'task', id: res.data?.id } },
        }),
      );
      return;
    }
    location.reload();
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

    const id = editing; // captured: `editing` is a `let`, so the guard above
    // does not narrow it inside the callback below.
    const res = await submitAction(() => actions.tasks.remove({ id }), {
      button: deleteBtn,
      onError: showError,
    });
    if (!res.ok) return;
    location.reload();
  });
}

// The role promises arrow keys and one tab stop; this is what keeps it
// (plan 38 · §6.3). Idempotent — every group is wired exactly once.
wireRadioGroups();
