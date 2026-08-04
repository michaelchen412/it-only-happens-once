// Anchoring a top-layer popover to the control that opened it.
//
// Extracted from `log-box.ts` on 2026-08-03 when the notes room's triage
// chooser needed the same thing (14 · Piece 2). It is a **pure move** — the
// arithmetic below is character-for-character what the log box has been running
// since 12 · Piece 2 — and it was extracted rather than copied because the one
// thing in here that matters is a bug you re-earn every time you rewrite it.
//
// WHY THE TOP LAYER AT ALL: trap 7 in app.css. A popover anchored inside a
// `.zone` is either covered by the sticky header or clipped by the zone's
// `overflow: hidden` — inert either way, and invisible to typecheck, build and
// a screenshot. `popover="auto"` hands opening, closing, Escape, light-dismiss
// and one-at-a-time to the browser. All that is left is placement, because the
// top layer has no idea what it is anchored to.
const GAP = 6;

/**
 * Place `pop` under (or over) whatever `triggerFor` says opened it.
 *
 * ⚠ TWO EVENTS, AND IT HAS TO BE TWO. `beforetoggle` fires while the popover is
 * still `display: none`, so measuring it there returns 0×0 — and a clamp
 * computed against a width of zero does nothing at all. That is not a
 * theoretical worry: it put the people picker 23px off the right edge at 390px,
 * and the version of this code in the lab passed its own mobile spec by luck,
 * because that trigger happened to sit further left.
 *
 * So: hide it before it opens, measure and place it once it HAS opened, then
 * reveal. `visibility` rather than `hidden`, because the element must still
 * take part in layout to have a size worth measuring.
 *
 * `triggerFor` is a callback rather than an element because the two callers
 * differ in kind: the log box has one fixed trigger per popover, while the
 * notes room has one popover shared by every card in the pile and has to say
 * which card opened it.
 */
export function anchorPopover(pop: HTMLElement, triggerFor: () => HTMLElement | null | undefined): void {
  pop.addEventListener('beforetoggle', (e) => {
    if ((e as ToggleEvent).newState === 'open') pop.style.visibility = 'hidden';
  });

  pop.addEventListener('toggle', (e) => {
    if ((e as ToggleEvent).newState !== 'open') return;
    const trigger = triggerFor();
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
