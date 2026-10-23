// What the public side pays to open a constellation — docs/plans/24 · Pieces 3,
// 4 and 6. Signed out, because that is who these three are for.
import { test, expect } from './fixtures';
import { PUBLIC_PAGE } from '../../src/lib/http-cache';

test('the sky and its suites are CDN-cacheable', async ({ page }) => {
  // ⚠ Both of these had NO cache header at all until 2026-08-07 — the two
  // highest-traffic public rooms, while /blog and /about were both cached.
  const home = await page.goto('/');
  expect(home?.headers()['cache-control']).toBe(PUBLIC_PAGE);

  const rows = page.locator('a.sky-row');
  expect(await rows.count()).toBeGreaterThan(0);

  const href = await rows.first().getAttribute('href');
  const suite = await page.goto(href!);
  expect(suite?.status()).toBe(200);
  expect(suite?.headers()['cache-control']).toBe(PUBLIC_PAGE);
});

test('every suite has arrived before the reader scrolls', async ({ page }) => {
  await page.goto('/');
  const hrefs = await page.locator('a.sky-row').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs.length).toBeGreaterThan(0);
  // ⚠ ARRIVED, NOT TAGGED. `viewport` was tagged correctly for months and still
  // lost the race to the first click; what matters is that the document is in
  // the browser before anyone presses. No scrolling here, on purpose — rows
  // below the fold are exactly the ones `viewport` left cold.
  await expect
    .poll(() =>
      page.evaluate((want) => {
        const got = new Set(performance.getEntriesByType('resource').map((e) => e.name));
        return want.filter((h) => !got.has(h));
      }, hrefs),
    )
    .toEqual([]);
});

test('a suite still renders its stanzas after the query was collapsed', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('a.sky-row').first().getAttribute('href');
  await page.goto(href!);
  // Piece 4 turned two serial round trips into one embedded select. The thing
  // that must not have changed is what comes out of it.
  await expect(page.locator('h1')).toBeVisible();
  expect(await page.locator('.suite-item, article, blockquote, [data-suite-item]').count()).toBeGreaterThan(0);
});

test('the admin gate still redirects a signed-out browser', async ({ page }) => {
  // Piece 8b swapped getUser() for getClaims(); this is the assertion that the
  // swap did not weaken the gate.
  await page.goto('/admin');
  expect(page.url()).toContain('/sign-in');
});
