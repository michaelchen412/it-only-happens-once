// Backdrop dismissal, and the gesture that must NOT trigger it
// (docs/plans/25 · §3, `src/scripts/backdrop-close.ts`).
//
// ⚠ THREE DIALOGS CARRIED THIS GUARD FOR MONTHS WITH NO SPEC AT ALL, which is
// how four more shipped without it. A `<dialog>` has no backdrop element to
// listen on, so every one of these closes on "the click landed on the dialog
// box rather than on anything inside it" — and `click` fires on the common
// ancestor of pointerdown and pointerup. So a text selection that starts in the
// textarea and releases past the edge reports the dialog as its target and is
// indistinguishable from a deliberate dismiss, unless you remember where the
// press began.
//
// The gesture below is the real one: press inside, drag left, release on the
// backdrop — what you do every time you select a line right-to-left and
// overshoot. Each dialog gets both halves, because "it never closes" would pass
// the first assertion and be a different bug.
import { expect, test, type Page } from '@playwright/test';
import { hideDevToolbar, stubActions } from './fixtures';

/**
 * A point on the backdrop: same height as the dialog, hard against the left
 * edge of the viewport. These dialogs are a centred `.modal-dialog` or a
 * right-pinned `.drawer-dialog`, so x=8 is outside both — asserted rather than
 * assumed, since a layout change that widened one would otherwise turn this
 * whole file into a test of nothing.
 */
async function geometry(page: Page, dialog: string) {
  const box = (await page.locator(dialog).boundingBox())!;
  expect(box.x, `${dialog} reaches the left edge — x=8 is no longer its backdrop`).toBeGreaterThan(40);
  return {
    inside: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    backdrop: { x: 8, y: box.y + box.height / 2 },
  };
}

/** Press inside the shell, drag out, release on the backdrop. */
async function dragOutAndRelease(page: Page, dialog: string) {
  const { inside, backdrop } = await geometry(page, dialog);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.down();
  await page.mouse.move(backdrop.x, backdrop.y, { steps: 12 });
  await page.mouse.up();
}

/** A plain press-and-release on the backdrop — the deliberate dismiss. */
async function pressBackdrop(page: Page, dialog: string) {
  const { backdrop } = await geometry(page, dialog);
  await page.mouse.move(backdrop.x, backdrop.y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe('the ✚ capture box — the costliest one to get wrong', () => {
  // Closing this box FLUSHES, so a stray selection did not merely dismiss it:
  // it ended the thought and filed it, mid-word. It was one of the four that
  // had no guard.
  const open = async (page: Page) => {
    await stubActions(page, {}); // nothing here may reach the database
    await page.goto('/admin/notes');
    await hideDevToolbar(page);
    await page.locator('#cap-open').click();
    await expect(page.locator('#cap-dialog')).toHaveAttribute('open', '');
  };

  test('a selection released on the backdrop leaves it open', async ({ page }) => {
    await open(page);
    await dragOutAndRelease(page, '#cap-dialog');
    await expect(page.locator('#cap-dialog')).toHaveAttribute('open', '');
  });

  test('but a press that starts on the backdrop still closes it', async ({ page }) => {
    await open(page);
    await pressBackdrop(page, '#cap-dialog');
    await expect(page.locator('#cap-dialog')).not.toHaveAttribute('open', '');
  });
});

test.describe('the quote sheet — the guard that already existed', () => {
  // The regression anchor. This one has had the guard since plan 15; what is
  // new is that it runs through the shared helper, and "the extraction kept the
  // behaviour" is exactly the claim a pure move cannot make on its own.
  const open = async (page: Page) => {
    await stubActions(page, {});
    await page.goto('/admin/fragments');
    await hideDevToolbar(page);
    await page.locator('#add-btn').click();
    await page.locator('#add-menu [data-new="quote"]').click();
    await expect(page.locator('#sheet')).toHaveAttribute('open', '');
  };

  test('a selection released on the backdrop leaves it open, with the words still in it', async ({ page }) => {
    await open(page);
    await page.locator('#quote-editor [contenteditable]').fill('Words that must survive an overshoot.');
    await dragOutAndRelease(page, '#sheet');
    await expect(page.locator('#sheet')).toHaveAttribute('open', '');
    await expect(page.locator('#quote-editor')).toContainText('Words that must survive an overshoot.');
  });

  test('a press that starts on the backdrop reaches the unsaved-work guard', async ({ page }) => {
    await open(page);
    await page.locator('#quote-editor [contenteditable]').fill('Something typed.');
    await pressBackdrop(page, '#sheet');
    // NOT closed outright — this sheet routes every exit through the discard
    // confirm, which is the behaviour the guard is protecting in the first
    // place. Reaching the question IS the dismiss.
    await expect(page.getByRole('dialog').filter({ hasText: 'Discard changes?' })).toBeVisible();
  });
});

test.describe('the log sheet — one of the four that was missing it', () => {
  const open = async (page: Page) => {
    await stubActions(page, {});
    await page.goto('/admin/notes');
    await hideDevToolbar(page);
    const card = page.locator('.dump').first();
    test.skip((await card.count()) === 0, 'the pile is empty');
    await card.locator('[data-file]').click();
    const row = page.locator('#dump-file [data-as="log"]');
    test.skip((await row.count()) === 0, 'no roster, so no log destination');
    await row.click();
    await expect(page.locator('#log-sheet')).toHaveAttribute('open', '');
  };

  test('a selection released on the backdrop leaves it open', async ({ page }) => {
    await open(page);
    // It opens with the dump's words already in the textarea and expects you to
    // edit them, which is precisely the surface a drag-select happens on.
    await dragOutAndRelease(page, '#log-sheet');
    await expect(page.locator('#log-sheet')).toHaveAttribute('open', '');
  });

  test('but a press that starts on the backdrop still closes it', async ({ page }) => {
    await open(page);
    await pressBackdrop(page, '#log-sheet');
    await expect(page.locator('#log-sheet')).not.toHaveAttribute('open', '');
  });
});
