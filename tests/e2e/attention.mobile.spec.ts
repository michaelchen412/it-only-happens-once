// The burger carries the number (20 · Piece 4) — at 390px, where it matters.
//
// ⚠ THIS SPEC IS THE PIECE'S ARGUMENT, WRITTEN DOWN. On a phone the sidebar is
// CLOSED, so the pill beside "Today" is invisible at precisely the moment the
// count is for: the phone, at 7am, for the check-in. That is the surface
// 11-checkin.md was designed around and the one ADR-0013 names — *"the surface
// is opened first, and most reliably, on the mornings that are hardest."*
//
// So the two halves are asserted together and neither means much alone: the
// sidebar's numeral is off screen, AND the burger's is on it. A future change
// that opens the drawer by default, or drops the burger badge as duplication,
// breaks one of them and says why.
import { expect, test } from './fixtures';

/** Put something in the count without writing to the live database — the same
 *  event the tick and the check-in dispatch. See `attention.spec.ts`. */
async function makeItWait(page: import('@playwright/test').Page): Promise<void> {
  const day = await page.locator('#hq').evaluate((el) => (el as HTMLElement).dataset.today!);
  await page.evaluate(
    (on) =>
      document.dispatchEvent(new CustomEvent('hq:attention', { detail: { kind: 'checkin', on, answered: false } })),
    day,
  );
}

test.describe('the count on a phone', () => {
  test('⚠ the sidebar numeral is off screen and the burger one is not', async ({ page }) => {
    await page.goto('/admin');
    await makeItWait(page);

    const pills = page.locator('[data-attention-pill]');
    await expect(pills).toHaveCount(2);

    // ⚠ MEASURED, NOT `toBeHidden()`. The closed drawer is TRANSFORMED off
    // screen, not hidden — `-translate-x-full` — so it keeps a real bounding
    // box and Playwright calls it visible. That is the same property that made
    // the `inert` fix necessary in the first place (19 · §3: hidden from the eye
    // and from nobody else), and a `toBeHidden()` here would quietly assert
    // nothing. The honest question is where the pixels are.
    const box = await pills.first().boundingBox();
    expect(
      box!.x + box!.width,
      'the sidebar pill is on screen — the burger badge would be redundant',
    ).toBeLessThanOrEqual(0);
    // And the one on the button you actually see is right there.
    await expect(pills.nth(1)).toBeVisible();
    await expect(pills.nth(1)).toHaveText(/^\d+$/);
  });

  test('the button still says what it is, with the count in its name', async ({ page }) => {
    await page.goto('/admin');
    await makeItWait(page);
    // The numeral is `aria-hidden`; the BUTTON carries the meaning, and it must
    // not stop being "Open menu" just because it gained a badge.
    await expect(page.locator('#sb-open')).toHaveAttribute('aria-label', /^Open menu, \d+ waiting$/);
    await expect(page.locator('[data-attention-pill]').nth(1)).toHaveAttribute('aria-hidden', 'true');
  });

  test('the badge does not push the header around', async ({ page }) => {
    // A badge that reflows the top bar when it appears is a badge you notice for
    // the wrong reason. It is absolutely positioned on the button; this is what
    // keeps it that way.
    await page.goto('/admin');
    const before = await page.locator('#sb-open').boundingBox();
    await makeItWait(page);
    await expect(page.locator('[data-attention-pill]').nth(1)).toBeVisible();
    const after = await page.locator('#sb-open').boundingBox();
    expect(after!.width, 'the burger changed width when the badge appeared').toBe(before!.width);
    expect(after!.x).toBe(before!.x);
  });

  test('opening the drawer brings the other numeral into view', async ({ page }) => {
    // One number, two renderers, and they agree — which is only checkable once
    // the drawer is open, because that is the only time both are on screen.
    await page.goto('/admin');
    await makeItWait(page);
    const pills = page.locator('[data-attention-pill]');
    const burger = (await pills.nth(1).textContent())?.trim();

    await page.locator('#sb-open').click();
    await expect(pills.first()).toBeVisible();
    expect((await pills.first().textContent())?.trim(), 'the two pills disagreed').toBe(burger);
  });
});
