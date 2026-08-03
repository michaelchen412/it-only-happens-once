// Drift at 390px (12 · Piece 4).
//
// Chromium at 390px, not mobile Safari. Read-only, like the rest of the harness.
//
// THE FAILURE THIS EXISTS FOR: the notice row carries a face, a name, an
// epithet, a duration and TWO adjacent buttons, and it lives inside a `.zone`
// on Today — which is `overflow: hidden`, so anything that refuses to shrink is
// SHEARED with nothing reporting an overflow (trap 5). The two buttons are also
// the sharpest tap-target problem in HQ: they sit side by side and mean
// OPPOSITE things, so a mis-tap either logs contact that never happened or
// silences somebody for a year, and nothing on screen says which occurred.
import { test, expect, type Page } from '@playwright/test';

const panel = (page: Page) => page.locator('[data-been-a-while]');

async function withDrift(page: Page, path: string): Promise<void> {
  await page.goto(path);
  test.skip((await panel(page).count()) === 0, 'nobody is drifting');
}

test.describe('the notice at 390px', () => {
  test('the roster never scrolls sideways because of it', async ({ page }) => {
    await withDrift(page, '/admin/people');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
  });

  test('nothing in a row escapes the panel', async ({ page }) => {
    await withDrift(page, '/admin/people');
    // Against the container's content edge: `overflow: hidden` means nothing
    // above will report it, and three plausible assertions all miss it (trap 5).
    const worst = await panel(page).evaluate((el) => {
      const box = el.getBoundingClientRect();
      let out = 0;
      el.querySelectorAll('[data-drift] *').forEach((n) => {
        const r = n.getBoundingClientRect();
        if (r.width > 0) out = Math.max(out, r.right - box.right);
      });
      return out;
    });
    expect(worst).toBeLessThanOrEqual(1);
  });

  test('the two dismissals never overlap, and both are readable', async ({ page }) => {
    await withDrift(page, '/admin/people');
    const row = panel(page).locator('[data-drift]').first();
    const a = (await row.locator('[data-reached-out]').boundingBox())!;
    const b = (await row.locator('[data-mute]').boundingBox())!;

    // Opposite meanings, adjacent targets. Overlap is the one failure that
    // would make a mis-tap invisible AND unavoidable.
    expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
    // Deliberately NOT the 44px floor: these are small on purpose so the pair
    // reads before it is pressed. What they must clear is being tappable at
    // all, and being on screen.
    expect(a.height).toBeGreaterThanOrEqual(28);
    expect(b.height).toBeGreaterThanOrEqual(28);
    expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  });

  test('inside Today’s zone it is still fully visible, not clipped', async ({ page }) => {
    await withDrift(page, '/admin');
    const zone = page.locator('[data-people-zone]');
    const clipped = await zone.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const rows = [...el.querySelectorAll('[data-drift]')];
      return rows.some((r) => {
        const b = r.getBoundingClientRect();
        return b.right > box.right + 1 || b.bottom > box.bottom + 1;
      });
    });
    expect(clipped).toBe(false);
  });
});
