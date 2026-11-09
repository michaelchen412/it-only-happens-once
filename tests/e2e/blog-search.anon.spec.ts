// The blog's live search is a router navigation with a swap of its own
// (scripts/blog-feed.ts, "A SEARCH IS A NAVIGATION", 2026-11-09).
//
// ⚠ THE BUG THIS GUARDS WAS INVISIBLE TO EVERY CHECK, and only showed as a
// SECOND action. The search used to move the URL behind the router's back, so
// the router still believed it was on the pre-search page — harmless until the
// next thing asked it to move. Opening a result in the sheet was that thing: it
// re-fetched and re-rendered the whole list (measured: 14 cards at y≈2,973 →
// 7 at 0). Searching looked perfect; it was the click AFTER that broke.
//
// ⚠ AND THE FIX HAS A FAILURE OF ITS OWN TO GUARD: the field must never be
// moved while someone types in it, or an iPhone closes its keyboard at every
// pause. Chromium cannot show the keyboard, so the assertion is the cause
// rather than the symptom — the field is the SAME ELEMENT, still focused, with
// every letter, after a search lands.
//
// Signed out, read-only — every request is a GET.
import type { Page } from '@playwright/test';
// ⚠ `test` FROM ./fixtures, never from @playwright/test (the read-only guard).
import { test, expect, hideDevToolbar } from './fixtures';

const FIELD = '#blog-filters input[name="q"]';
const cardCount = (page: Page) => page.locator('#feed-list > *').count();

/** Count whole-document swaps from here on. A sheet opening must cause none. */
async function countSwaps(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __swaps: number };
    w.__swaps = 0;
    document.addEventListener('astro:before-swap', () => w.__swaps++);
  });
  return () => page.evaluate(() => (window as unknown as { __swaps: number }).__swaps);
}

test.beforeEach(async ({ page }) => {
  await hideDevToolbar(page);
});

test('opening a result keeps the searched list exactly where it was', async ({ page }) => {
  await page.goto('/blog');
  await page.locator(FIELD).fill('the');
  await page.waitForURL(/[?&]q=the/);
  await expect(page.locator('#blog-feed')).not.toHaveClass(/list-loading/);

  // Two pages deep, then settle.
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await page.waitForFunction(() => document.querySelectorAll('#feed-list > *').length > 7);
  // A card on page 2, mid-list — scrolling the LAST one into view would trip
  // infinite scroll into fetching page 3 between the count and the click.
  const target = page.locator('#feed-list > *').nth(9).locator('[data-read]').first();
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const n = await cardCount(page);
  const y = await page.evaluate(() => window.scrollY);

  const swaps = await countSwaps(page);
  await target.click();
  await expect(page.locator('#site-reader')).toHaveJSProperty('open', true);
  expect(await swaps()).toBe(0); // the bug: this was 1, and the list was rebuilt
  expect(await cardCount(page)).toBe(n);
  expect(await page.evaluate(() => window.scrollY)).toBe(y);

  await page.locator('#site-reader .reader-top [data-reader-close]').click();
  await expect(page.locator('#site-reader')).toHaveJSProperty('open', false);
  expect(await cardCount(page)).toBe(n);
  expect(page.url()).toMatch(/[?&]q=the(&|$)/);
});

test('the field is never moved: same element, still focused, every letter kept', async ({ page }) => {
  await page.goto('/blog');
  const field = page.locator(FIELD);
  await field.click();
  await page.evaluate((sel) => ((document.querySelector(sel) as HTMLElement & { __mark?: 1 }).__mark = 1), FIELD);

  // Type, let a search start, and keep typing while it is IN FLIGHT — the first
  // response is held back so the next letter lands mid-navigation, which is
  // exactly when a moved field would lose it (and, on a phone, its keyboard).
  await page.route(/\/blog\?q=lov$/, async (route) => {
    await new Promise((r) => setTimeout(r, 1000));
    await route.continue();
  });
  await field.pressSequentially('lov', { delay: 40 });
  await page.waitForTimeout(450); // past the 250ms debounce: the search has started
  await expect(page.locator('#blog-feed')).toHaveClass(/list-loading/);
  await field.press('e');
  await page.waitForURL(/[?&]q=love(&|$)/);
  await expect(page.locator('#blog-feed')).not.toHaveClass(/list-loading/);

  const state = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement & { __mark?: 1 };
    return { same: el.__mark === 1, focused: document.activeElement === el, value: el.value };
  }, FIELD);
  expect(state).toEqual({ same: true, focused: true, value: 'love' });
  // The page shown is the one for the LAST term — the overtaken search never landed.
  await expect(page.locator('#blog-feed')).toContainText('“love”');
});

test('a search is a refinement, not a step: Back leaves the blog', async ({ page }) => {
  await page.goto('/about');
  await page.goto('/blog');
  await page.locator(FIELD).fill('the');
  await page.waitForURL(/[?&]q=the/);
  await page.locator(FIELD).fill('them');
  await page.waitForURL(/[?&]q=them/);
  await page.goBack();
  await page.waitForURL(/\/about$/);
});

test('Clear empties the field and the query', async ({ page }) => {
  await page.goto('/blog');
  await page.locator(FIELD).fill('the');
  await page.waitForURL(/[?&]q=the/);
  await page.locator('[data-subject-clear]').first().click();
  await page.waitForURL((u) => !u.searchParams.has('q'));
  await expect(page.locator(FIELD)).toHaveValue('');
});

test('a searched list comes back searched, at the same depth', async ({ page }) => {
  await page.goto('/blog');
  await page.locator(FIELD).fill('the');
  await page.waitForURL(/[?&]q=the/);
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await page.waitForFunction(() => document.querySelectorAll('#feed-list > *').length > 7);
  const n = await cardCount(page);

  // An essay on page 1 has its own sheet template, whose title links out.
  const slug = await page
    .locator('#feed-list > *')
    .first()
    .evaluate((c) => (c.querySelector('[data-read]') as HTMLElement).dataset.read!);
  await page.locator(`#feed-list [data-read="${slug}"]`).first().click();
  await page.locator('#site-reader h1 a').click();
  await page.waitForURL(/\/blog\/[^/?#]+$/);

  const back = page.locator('a[data-feed-return]').first();
  await expect(back).toHaveAttribute('href', /[?&]q=the(&|$)/);
  await back.click();
  await page.waitForURL(/[?&]q=the/);
  await page.waitForFunction(
    () => (window as unknown as { __feedReturn?: { settled: boolean } }).__feedReturn?.settled === true,
  );
  expect(await cardCount(page)).toBe(n);
  await expect(page.locator(FIELD)).toHaveValue('the');
});
