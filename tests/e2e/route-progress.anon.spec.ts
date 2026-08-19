// The click lands first, on the PUBLIC site — src/scripts/route-progress.ts.
//
// ⚠ THIS IS NOT `nav-progress.spec.ts` WITH A DIFFERENT URL, and the difference
// is what makes it worth writing. That file tests a control driven by a CLICK
// listener on a page with no router, so its whole technique is "read the state
// synchronously at click time, never await across a navigation". Here the
// `<ClientRouter />` is mounted: there is no document swap to race, the router
// dispatches `astro:before-preparation` and the bar is up for as long as the
// fetch takes. Ordinary awaits are safe, and `page.route` can hold the
// navigation open long enough to assert against it — which is a luxury the
// Observatory's spec does not have.
//
// Two of the four assertions below are regression tripwires rather than
// feature tests, and both guard claims that came from reading Astro's source
// rather than from anything this repo controls:
//
//   · the bar STARTS on a real navigation — i.e. `astro:before-preparation`
//     still fires and still carries `sourceElement`.
//   · the bar does NOT start when the Reader opens. `Reader.astro` navigates to
//     `#read=<slug>`, and the router short-circuits a same-page hash move
//     BEFORE `doPreparation` (astro/dist/transitions/router.js). If an upgrade
//     ever removes that short circuit, a progress bar starts flashing across
//     the top of the site on every fragment tap — a new tic in the quietest
//     interaction here, with nothing else to notice it.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const BAR = '#nav-progress';

/**
 * Reach the bar's nav links at whatever width this project runs.
 *
 * ⚠ THIS SPEC RUNS IN BOTH `anon` (desktop) AND `anon-mobile` (390px), and the
 * three links are `display: none` below `md:` until the burger opens — so the
 * first version of this file passed on desktop and timed out on the phone,
 * which is the half of the audience the whole change was made for.
 */
async function openChrome(page: Page) {
  const burger = page.locator('#menu-toggle');
  if (await burger.isVisible()) {
    await burger.click();
    await expect(page.locator('#site-menu')).toHaveClass(/is-open/);
  }
}

test('the bar and the pressed link answer while the next page is still loading', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(BAR)).toHaveCount(1);
  await expect(page.locator(BAR)).not.toHaveClass(/is-active/);

  // Hold /blog open so the in-flight state can actually be observed. Without
  // this the navigation resolves in ~40ms locally and the window is gone.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/blog', async (route) => {
    await held;
    await route.continue();
  });

  await openChrome(page);
  await page.locator('header a[data-nav-row][href="/blog"]').click();

  await expect(page.locator(BAR)).toHaveClass(/is-active/);
  // The link you pressed takes the active ink before the page it names arrives…
  await expect(page.locator('header a[href="/blog"]')).toHaveAttribute('data-nav-pending', '');
  // …and the one that WAS active gives it up in the same frame, so the mark
  // moves once rather than two links glowing at each other.
  await expect(page.locator('header a[href="/"][data-nav-row]')).not.toHaveAttribute('data-nav-pending', '');

  release();
  await expect(page).toHaveURL(/\/blog$/);
  // `astro:page-load` clears it — the new page is on screen, so the bar is done.
  await expect(page.locator(BAR)).not.toHaveClass(/is-active/);
  await expect(page.locator('[data-nav-pending]')).toHaveCount(0);
});

test('opening the Reader does not trip it — a hash is not a navigation', async ({ page }) => {
  await page.goto('/blog');
  await expect(page.locator(BAR)).not.toHaveClass(/is-active/);

  await page.locator('[data-read]').first().click();
  await expect(page.locator('#site-reader')).toHaveJSProperty('open', true);

  // Long enough that a bar which HAD started would still be creeping: the
  // safety timeout is 10s and the creep runs the whole way.
  await page.waitForTimeout(400);
  await expect(page.locator(BAR)).not.toHaveClass(/is-active/);

  // And the way back out is the same non-event — `history.back()` on a hash
  // takes the router's mirrored short circuit.
  await page.locator('[data-reader-close]').first().click();
  await expect(page.locator('#site-reader')).toHaveJSProperty('open', false);
  await expect(page.locator(BAR)).not.toHaveClass(/is-active/);
});

test('a content link moves nothing in the chrome', async ({ page }) => {
  await page.goto('/');
  // The Sky's rows are links to real documents, so the bar is right to run —
  // but they are not `data-nav-row`, so no chrome link may claim to be pending.
  // (This is the rule that stops /blog's feed cards moving the top bar's mark.)
  const row = page.locator('.sky-row').first();
  test.skip((await row.count()) === 0, 'the sky is empty');

  const marked = await page.evaluate(() => {
    const a = document.querySelector<HTMLAnchorElement>('.sky-row')!;
    return a.hasAttribute('data-nav-row');
  });
  expect(marked, 'a constellation row must not be a chrome link').toBe(false);
});
