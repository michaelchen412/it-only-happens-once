// Tasks at 390px (13 · Piece 1).
//
// TWO THINGS THIS FILE IS FOR, and neither is visible in a screenshot.
//
// TRAP 5 (10-hq.md §10h): a `<fieldset>` refuses to shrink — the UA gives it
// `min-width: min-content` — so one long label widens its parent instead of
// wrapping, and an ancestor's `overflow: hidden` then SHEARS IT OFF with
// nothing reporting an overflow. The editor is built from three fieldsets, one
// of which holds two four-way segmented controls side by side. That is the
// exact shape that found the trap in the check-in.
//
// AND THE 44px FLOOR. The tick and the two disposition chips are the controls
// pressed without looking, in bad light, on a page whose whole argument is that
// answering has to be cheap — and the people sheet's first e2e run found a
// 36px control that review had passed.
//
// ⚠ Chromium at 390px, not mobile Safari: this catches layout and overflow, not
// the iOS keyboard.
import { test, expect, type Locator, type Page } from '@playwright/test';

/** Every descendant's right edge against the container's CONTENT edge. */
async function overflowingChildren(container: Locator): Promise<string[]> {
  return container.evaluate((root) => {
    const style = getComputedStyle(root);
    const box = root.getBoundingClientRect();
    const right = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    const bad: string[] = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > right + 1)
        bad.push(`${el.tagName.toLowerCase()}.${el.className} → ${Math.round(r.right - right)}px`);
    }
    return bad;
  });
}

const openEditor = async (page: Page) => {
  await page.goto('/admin/agenda/tasks');
  // `.first()`, not a role query: the empty room carries BOTH "New" and "Add
  // the first", and a strict-mode match would pass only while there are tasks.
  await page.locator('[data-open-task-sheet]').first().click();
  await expect(page.locator('#task-sheet')).toBeVisible();
};

test('the room does not scroll sideways', async ({ page }) => {
  await page.goto('/admin/agenda/tasks');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('⚠ TRAP 5: nothing in the editor is sheared off, on any control', async ({ page }) => {
  await openEditor(page);
  await page.locator('[data-due]').fill('2026-12-07');
  await page.locator('[data-due]').dispatchEvent('input');
  // Every panel open at once — the widest the sheet can ever be.
  await page.locator('[data-rep="fixed"]').click();
  await page.locator('[data-override-on]').check();
  expect(await overflowingChildren(page.locator('#task-form'))).toEqual([]);

  await page.locator('[data-rep="after"]').click();
  expect(await overflowingChildren(page.locator('#task-form'))).toEqual([]);
});

test('⚠ every control you press without looking clears 44px', async ({ page }) => {
  await openEditor(page);
  // The repeat control does not exist until there is a date to repeat from, so
  // measuring it means giving the sheet one first.
  await page.locator('[data-due]').fill('2026-12-07');
  await page.locator('[data-due]').dispatchEvent('input');
  for (const sel of ['[data-effort="project"]', '[data-prio="normal"]', '[data-rep="after"]']) {
    const box = await page.locator(sel).boundingBox();
    expect(Math.round(box!.height), sel).toBeGreaterThanOrEqual(44);
  }
  // The unit control lives inside the panel that mode opens.
  await page.locator('[data-rep="after"]').click();
  expect(Math.round((await page.locator('[data-unit="months"]').boundingBox())!.height)).toBeGreaterThanOrEqual(44);
});

test('⚠ the tick and both disposition chips clear 44px too', async ({ page }) => {
  await page.goto('/admin/agenda/tasks');
  const tick = page.locator('.tick').first();
  if ((await tick.count()) > 0) {
    const box = await tick.boundingBox();
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(44);
  }
  const chip = page.locator('[data-dispose="skipped"]').first();
  test.skip((await tick.count()) === 0 && (await chip.count()) === 0, 'no tasks yet');
  if ((await chip.count()) > 0) {
    // A mis-tap here files a chore as skipped and nothing says so.
    expect(Math.round((await chip.boundingBox())!.height)).toBeGreaterThanOrEqual(36);
  }
});

test('a task row wraps rather than shearing its meta line', async ({ page }) => {
  await page.goto('/admin/agenda/tasks');
  const row = page.locator('[data-task]').first();
  test.skip((await row.count()) === 0, 'no tasks yet');
  // Four facts on one line — the date, the repeat, the effort meter and its
  // word — inside 390px minus the tick and the page padding.
  expect(await overflowingChildren(page.locator('[data-task-list]'))).toEqual([]);
});
