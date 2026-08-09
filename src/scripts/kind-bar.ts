// Shared behaviour for KindBar.astro, and the one place a parsed dump is
// carried between the two sheets (14 · Piece 3).
//
// Both sheets mount a bar; each knows only its own kind and hands the switch
// back to the pile (`hq:kind-switch`), which decides what to open. Neither
// sheet imports the other, and neither knows what a brain dump is.

/** What the pile hands a sheet when a dump is on its way to the Agenda. */
export interface FilingDetail {
  noteId: string;
  /** The dump's own words — the fallback when the model said nothing. */
  text: string;
  /** Null when the parse failed, was skipped, or no key is configured. */
  parsed: ParsedFields | null;
  /** Derived server-side from the fields; never written by the model. */
  why: string;
}

export interface Read<T> {
  value: T;
  from: string;
}

export interface ParsedFields {
  kind: 'task' | 'event';
  title: string | null;
  notes: string | null;
  due_on: Read<string> | null;
  due_time: Read<string> | null;
  lead_days: Read<number> | null;
  recurrence: Read<string> | null;
  effort: Read<string> | null;
  priority: Read<string> | null;
  unschedulable: string | null;
  ambiguous: string | null;
}

/**
 * Wire the bar inside one sheet. Returns a setter the sheet calls when it opens.
 *
 * ⚠ THE SWITCH CARRIES THE WHOLE PARSE ACROSS, not just the kind. Re-reading
 * the sentence would cost another call and could return a different answer —
 * so pressing "make it an event instead" moves the same fields into the other
 * form, which is what a one-tap correction has to mean.
 *
 * ⚠ `onSwitch` MUST CLOSE ITS OWN SHEET, and the contract lives here because it
 * is invisible from either end. This module deliberately knows nothing about
 * what a switch opens — it announces, and the pile decides — but the pile
 * answers by calling `showModal()` on the other `<dialog>`, and a second
 * `showModal()` STACKS rather than replaces. So a bar that only announced left
 * two modals on screen, the stale populated one revealed again the moment you
 * closed the new one. Closing here rather than in the pile keeps the rule
 * "whoever opened it closes it" intact, and it is the reason this note is
 * attached to the callback instead of to either caller.
 */
export function mountKindBar(
  root: ParentNode,
  onSwitch: (detail: FilingDetail, to: 'task' | 'event') => void,
): (detail: FilingDetail | null) => void {
  const bar = root.querySelector<HTMLElement>('[data-kindbar]');
  if (!bar) return () => {};
  const why = bar.querySelector<HTMLElement>('[data-kind-why]')!;
  const self = bar.dataset.self as 'task' | 'event';
  let current: FilingDetail | null = null;

  bar.querySelector<HTMLButtonElement>('[data-kind-switch]')?.addEventListener('click', () => {
    if (current) onSwitch(current, self === 'task' ? 'event' : 'task');
  });

  return (detail: FilingDetail | null) => {
    current = detail;
    // Absent unless a reading actually happened. A task typed by hand is not a
    // judgement anybody made, so there is nothing to explain or to undo.
    bar.hidden = !detail?.parsed;
    why.textContent = detail?.why ?? '';
  };
}

/** `HH:MM` from the parse, or '' — the sheets' time inputs want exactly this. */
export const timeValue = (r: Read<string> | null) => r?.value ?? '';

/**
 * The line under a field saying which words produced it (§6.3).
 *
 * ⚠ THE PROVENANCE IS THE POINT, not decoration. "2026-08-06 — read from
 * *every Thursday*" can be judged at a glance; a date on its own cannot be
 * judged at all, and a silently misparsed date is worse than no parse (§6.2).
 */
export function showFrom(root: ParentNode, field: string, r: Read<unknown> | null): void {
  const el = root.querySelector<HTMLElement>(`[data-parsed-from="${field}"]`);
  if (!el) return;
  el.textContent = r ? `read from “${r.from}”` : '';
  el.hidden = !r;
}
