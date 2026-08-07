// What the public side pays to open a constellation — docs/plans/24 · Pieces 3,
// 4 and 6. Signed out, because that is who these three are for.
import { test, expect } from '@playwright/test';

test('the sky and its suites are CDN-cacheable', async ({ page }) => {
  const PUBLIC = 'public, s-maxage=60, stale-while-revalidate=86400';

  // ⚠ Both of these had NO cache header at all until 2026-08-07 — the two
  // highest-traffic public rooms, while /blog and /about were both cached.
  const home = await page.goto('/');
  expect(home?.headers()['cache-control']).toBe(PUBLIC);

  const rows = page.locator('a.sky-row');
  expect(await rows.count()).toBeGreaterThan(0);

  const href = await rows.first().getAttribute('href');
  const suite = await page.goto(href!);
  expect(suite?.status()).toBe(200);
  expect(suite?.headers()['cache-control']).toBe(PUBLIC);
});

test('every sky row opts into viewport prefetch', async ({ page }) => {
  await page.goto('/');
  const rows = page.locator('a.sky-row');
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  // ⚠ `viewport`, not the site-wide default. `<ClientRouter />` enables prefetch
  // by itself but defaults to `hover`, and a phone does not hover — so without
  // this the front door prefetched nothing on the device it matters most on.
  for (let i = 0; i < n; i++) {
    await expect(rows.nth(i)).toHaveAttribute('data-astro-prefetch', 'viewport');
  }
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
