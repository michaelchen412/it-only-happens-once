// The 16px floor: no field on this site is under 16px on a touch device.
//
// WebKit — Safari, and therefore Chrome on iOS — magnifies the page when you
// focus a control whose computed font-size is under 16px, and only lets go when
// that control blurs. On the blog's rail search that was a trap with no exit:
// the keyboard's Search key neither blurs the field nor navigates (the submit
// is prevented, see scripts/blog-feed.ts), so the reader was left on a zoomed
// page. The fix is to never cross the line. See app.css, THE 16px FLOOR.
//
// WHY A SPEC AND NOT JUST THE RULE. The floor is written twice on purpose. The
// site-wide half (app.css) is at ELEMENT specificity so that a deliberate size
// expressed as a class still wins — which is why `.admin-title-input` keeps its
// 1.5rem. The consequence is that every class-scoped field rule in hq.css also
// beat it, so the workshop's half restates those selectors verbatim and lets
// source order decide. That second half is a LIST. Add `.foo input` at 0.875rem
// anywhere in hq.css and the site-wide rule quietly loses to it again, on a
// surface nobody thinks to open on a phone. This is what notices.
//
// ⚠ WHAT A GREEN RUN HERE DOES AND DOES NOT MEAN. Chromium at 390px with
// `hasTouch`, which is enough for `(pointer: coarse)` to match — so the rule is
// genuinely applied and genuinely measured. But the zoom this prevents is
// WebKit behaviour, and this browser has none of it to observe. Asserted here
// is the INPUT to that behaviour, never the behaviour itself.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/** iOS's own threshold. Below it, focusing the control zooms the page. */
const FLOOR = 16;

type Field = { size: number; where: string };

/**
 * Every text-entry control the reader can actually reach right now, measured.
 * Off-screen and unrendered controls are skipped — a sheet that has not been
 * opened has no layout, and a field nobody can focus cannot zoom anything.
 */
async function fields(page: Page): Promise<Field[]> {
  return page.evaluate(() => {
    const skip = ['checkbox', 'radio', 'hidden', 'range', 'color', 'submit', 'button', 'reset', 'image'];
    const out: { size: number; where: string }[] = [];
    for (const el of document.querySelectorAll('input, select, textarea, [contenteditable]')) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (skip.includes(type)) continue;
      if (!el.getClientRects().length) continue;
      const name = el.id || el.getAttribute('name') || el.getAttribute('aria-label') || el.getAttribute('placeholder');
      out.push({
        size: parseFloat(getComputedStyle(el).fontSize),
        where: `${el.tagName.toLowerCase()}${type ? `[${type}]` : ''} ${name ? `"${name}"` : `.${el.className}`}`,
      });
    }
    return out;
  });
}

/**
 * ⚠ A SURFACE WITH NO FIELDS PASSES THIS SPEC WITHOUT TESTING ANYTHING, which
 * is the failure this harness exists against. Every check goes through here, so
 * an empty measurement is a failure rather than a green tick.
 */
async function expectNothingUnderTheFloor(page: Page, surface: string): Promise<void> {
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  expect(coarse, 'the floor is a coarse-pointer rule; without it this proves nothing').toBe(true);

  const measured = await fields(page);
  expect(measured.length, `${surface}: no fields found to measure`).toBeGreaterThan(0);

  const under = measured.filter((f) => f.size < FLOOR);
  expect(
    under.map((f) => `${f.size}px — ${f.where}`),
    `${surface} zooms the page on iOS`,
  ).toEqual([]);
}

test('the blog rail search stays at the floor', async ({ page }) => {
  await page.goto('/blog');
  await expect(page.locator('#blog-filters input[name="q"]')).toBeVisible();
  await expectNothingUnderTheFloor(page, 'the blog rail');
});

test('the roster search stays at the floor', async ({ page }) => {
  await page.goto('/admin/people');
  const search = page.locator('#people-search');
  test.skip((await search.count()) === 0, 'the roster is too short to show its search');
  await expectNothingUnderTheFloor(page, 'the roster');
});

test('a sheet full of fields stays at the floor', async ({ page }) => {
  await page.goto('/admin/people');
  await page.locator('[data-open-person-sheet]').first().click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  // The person sheet is the densest field set in the workshop — text, selects,
  // the split birthday, the numeric cadence. If the floor holds here it holds.
  await expectNothingUnderTheFloor(page, 'the person sheet');
});
