// Plan 06: the live length readout and the publish preflight.
//
// Everything here is client-side — a count off TipTap's document and a preflight
// read off the form — so the specs stub `/_actions/**` and assert that nothing
// was written. That keeps the harness read-only against the live project while
// still driving the real editor, which is the entire point.
import { test, expect } from '@playwright/test';
import { blockWrites } from './fixtures';

/** Open the composer on a brand-new piece and wait for the editor to mount. */
async function openNewWriting(page: import('@playwright/test').Page) {
  await page.goto('/admin#new-writing');
  await expect(page.locator('#wsheet')).toBeVisible();
  await expect(page.locator('#ws-editor .tiptap-doc')).toBeVisible();
}

test.describe('write-time signals', () => {
  test('the length readout appears as you type and matches ~220 wpm', async ({ page }) => {
    const attempts = await blockWrites(page);
    await openNewWriting(page);

    const count = page.locator('#ws-count');
    // An empty sheet stays quiet rather than announcing "0 words · 1 min".
    await expect(count).toBeHidden();

    await page.locator('#ws-editor .tiptap-doc').click();
    await page.keyboard.insertText('one two three four five');
    await expect(count).toBeVisible();
    await expect(count).toHaveText('5 words · 1 min ·');

    // 440 words is exactly two minutes at the shared rate. This is the assertion
    // that fails the day src/lib/reading.ts and the composer stop agreeing about
    // how long the same piece is — the whole reason that module exists.
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(Array.from({ length: 440 }, (_, i) => `w${i}`).join(' '));
    await expect(count).toHaveText('440 words · 2 min ·');

    expect(attempts(), 'the composer must not have written anything').toBe(0);
  });

  test('one word is one word, not "1 words"', async ({ page }) => {
    await blockWrites(page);
    await openNewWriting(page);
    await page.locator('#ws-editor .tiptap-doc').click();
    await page.keyboard.type('solitude');
    await expect(page.locator('#ws-count')).toHaveText('1 word · 1 min ·');
  });

  test('the preflight counts subjects and constellations, and never blocks Publish', async ({ page }) => {
    await blockWrites(page);
    await openNewWriting(page);

    await page.locator('#ws-editor .tiptap-doc').click();
    await page.keyboard.type('A short piece about nothing in particular.');
    // Scoped to #wsheet throughout: FragmentSheet is mounted on the same page
    // with its own title input and its own tab strip, so bare selectors are
    // ambiguous. Playwright's strict mode is right to refuse them.
    await page.locator('#wsheet input[name="title"]').fill('A test of the preflight');

    await page.locator('#ws-open-publish').click();
    const dialog = page.locator('#publish-dialog');
    await expect(dialog).toBeVisible();

    // Nothing filled in yet: the chips read zero and the hint names all three.
    await expect(page.locator('#pf-subjects')).toHaveText('0');
    await expect(page.locator('#pf-cn')).toHaveText('0');
    await expect(page.locator('#pf-words')).toHaveText('7');
    const hint = page.locator('#pf-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('no excerpt');
    await expect(hint).toContainText('no subjects');
    await expect(hint).toContainText('not placed in any constellation');

    // The instrument reacts to the fix. This is the assertion that would have
    // caught the bug where the subjects field was cached before <tag-input>
    // upgraded, and so read 0 forever.
    const tagField = dialog.locator('tag-input input.tag-input__field');
    await tagField.fill('memory');
    await tagField.press('Enter');
    await expect(page.locator('#pf-subjects')).toHaveText('1');
    await expect(hint).not.toContainText('no subjects');

    await dialog.locator('#excerpt-field').fill('A blurb.');
    await expect(hint).not.toContainText('no excerpt');

    // Never a gate: Publish stays live throughout, and nothing turned red.
    await expect(dialog.locator('#dialog-confirm')).toBeEnabled();
    await expect(page.locator('#pf-hint')).toHaveClass(/admin-hint/);
  });

  test('the constellations chip opens the tab that would change the number', async ({ page }) => {
    await blockWrites(page);
    await openNewWriting(page);
    await page.locator('#ws-editor .tiptap-doc').click();
    await page.keyboard.type('Words enough to publish.');

    await page.locator('#ws-open-publish').click();
    await expect(page.locator('#publish-dialog')).toBeVisible();
    await page.locator('#pf-constellations').click();

    await expect(page.locator('#publish-dialog')).toBeHidden();
    await expect(page.locator('#ws-panel-cn')).toBeVisible();
    await expect(page.locator('#wsheet [data-tab="constellations"]')).toHaveAttribute('aria-selected', 'true');
  });
});
