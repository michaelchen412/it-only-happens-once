/**
 * The sky's colour ramp — stellar temperature, hot → cool (design.md §13).
 *
 * THE ONE SOURCE for the slot NAMES. Three things must agree, and only this
 * file is importable by the other two's authors:
 *   1. this list                    — validation + the composer's swatches
 *   2. the `color` check constraint — migration `constellation_color_slot`
 *   3. the `.cn-*` rules            — src/styles/app.css (which owns the VALUES)
 *
 * Adding a slot means touching all three; there is no way to make the database
 * and the stylesheet import from here, so the comment is the seam.
 */
export const COLOR_SLOTS = ['violet', 'ice', 'azure', 'gold', 'amber', 'sand', 'ember', 'rose'] as const;

export type ColorSlot = (typeof COLOR_SLOTS)[number];

/** The slot a new constellation should take: the least-used, ties → hottest. */
export function leastUsedSlot(taken: readonly (string | null | undefined)[]): ColorSlot {
  const uses = new Map<ColorSlot, number>(COLOR_SLOTS.map((c) => [c, 0]));
  for (const t of taken) {
    if (t && uses.has(t as ColorSlot)) uses.set(t as ColorSlot, (uses.get(t as ColorSlot) ?? 0) + 1);
  }
  return COLOR_SLOTS.reduce((best, c) => ((uses.get(c) ?? 0) < (uses.get(best) ?? 0) ? c : best), COLOR_SLOTS[0]);
}
