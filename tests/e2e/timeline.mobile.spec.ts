// The log box at 390px (12 · Piece 2).
//
// THIS FILE EXISTS FOR TRAP 7, and a phone is where that trap actually bites.
// The pickers were first written as absolutely positioned divs opening upward
// from a box that sits at the TOP of the timeline zone — so every row landed
// under AdminLayout's sticky bar and could not be clicked, while still
// reporting `toBeVisible`. Opening downward instead would have been clipped by
// `.zone { overflow: hidden }`. The fix is the native top layer; these are the
// assertions that keep it fixed.
//
// ⚠ Chromium at 390px, not mobile Safari. It catches layout and reachability.
// It cannot catch iOS keyboard/viewport behaviour — a phone walkthrough is
// still owed.
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

async function openProfile(page: Page) {
  await page.goto('/admin/people');
  const count = await page.locator('[data-person]').count();
  test.skip(count === 0, 'no people in the roster to open');
  await page.goto((await page.locator('[data-person]').first().getAttribute('href'))!);
  await expect(page.locator('[data-timeline]')).toBeVisible();
  await page.locator('[data-log-input]').fill('Coffee.');
  await page.locator('[data-log-input]').dispatchEvent('input');
}

/** Descendants measured against the container's CONTENT edge — see people.mobile. */
async function overflowingChildren(container: Locator): Promise<string[]> {
  return container.evaluate((root) => {
    const style = getComputedStyle(root);
    const box = root.getBoundingClientRect();
    const right = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    const bad: string[] = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > right + 1) bad.push(`${el.tagName.toLowerCase()}.${el.className}`);
    }
    return bad;
  });
}

test.describe('the log box on a phone', () => {
  test.beforeEach(async ({ page }) => await openProfile(page));

  test('a picker row is genuinely clickable, not buried under the header', async ({ page }) => {
    await page.locator('[data-kind-open]').click();
    await expect(page.locator('[data-pop="kind"]')).toBeVisible();
    // `toBeVisible` passed in the broken version too — the popover WAS
    // rendered, it was just covered. Clicking is the only honest check.
    await page.locator('[data-kind="message"]').click();
    await expect(page.locator('[data-kind-label]')).toHaveText('Message');
  });

  test('every picker stays inside the viewport on both axes', async ({ page }) => {
    const triggers = ['[data-kind-open]', '[data-date-open]'];
    if ((await page.locator('[data-with-open]').count()) > 0) triggers.push('[data-with-open]');

    for (const trigger of triggers) {
      await page.locator(trigger).click();
      const box = (await page.locator('[data-pop]:visible').boundingBox())!;
      const vp = page.viewportSize()!;
      expect(box.x, `${trigger} runs off the left`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `${trigger} runs off the right`).toBeLessThanOrEqual(vp.width + 1);
      expect(box.y, `${trigger} runs off the top`).toBeGreaterThanOrEqual(-1);
      expect(box.y + box.height, `${trigger} runs off the bottom`).toBeLessThanOrEqual(vp.height + 1);
      await page.keyboard.press('Escape');
    }
  });

  test('nothing is sheared off the box', async ({ page }) => {
    expect(await overflowingChildren(page.locator('[data-logbox]'))).toEqual([]);
  });

  test('the profile never scrolls sideways', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  // §4: on a phone the order INVERTS — you open a profile to remember who
  // somebody is, not to scroll a year of entries.
  test('About comes before the timeline', async ({ page }) => {
    const about = (await page.locator('.zone', { hasText: 'About' }).first().boundingBox())!;
    const timeline = (await page.locator('[data-timeline]').boundingBox())!;
    expect(about.y).toBeLessThan(timeline.y);
  });
});
