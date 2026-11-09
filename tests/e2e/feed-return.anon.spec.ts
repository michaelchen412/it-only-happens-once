// The blog feed keeps its place (scripts/feed-return.ts, 2026-11-09).
//
// Measured before it existed: scroll /blog through all 57 essays, open the last
// one's own page from the sheet, press Back — 14 cards, y≈2,093, the sheet
// reopened over the wrong part of the list. Infinite scroll's depth lived only
// in the DOM, and the server renders page 1 on every navigation.
//
// ⚠ WHAT THESE ASSERT IS A PLACE, NOT A SCROLL OFFSET: the same number of cards,
// and the same card at the same height (±4px). A raw `scrollY` would pass on a
// page that had simply clamped to the bottom of page 1 at the right number by
// coincidence — and `scrollY` is the very number the router corrupts (see the
// header of feed-return.ts).
//
// ⚠ AND THE NEGATIVE CASE IS AS IMPORTANT AS THE POSITIVE ONES. Michael ruled
// that only a reader who came FROM the feed gets their place back; a stranger
// on a shared link must land at the top. `arriving any other way` guards that.
//
// Signed out, read-only — every request is a GET.
import type { Page } from '@playwright/test';
// ⚠ `test` FROM ./fixtures, never from @playwright/test (the read-only guard).
import { test, expect, hideDevToolbar } from './fixtures';

const READER = '#site-reader';

const cardCount = (page: Page) => page.locator('#feed-list > *').count();

/** Scroll until the feed holds at least `n` cards (infinite scroll does the fetching). */
async function loadAtLeast(page: Page, n: number) {
  for (let i = 0; i < 20 && (await cardCount(page)) < n; i++) {
    const before = await cardCount(page);
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
    await page.waitForFunction((b) => document.querySelectorAll('#feed-list > *').length > b, before, {
      timeout: 10_000,
    });
  }
  expect(await cardCount(page)).toBeGreaterThanOrEqual(n);
}

/** Park card `i` near the top of the viewport and return its slug. */
async function settleOn(page: Page, i: number): Promise<string> {
  const slug = await page.evaluate((idx) => {
    const c = document.querySelectorAll('#feed-list > *')[idx];
    window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 140, behavior: 'instant' });
    return (c.querySelector('[data-read]') as HTMLElement).dataset.read!;
  }, i);
  await page.waitForTimeout(400); // past the 250ms stamp debounce
  return slug;
}

/** Where a card sits in the viewport right now, or null if it is not in the list. */
const topOf = (page: Page, slug: string) =>
  page.evaluate((s) => {
    const c = [...document.querySelectorAll('#feed-list > *')].find(
      (el) => (el.querySelector('[data-read]') as HTMLElement | null)?.dataset.read === s,
    );
    return c ? c.getBoundingClientRect().top : null;
  }, slug);

/**
 * The restore has finished. ⚠ Not "the feed is no longer dimmed" — it is not
 * dimmed BEFORE the restore starts either, so that would pass on arrival. The
 * settled flag is false from the moment a navigation begins until the arriving
 * feed's restore has run, which is exactly the window this needs.
 */
const restored = (page: Page) =>
  page.waitForFunction(
    () =>
      (window as unknown as { __feedReturn?: { settled: boolean } }).__feedReturn?.settled === true &&
      !document.getElementById('blog-feed')?.classList.contains('list-loading'),
  );

const noDuplicates = async (page: Page) => {
  const slugs = await page
    .locator('#feed-list > *')
    .evaluateAll((cs) => cs.map((c) => (c.querySelector('[data-read]') as HTMLElement | null)?.dataset.read));
  expect(new Set(slugs).size).toBe(slugs.length);
};

/** From the feed: open card `slug` in the sheet, then its title → the essay's own page. */
async function openPieceFromSheet(page: Page, slug: string) {
  await page.locator(`#feed-list [data-read="${slug}"]`).first().click();
  await expect(page.locator(READER)).toHaveJSProperty('open', true);
  await page.locator(`${READER} h1 a`).click();
  await page.waitForURL(/\/blog\/[^/?#]+$/);
}

test.beforeEach(async ({ page }) => {
  await hideDevToolbar(page);
});

test('the way back from a piece reached from the feed returns to the same place', async ({ page }) => {
  await page.goto('/blog');
  await loadAtLeast(page, 28);
  const slug = await settleOn(page, 23);
  const n = await cardCount(page);
  const t = (await topOf(page, slug))!;

  await openPieceFromSheet(page, slug);
  const back = page.locator('a[data-feed-return]').first();
  await expect(back).toHaveAttribute('href', '/blog');
  await expect(back).toHaveText('The blog');

  await back.click();
  await page.waitForURL(/\/blog$/);
  await restored(page);
  expect(await cardCount(page)).toBe(n);
  expect(Math.abs((await topOf(page, slug))! - t)).toBeLessThanOrEqual(4);
  await expect(page.locator(READER)).toHaveJSProperty('open', false); // "The blog", not the sheet
  await noDuplicates(page);
});

test('Back, closing the sheet, and a reload all keep the depth', async ({ page }) => {
  await page.goto('/blog');
  await loadAtLeast(page, 28);
  const slug = await settleOn(page, 23);
  const n = await cardCount(page);
  const t = (await topOf(page, slug))!;
  await openPieceFromSheet(page, slug);

  // Back lands on the entry that WAS the sheet — it reopens, over a list that
  // is now the reader's list rather than page 1.
  await page.goBack();
  await expect(page.locator(READER)).toHaveJSProperty('open', true);
  await restored(page);
  expect(await cardCount(page)).toBe(n);

  // Closing it must not wipe the entry (Reader `dismiss` once wrote `null`).
  await page.locator(`${READER} .reader-top [data-reader-close]`).click();
  await expect(page.locator(READER)).toHaveJSProperty('open', false);
  expect(await page.evaluate(() => typeof history.state?.index)).toBe('number');
  expect(Math.abs((await topOf(page, slug))! - t)).toBeLessThanOrEqual(4);

  await page.reload();
  await restored(page);
  expect(await cardCount(page)).toBe(n);
  expect(Math.abs((await topOf(page, slug))! - t)).toBeLessThanOrEqual(4);
  await noDuplicates(page);
});

// ⚠ A LIVE SEARCH IS NOT COVERED HERE, AND THAT IS A KNOWN GAP RATHER THAN AN
// OMISSION. `swapTo` moves the URL with replaceState behind the router's back,
// so the next sheet opened on a searched list is taken by the router for a
// different page and re-renders it — page 1, top — before this feature can do
// anything (measured 2026-11-09: 14 cards at y≈2,973 → 7 at 0). That predates
// feed-return and needs its own fix; until then a searched list returns at
// page-1 depth, which is no worse than it was.
test('a filtered list comes back filtered', async ({ page }) => {
  await page.goto('/blog');
  // Any subject deep enough for two pages, chosen live so the corpus can move.
  const href = await page
    .locator('[data-subject-link]')
    .evaluateAll((as) =>
      as
        .map((a) => ({ href: a.getAttribute('href'), n: Number(a.textContent?.match(/\d+/)?.[0] ?? 0) }))
        .find((s) => s.n >= 10),
    );
  test.skip(!href?.href, 'no subject has two pages of essays');
  await page.goto(href!.href!);
  await loadAtLeast(page, 9);
  const slug = await settleOn(page, 7);
  const n = await cardCount(page);
  const t = (await topOf(page, slug))!;

  await openPieceFromSheet(page, slug);
  const back = page.locator('a[data-feed-return]').first();
  await expect(back).toHaveAttribute('href', href!.href!);

  await back.click();
  await page.waitForURL(/subject=/);
  await restored(page);
  expect(await cardCount(page)).toBe(n);
  expect(Math.abs((await topOf(page, slug))! - t)).toBeLessThanOrEqual(4);
});

test('a ⌕ result opened over a deep quotes list returns there, and says so', async ({ page }) => {
  await page.goto('/blog?view=quotes');
  await loadAtLeast(page, 50);
  const slug = await settleOn(page, 40);
  const n = await cardCount(page);
  const t = (await topOf(page, slug))!;

  await page.locator('[data-site-search]:visible').first().click();
  await page.locator('[data-ss-input]').fill('happiness');
  const hit = page.locator('#site-search a.ss-hit[href^="/blog/"]').first();
  await hit.waitFor();
  await hit.click();
  await page.waitForURL(/\/blog\/[^/?#]+$/);

  // Whichever kind of piece it is, the way back names the list it now leads to.
  const back = page.locator('a[data-feed-return]').first();
  await expect(back).toHaveAttribute('href', '/blog?view=quotes');
  await expect(back).toHaveText('All quotes');

  await back.click();
  await page.waitForURL(/view=quotes/);
  await restored(page);
  expect(await cardCount(page)).toBe(n);
  expect(Math.abs((await topOf(page, slug))! - t)).toBeLessThanOrEqual(4);
});

test('arriving any other way keeps the plain link to the top', async ({ page }) => {
  // Visit the feed deep first, in the same tab — provenance must come from the
  // NAVIGATION, not from having been on the feed at some point.
  await page.goto('/blog');
  await loadAtLeast(page, 21);
  const slug = await settleOn(page, 15);

  await page.goto(`/blog/${slug}`); // a shared link, typed or pasted
  const back = page.locator('a[data-feed-return]').first();
  await expect(back).toHaveAttribute('href', '/blog');
  await back.click();
  await page.waitForURL(/\/blog$/);
  await restored(page);
  expect(await cardCount(page)).toBe(7);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("the reader's own scroll during a restore outranks the jump", async ({ page }) => {
  await page.goto('/blog');
  await loadAtLeast(page, 28);
  const slug = await settleOn(page, 23);
  const n = await cardCount(page);
  await openPieceFromSheet(page, slug);

  // Slow the restore's page fetches so there is time to act during it.
  await page.route(/\/blog\?(.*&)?page=\d/, async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await page.locator('a[data-feed-return]').first().click();
  await page.waitForURL(/\/blog$/);
  await page.keyboard.press('ArrowDown'); // intent, on the page itself
  await restored(page);

  expect(await cardCount(page)).toBe(n); // the depth still comes back…
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(1500); // …the jump does not
});
