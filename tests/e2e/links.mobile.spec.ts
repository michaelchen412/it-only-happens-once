// The Shared shelf and the link sheet at 390px (12 · Piece 3).
//
// Chromium at 390px, not mobile Safari — it catches layout and overflow and
// cannot catch the iOS keyboard. Read-only, like the rest of the harness.
//
// THE TWO FAILURES THIS EXISTS FOR, both silent everywhere else:
//
//  · TRAP 5's SHAPE. `.zone` is `overflow: hidden`, so anything inside it that
//    refuses to shrink is SHEARED with nothing reporting an overflow. A shelf
//    row carries a work title and a quote of arbitrary length in a rail that is
//    the full page width here. Measure descendants against their container's
//    content edge — a page-level sideways-scroll check misses it entirely.
//  · THE 44px TAP FLOOR. The mode segments are a fresh `.pseg` instance, and
//    the circle control shipped at 36px in Piece 1 — caught by the harness on
//    its first ever run, not by review.
import { test, expect, type Page } from '@playwright/test';

async function profiles(page: Page): Promise<string[]> {
  await page.goto('/admin/people');
  const hrefs = await page
    .locator('[data-person]')
    .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!));
  test.skip(hrefs.length === 0, 'no people in the roster to open');
  return hrefs;
}

async function openProfile(page: Page): Promise<void> {
  await page.goto((await profiles(page))[0]);
  await expect(page.locator('[data-shared]')).toBeVisible();
}

/**
 * ⚠ The first card is NOT the one to measure. The roster groups by circle and
 * then sorts by last contact, so "first" is whoever leads the Family section —
 * which made both shelf specs below skip on a database that did have links.
 * A skip that reads as a pass is the exact failure this harness exists against.
 */
async function openProfileWithLinks(page: Page): Promise<void> {
  for (const href of await profiles(page)) {
    await page.goto(href);
    if ((await page.locator('[data-shared] .shelf__row').count()) > 0) return;
  }
  test.skip(true, 'nothing linked on any profile');
}

test.describe('the shelf at 390px', () => {
  test.beforeEach(async ({ page }) => await openProfileWithLinks(page));

  test('the page itself never scrolls sideways', async ({ page }) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
  });

  test('no shelf row escapes the zone it lives in', async ({ page }) => {
    const rows = page.locator('[data-shared] .shelf__row');
    test.skip((await rows.count()) === 0, 'nothing linked to measure');

    // Against the CONTAINER's content edge, because `overflow: hidden` means
    // nothing above it will report the overflow (trap 5).
    const worst = await page.locator('[data-shared]').evaluate((zone) => {
      const box = zone.getBoundingClientRect();
      let out = 0;
      zone.querySelectorAll('.shelf__row *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0) out = Math.max(out, r.right - box.right);
      });
      return out;
    });
    expect(worst).toBeLessThanOrEqual(1);
  });

  test('a long quote wraps or clamps rather than being cut off mid-word', async ({ page }) => {
    const quotes = page.locator('[data-shared] .shelf__qt');
    test.skip((await quotes.count()) === 0, 'nothing on the shelf to measure');
    // `-webkit-line-clamp` is a deliberate ellipsis; a shear is not. The
    // difference is whether the element is wider than its parent.
    const overflowing = await quotes.first().evaluate((el) => {
      const parent = el.parentElement!.getBoundingClientRect();
      return el.getBoundingClientRect().right - parent.right;
    });
    expect(overflowing).toBeLessThanOrEqual(1);
  });
});

test.describe('the link sheet at 390px', () => {
  test.beforeEach(async ({ page }) => {
    await openProfile(page);
    await page.locator('[data-open-link-sheet]').click();
    await expect(page.locator('#link-sheet')).toBeVisible();
  });

  test('every mode segment clears the 44px tap floor', async ({ page }) => {
    for (const mode of ['work', 'fragment']) {
      const box = (await page.locator(`[data-mode="${mode}"]`).boundingBox())!;
      expect(box.height, `${mode} segment height`).toBeGreaterThanOrEqual(44);
    }
  });

  test('the search field takes the sheet’s width rather than a stranded 9rem', async ({ page }) => {
    const input = (await page.locator('[data-link-search]').boundingBox())!;
    const label = (await page.locator('.search--w').boundingBox())!;
    // `.search input` is a fixed 9rem for the roster header; inside a drawer
    // that leaves the field at a third of the width with no sign it is a bug.
    expect(input.width).toBeGreaterThan(label.width * 0.6);
  });

  test('the picker list scrolls inside itself rather than growing the sheet', async ({ page }) => {
    const rows = page.locator('[data-list="work"] [data-pick]');
    test.skip((await rows.count()) < 6, 'needs a list long enough to scroll');
    const list = page.locator('[data-list="work"]');
    const overflows = await list.evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflows).toBe('auto');
    expect((await list.boundingBox())!.height).toBeLessThan(page.viewportSize()!.height);
  });

  test('a picked row and the save button are both reachable without hunting', async ({ page }) => {
    const rows = page.locator('[data-list="work"] [data-pick]');
    test.skip((await rows.count()) === 0, 'no works in the corpus to pick');
    await rows.first().click();
    const save = page.locator('[data-link-save]');
    await expect(save).toBeEnabled();
    // The footer is pinned outside the scrolling body, so it stays on screen
    // however long the list is.
    const box = (await save.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  });
});
