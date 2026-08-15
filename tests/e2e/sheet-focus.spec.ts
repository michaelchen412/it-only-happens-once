// Where focus lands when a sheet opens, and what it looks like when it gets
// there.
//
// ⚠ THE COMPLAINT, 2026-08-15. Michael: *"I keep noticing this ugly blue
// highlight. For example if I open up a sheet, I will see this ugly blue outline
// on the X button to close the sheet. I think that's probably just the first
// element of that UI element… Why is that UI element highlighted? It's not only
// kind of garish but it's just drawing attention away from the user."*
//
// He read it exactly right, and it was two separate faults wearing one symptom:
//
//   1. `showModal()` focuses the first focusable descendant, and in every sheet
//      in this building that is `SheetHeader`'s ✕ — the header is simply first
//      in the markup. So opening a document to READ it put focus on the one
//      control whose entire job is to leave, and announced "Close, button" to
//      anyone listening.
//   2. The ✕ had no `:focus-visible` rule, because the workshop's designed ring
//      was an opt-in list of six class names in admin.css. Everything not on the
//      list fell through to the browser's own — measured before the fix:
//      `outline: rgb(16,16,16) auto 1px`, which is Chrome's two-tone ring and
//      reads blue.
//
// ⚠ NEITHER WAS FIXED BY HIDING ANYTHING, which is the part worth defending.
// Michael: *"I don't want to remove things like keyboard functionality or
// accessibility."* Focus still lands inside the sheet, every control inside it
// still rings, and the ring is now a designed one on the whole site instead of
// on six classes. What changed is that it stopped pointing at the exit.
//
// ⚠ AND IT ONLY REPRODUCES AFTER A KEYSTROKE. `:focus-visible` will not match a
// programmatic focus that follows a synthetic mouse click, so a spec that clicks
// its way in measures a ring that is not painted and passes against the bug.
// Every test below reaches the opener with the KEYBOARD, which is both what
// makes the ring appear and what Michael was doing when he saw it.
//
// Read-only: `test` comes from ./fixtures, which blocks `/_actions/**`.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/** Open `opener` by keyboard, so `:focus-visible` is live, and report focus. */
async function openByKeyboard(page: Page, opener: string, dialog: string) {
  await page.locator(opener).first().waitFor();
  // A real keystroke first: this is what flips the engine's focus-visible
  // heuristic on, and without it the assertions below are vacuous.
  await page.keyboard.press('Tab');
  await page.locator(opener).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(dialog)).toHaveJSProperty('open', true);
  await page.waitForTimeout(500); // past the enter animation and any late focus

  return page.evaluate((sel) => {
    const d = document.querySelector(sel) as HTMLDialogElement;
    const a = document.activeElement as HTMLElement;
    const cs = getComputedStyle(a);
    return {
      isDialog: a === d,
      inside: d.contains(a),
      label: a.getAttribute('aria-label') ?? (a.textContent ?? '').trim().slice(0, 24),
      focusVisible: a.matches(':focus-visible'),
      // `outline-style: none` is not an outline, whatever its width and colour.
      ring: cs.outlineStyle === 'none' ? 'none' : `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
    };
  }, dialog);
}

test('a sheet with no field of its own focuses ITSELF, not the ✕', async ({ page }) => {
  await page.goto('/admin/fragments');
  const focus = await openByKeyboard(page, 'tr[data-writing] .row-open', '#wsheet');

  expect(
    focus.label,
    'focus landed on the close button — the first focusable thing in the markup, and the one control in a sheet that only leaves it',
  ).not.toBe('Close');
  expect(focus.isDialog, 'focus should be on the dialog itself; see openDialog in scripts/dialog-close.ts').toBe(true);
  // ⚠ AND THE DIALOG IS NOT RINGED. A 2px ring around a full-height drawer is
  // the same distraction one size larger; the dimmed backdrop already says where
  // you are, and a screen reader gets the sheet's name from its own role.
  expect(focus.ring, 'the sheet itself must not draw a ring — admin.css suppresses it deliberately').toBe('none');
});

test('a sheet that opens INTO a field still does', async ({ page }) => {
  // The other half of the rule: `openDialog` must not steal focus back from the
  // sheets that had already thought about this. Every one of them focuses its
  // first real field on the line after opening, which runs later and wins.
  await page.goto('/admin/people');
  const focus = await openByKeyboard(page, '[data-open-person-sheet]', '#person-sheet');

  expect(focus.isDialog, 'the container took focus from a sheet that wanted its name field').toBe(false);
  expect(focus.inside).toBe(true);
  expect(focus.label).not.toBe('Close');
});

test('the ring is ours, everywhere, not an opt-in list', async ({ page }) => {
  // ⚠ THE FAULT WAS THE OPT-IN, NOT THE RING. admin.css had a designed ring for
  // six class names; every control nobody remembered to add got the browser's
  // default. So what this pins is not "a ring exists" but "the ring is the
  // token one" — a UA ring reports `auto` as its style, and ours never can.
  await page.goto('/admin/fragments');
  const rings: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement;
      if (!a || a === document.body) return null;
      const cs = getComputedStyle(a);
      return cs.outlineStyle === 'none' ? null : `${cs.outlineStyle}|${cs.outlineWidth}`;
    });
    if (r) rings.push(r);
  }
  expect(rings.length, 'tabbed twelve times and nothing drew a focus ring at all').toBeGreaterThan(3);
  expect(
    rings.filter((r) => r.startsWith('auto')),
    'a control fell through to the browser default ring — add a rule, never remove the one in app.css',
  ).toEqual([]);
});
