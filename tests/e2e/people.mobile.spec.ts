// The roster and the add sheet at 390px (12 · Piece 1).
//
// TRAP 5 IS WHY THIS FILE EXISTS (10-hq.md §10h). A `<fieldset>` — and anything
// else the UA gives `min-width: min-content` — refuses to shrink, so one long
// label widens its parent past the card instead of wrapping, and the zone's
// `overflow: hidden` then SHEARS IT OFF with nothing reporting an overflow.
// Three plausible assertions all miss it:
//
//   · a page-level sideways-scroll check — the row never reaches the page edge;
//   · `scrollWidth` on an ancestor — `overflow: hidden` means nothing reports it;
//   · `scrollWidth > clientWidth` on the element — Chromium clamps that once
//     `text-overflow: ellipsis` applies.
//
// So the check here MEASURES DESCENDANTS AGAINST THEIR CONTAINER'S CONTENT EDGE.
// The three-way circle control is the shape at risk: three labels in a row
// inside a sheet that is 390px wide minus its padding.
//
// ⚠ This project is CHROMIUM at 390px, not mobile Safari. It catches layout and
// overflow. It cannot catch the iOS keyboard/viewport behaviour plan 08 is
// about — a phone walkthrough is still owed.
import { test, expect, type Locator } from '@playwright/test';

/**
 * Every descendant's right edge, against the container's CONTENT edge.
 *
 * Not `scrollWidth`, for the reasons in the header. This is the measurement
 * that actually catches a sheared label.
 */
async function overflowingChildren(container: Locator): Promise<string[]> {
  return container.evaluate((root) => {
    const style = getComputedStyle(root);
    const box = root.getBoundingClientRect();
    const right = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    const bad: string[] = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      // A pixel of slack for sub-pixel rounding.
      if (r.right > right + 1)
        bad.push(`${el.tagName.toLowerCase()}.${el.className} → ${Math.round(r.right - right)}px`);
    }
    return bad;
  });
}

test.describe('the roster on a phone', () => {
  test('does not scroll sideways', async ({ page }) => {
    await page.goto('/admin/people');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('lays the cards out one across', async ({ page }) => {
    await page.goto('/admin/people');
    const cards = page.locator('[data-person]');
    test.skip((await cards.count()) < 2, 'needs two people to tell one column from two');

    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    // Stacked, not side by side: same left edge, different top.
    expect(Math.abs(first!.x - second!.x)).toBeLessThan(2);
    expect(second!.y).toBeGreaterThan(first!.y);
  });
});

test.describe('the add sheet on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/people');
    await page.getByRole('button', { name: /^Add/ }).first().click();
    await expect(page.locator('#person-sheet')).toBeVisible();
  });

  // THE TRAP-5 CHECK. Measured against the content edge, per the header.
  test('nothing is sheared off the sheet at 390px', async ({ page }) => {
    expect(await overflowingChildren(page.locator('#person-sheet'))).toEqual([]);
  });

  test('the three circle labels all fit, and none is clipped to nothing', async ({ page }) => {
    for (const label of ['Family', 'Friends', 'Professional']) {
      const button = page.locator('.pseg__b', { hasText: label });
      const box = await button.boundingBox();
      expect(box!.width, `${label} has collapsed`).toBeGreaterThan(20);

      // The text itself, measured with a Range — Chromium clamps `scrollWidth`
      // once an ellipsis applies, so asking the element is asking the wrong
      // thing.
      const textWidth = await button.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect().width;
      });
      expect(textWidth, `${label} is being clipped`).toBeLessThanOrEqual(box!.width + 1);
    }
  });

  // THE 44px FLOOR. This failed on its first run at 36px, which is what the
  // segmented control's padding alone came to — and three adjacent circle
  // segments are the most mis-tappable thing on the sheet, on the one surface
  // that has to work from a phone. A wrong tap files somebody in the wrong
  // circle and nothing says so.
  test('the circle segments clear the 44px floor', async ({ page }) => {
    for (const key of ['family', 'friends', 'professional']) {
      const box = await page.locator(`[data-circle="${key}"]`).boundingBox();
      expect(box!.height, `${key} is under the floor`).toBeGreaterThanOrEqual(44);
    }
    // The photo well is the camera-roll entry point and is far larger.
    const well = await page.locator('[data-photowell]').boundingBox();
    expect(well!.height).toBeGreaterThanOrEqual(44);
  });

  test('the birthday row keeps all three controls on one line without overflowing', async ({ page }) => {
    const row = page.locator('[data-birth-month]').locator('..');
    expect(await overflowingChildren(row)).toEqual([]);
  });
});
