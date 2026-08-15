// The calendar at 390px — the month grid's phone half, and the remembered view.
//
// ⚠ THIS ROOM HAD NO MOBILE SPEC UNTIL 2026-08-15, which is most of why the
// grid was as bad as it was. `a11y.spec.ts` measures /admin/agenda at 320 and
// 390 and it passed the whole time: the page did not overflow, every control
// had a name, nothing was off screen. It was simply illegible — seven columns
// at ~52px, a day number and about three characters of an event title before
// the ellipsis, six rows of it. Michael: *"that month view is not super
// optimized for this context."*
//
// So what is pinned here is the thing an overflow check cannot see: WHICH HALF
// of the cell is showing at which width, and whether the cell is reachable by a
// thumb once the words move to the day panel underneath.
//
// Read-only by construction — every route touched is a GET, and the one write
// this file causes is a cookie the SERVER sets on a GET (see `?view=`).
import { test, expect } from './fixtures';

const CELL = '.month__grid .cell';

test.describe('the month grid on a phone', () => {
  test('shows dots instead of titles, and gives the whole cell to the day panel', async ({ page }) => {
    await page.goto('/admin/agenda?view=month');

    // The titles are the desktop half. They are still in the HTML — the swap is
    // pure CSS on purpose, so there is no breakpoint the server has to guess at
    // and rotating a phone cannot catch the grid in the wrong state.
    const anyEv = page.locator(`${CELL} .ev`).first();
    if ((await page.locator(`${CELL} .ev`).count()) > 0) {
      await expect(anyEv).toBeHidden();
      await expect(anyEv).toHaveCount(1); // hidden, not removed
    }

    // ⚠ THE TAP TARGET IS THE CELL, NOT THE NUMERAL. Before this, the only
    // thing you could press was a ~20px day number in the corner — which was
    // survivable while the cell also held pressable rows, and is not once the
    // words live in the panel below.
    const cell = page.locator(CELL).nth(10);
    const cellBox = (await cell.boundingBox())!;
    const linkBox = (await cell.locator('.cell__n').boundingBox())!;
    expect(linkBox.width).toBeGreaterThan(cellBox.width * 0.9);
    expect(linkBox.height).toBeGreaterThan(cellBox.height * 0.9);

    // And pressing it low — where the numeral is not — still opens the day.
    await page.mouse.click(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height - 6);
    await expect(page).toHaveURL(/[?&]day=/);
    await expect(page.locator('#day')).toBeVisible();
  });

  test('a day with something on it says so, and the count reaches a screen reader', async ({ page }) => {
    await page.goto('/admin/agenda?view=month');

    const withDots = page.locator(`${CELL}:has(.cell__dots)`);
    test.skip((await withDots.count()) === 0, 'nothing on the calendar this month');

    await expect(withDots.first().locator('.cell__dots')).toBeVisible();
    // ⚠ THE DOTS ARE `aria-hidden`, SO THE LINK HAS TO CARRY THE COUNT. Without
    // it a screen reader on a phone is told a date and nothing about whether
    // anything is on it — the titles being the thing CSS just hid.
    await expect(withDots.first().locator('.cell__n')).toHaveAttribute('aria-label', /\d+ thing/);
  });

  test('the grid is shorter than the one it replaced', async ({ page }) => {
    // A blunt number, and the point of it is that the cells stopped reserving
    // three rows of space for titles that are not being rendered. 6 rows at the
    // old 6.25rem floor is 600px before borders; this asserts it is nowhere
    // near that any more, without pinning an exact height nobody should have to
    // update when a border changes.
    await page.goto('/admin/agenda?view=month');
    const grid = (await page.locator('.month__grid').boundingBox())!;
    expect(grid.height).toBeLessThan(420);
  });
});

test.describe('the view is remembered', () => {
  test('a bare /admin/agenda comes back to the one you last chose', async ({ page }) => {
    // ⚠ WHY THIS IS A COOKIE AND NOT localStorage: the page is server-rendered,
    // so the choice has to be legible during the render or the first paint is
    // the wrong view and swaps a frame later. What that buys is exactly what
    // this asserts — the sidebar link lands where you left off.
    await page.goto('/admin/agenda?view=week');
    await expect(page.locator('.wk')).toBeVisible();

    await page.goto('/admin/agenda');
    await expect(page.locator('.wk')).toBeVisible();
    await expect(page.locator('.month__grid')).toHaveCount(0);

    // …and an explicit parameter always wins over it, so a link you send shows
    // the recipient what it showed you.
    await page.goto('/admin/agenda?view=month');
    await expect(page.locator('.month__grid')).toBeVisible();
    await page.goto('/admin/agenda');
    await expect(page.locator('.month__grid')).toBeVisible();
  });

  test('every link on the page names its view, so none of them mean "ask the cookie"', async ({ page }) => {
    // The trap this closes: Month used to be the ABSENCE of `?view=`, and with a
    // cookie in play absence stopped meaning month. Pressing Month while the
    // cookie said week would have linked straight back to week.
    await page.goto('/admin/agenda?view=month');
    const hrefs = await page
      .locator('.pseg__b, .navb, .cell__n')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(10);
    expect(hrefs.filter((h) => !/[?&]view=(month|week)/.test(h))).toEqual([]);
  });
});
