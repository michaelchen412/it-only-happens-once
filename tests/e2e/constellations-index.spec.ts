// Plan 16 · Piece 3 — /admin/constellations becomes the room where the sky is
// arranged: colour is chosen here, and the order can finally be dragged.
//
// Two requests, one row, so one file. The colour half moves a control out of
// the individual composer (where the judgement it asks for is impossible — you
// are looking at one star and guessing about a sky); the drag half brings the
// composer's own reorder wiring to the page that orders the sky itself.
//
// ⚠ EVERY WRITE IS STUBBED. This suite runs against the live project and these
// two gestures both persist, so a spec that let one through would recolour or
// reorder Michael's real sky. `constellations.save` and `.reorder` are answered
// here and never reach the database.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const row = (page: Page, n: number) => page.locator('#cl-list li[data-id]').nth(n);
const pop = (page: Page) => page.locator('#cl-colors');
const slot = (page: Page, name: string) => page.locator(`#cl-colors .cn-slot[data-slot="${name}"]`);

/** Open the index with every write answered rather than sent. */
async function openIndex(page: Page, { failSave = false } = {}) {
  const saves: string[] = [];
  const reorders: string[] = [];
  await page.route('**/_actions/**', async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname)
      .replace(/^.*\/_actions\//, '')
      .replace(/\/$/, '');
    const body = route.request().postData() ?? '';
    if (name === 'constellations.save') {
      saves.push(body);
      if (failSave) {
        return void (await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Nope.' }),
        }));
      }
      return void (await route.fulfill({
        status: 200,
        contentType: 'application/json+devalue',
        body: '[{"id":1,"slug":2},"x","y"]',
      }));
    }
    if (name === 'constellations.reorder') {
      reorders.push(body);
      return void (await route.fulfill({
        status: 200,
        contentType: 'application/json+devalue',
        body: '[{"ok":1},true]',
      }));
    }
    await route.abort('failed');
  });
  await page.goto('/admin/constellations');
  await expect(row(page, 0)).toBeVisible();
  return { saves, reorders };
}

test.describe('colour is chosen where the sky is visible', () => {
  test('the row’s own star opens the picker, and the rest of the list stays behind it', async ({ page }) => {
    await openIndex(page);
    await expect(pop(page)).toBeHidden();
    await row(page, 0).locator('[data-color-btn]').click();
    await expect(pop(page)).toBeVisible();

    // Eight slots, and the counts are read off the list rather than invented:
    // the whole reason the control moved is that the decision is comparative.
    await expect(page.locator('#cl-colors .cn-slot')).toHaveCount(8);
    const total = await page
      .locator('#cl-colors [data-count]')
      .evaluateAll((els) => els.reduce((n, e) => n + (parseInt(e.textContent || '0', 10) || 0), 0));
    expect(total).toBe(await page.locator('#cl-list li[data-id]').count());

    // The list is still there underneath — a wall of 8×N inline swatches was
    // the alternative, and it would have buried the comparison it exists for.
    await expect(row(page, 0).locator('a')).toBeVisible();
  });

  test('picking a slot repaints the row immediately and leaves ONE selection signal', async ({ page }) => {
    const { saves } = await openIndex(page);
    const first = row(page, 0);
    const before = await first.getAttribute('data-color');
    const target = ['violet', 'ice', 'azure', 'gold', 'amber', 'sand', 'ember', 'rose'].find((s) => s !== before)!;

    await first.locator('[data-color-btn]').click();
    // The saved slot wears the ring when the picker opens…
    await expect(slot(page, before!)).toHaveClass(/is-active/);
    await slot(page, target).click();

    // …and after the click it has MOVED, rather than staying on the old one
    // while a mouse focus ring sat on the new one. Two signals and neither of
    // them the selection was the second of the two bugs this move had to kill.
    await expect(first).toHaveClass(new RegExp(`cn-${target}\\b`));
    await expect(first).not.toHaveClass(new RegExp(`cn-${before}\\b`));
    await expect(first).toHaveAttribute('data-color', target);

    // The save carried the row's whole identity, not just the changed field:
    // `constellations.save` rebuilds the slug from what it is given and
    // DEFAULTS status to draft, so a partial call unpublishes things.
    expect(saves).toHaveLength(1);
    expect(saves[0]).toContain(`name="color"`);
    expect(saves[0]).toContain(target);
    for (const field of ['id', 'name', 'slug', 'status']) {
      expect(saves[0], `the save dropped ${field}`).toContain(`name="${field}"`);
    }
  });

  test('a mouse click leaves no focus ring behind — only the keyboard gets one', async ({ page }) => {
    await openIndex(page);
    await row(page, 0).locator('[data-color-btn]').click();
    const ring = await slot(page, 'rose').evaluate((el) => {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      (el as HTMLElement).focus();
      return getComputedStyle(el).outlineStyle;
    });
    // `:focus-within` matched a mouse click because an `sr-only` radio took
    // focus. There is no radio any more, and the rule is `:focus-visible`.
    expect(ring).toBe('none');
  });

  test('a failed save puts the star back', async ({ page }) => {
    await openIndex(page, { failSave: true });
    const first = row(page, 0);
    const before = await first.getAttribute('data-color');
    const target = ['violet', 'ice', 'azure', 'gold', 'amber', 'sand', 'ember', 'rose'].find((s) => s !== before)!;

    await first.locator('[data-color-btn]').click();
    await slot(page, target).click();

    // A colour left on screen that isn't in the database is the worse failure,
    // because nothing on the page says so.
    await expect(first).toHaveAttribute('data-color', before!);
    await expect(first).toHaveClass(new RegExp(`cn-${before}\\b`));
    await expect(page.locator('#cl-error')).toBeVisible();
  });

  test('Escape closes the picker and gives focus back to the star', async ({ page }) => {
    await openIndex(page);
    const star = row(page, 0).locator('[data-color-btn]');
    await star.click();
    await expect(pop(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop(page)).toBeHidden();
    await expect(star).toBeFocused();
    await expect(star).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('the sky’s order can be dragged', () => {
  test('the row has a grip, and dragging commits the new order', async ({ page }) => {
    const { reorders } = await openIndex(page);
    await expect(row(page, 0)).toHaveAttribute('draggable', 'true');

    const ids = await page
      .locator('#cl-list li[data-id]')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));
    // Drive the HTML5 drag directly: Playwright's dragTo does not synthesise
    // the dragover/drop pair this handler reads.
    await page.evaluate(() => {
      const list = document.getElementById('cl-list')!;
      const [a, b] = [...list.querySelectorAll('li[data-id]')] as HTMLElement[];
      const dt = new DataTransfer();
      a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const r = b.getBoundingClientRect();
      b.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: r.bottom - 2, cancelable: true }),
      );
      b.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, cancelable: true }));
    });

    // ⚠ Assert what was SENT, not just the DOM. A list that reorders on screen
    // without the call is the failure that looks exactly like success.
    await expect.poll(() => reorders.length).toBe(1);
    const sent = decodeURIComponent(reorders[0]);
    expect(sent).toContain([ids[1], ids[0], ...ids.slice(2)].join(','));
  });

  test('Alt+↑/↓ moves the focused row and keeps focus on it', async ({ page }) => {
    const { reorders } = await openIndex(page);
    const ids = await page
      .locator('#cl-list li[data-id]')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));
    // Pinned by id, not by index — the row is about to change position, and a
    // positional locator would re-resolve to whichever row took its place.
    const button = page.locator(`#cl-list li[data-id="${ids[1]}"] [data-toggle-status]`);
    await button.focus();
    await page.keyboard.press('Alt+ArrowUp');

    await expect(page.locator('#cl-list li[data-id]').first()).toHaveAttribute('data-id', ids[1]!);
    await expect(button).toBeFocused(); // the row moved out from under you otherwise
    await expect.poll(() => reorders.length).toBe(1);
  });
});

test('the composer stopped asking about colour, and still shows it', async ({ page }) => {
  await openIndex(page);
  const id = await row(page, 0).getAttribute('data-id');
  const color = await row(page, 0).getAttribute('data-color');
  await page.goto(`/admin/constellations/${id}`);

  // No control…
  await expect(page.locator('#cc-form input[name="color"]')).toHaveCount(0);
  await expect(page.locator('#cc-form .cn-swatch')).toHaveCount(0);
  // …and the absence reads as deliberate rather than as something missing.
  await expect(page.locator('#cc-form')).toContainText('Chosen in the sky');
  // The star is still there, still in the right slot: the composer shows the
  // colour, it just stops asking about it.
  await expect(page.locator('#cc-star')).toBeVisible();
  await expect(page.locator(`#cc-form .cn-${color}`).first()).toBeVisible();
});
