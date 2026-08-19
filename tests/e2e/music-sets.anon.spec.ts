// The sets pane survives a navigation — src/scripts/music-sets.ts.
//
// ⚠ THIS FILE EXISTS BECAUSE THE MUSIC VIEW HAD NO E2E COVERAGE AT ALL, and a
// bug walked straight through the gap onto the live site. Michael, 2026-08-19:
// *"if I navigate to the music section of the blog from the writing section,
// there is an infinite loading skeleton of the playlist embed. Hard refreshing
// the page will cause it to properly load."*
//
// The cause is the one this repo keeps re-learning: **a module script executes
// once per document, and a view-transition swap replaces the DOM without
// re-running it.** `blog/index.astro` called `wireMusicSets()` once; on the
// writing view there is no pane, so it returned immediately and correctly, and
// nothing ever ran against the pane the Music switch swapped in. Nothing called
// `conceal()`, so nothing armed the reveal deadline, so the skeleton breathed
// forever.
//
// ⚠ AND NOTE WHAT A HARD RELOAD DOES TO THIS BUG: it fixes it. So every way of
// checking the music view that starts with `page.goto('/blog?view=music')` —
// which is every obvious way — passes while the site is broken. The test that
// matters is the SECOND navigation, through the router, and that is the one
// assertion below that could not have been guessed from the feature.
//
// ⚠ IT DOES NOT DEPEND ON SPOTIFY ANSWERING, deliberately. `is-ready` is set by
// `reveal()`, which fires on the embed's `ready`/`load` — but `conceal()` also
// arms a 4s deadline that reveals regardless, and a blocked API script falls
// back to a plain iframe at 2.5s. So a pane that is WIRED goes ready within a
// few seconds on any network, including one with no reach to open.spotify.com,
// and a pane that is NOT wired never does. That is exactly the line this file
// wants to sit on: it tests our wiring, not somebody else's uptime.
import { test, expect } from './fixtures';

const SLOT = '#set-embed-slot';
/** Comfortably past the 4s reveal deadline, which is the slowest honest path. */
const REVEAL = { timeout: 9_000 };

const musicHref = 'a[href*="view=music"]';

test.describe('the sets pane', () => {
  test('is ready on a direct arrival', async ({ page }) => {
    await page.goto('/blog?view=music');
    test.skip((await page.locator(SLOT).count()) === 0, 'no sets published');
    await expect(page.locator(SLOT)).toHaveClass(/is-ready/, REVEAL);
  });

  test('⚠ is ready after navigating in from Writing, which a reload hides', async ({ page }) => {
    await page.goto('/blog');
    test.skip((await page.locator(musicHref).count()) === 0, 'no music view');

    await page.locator(musicHref).first().click();
    await expect(page).toHaveURL(/view=music/);
    test.skip((await page.locator(SLOT).count()) === 0, 'no sets published');

    // The regression. Before the fix this stayed a breathing skeleton for as
    // long as the page was open.
    await expect(page.locator(SLOT)).toHaveClass(/is-ready/, REVEAL);
  });

  test('crossing back and forth neither stacks handlers nor re-requests the API', async ({ page }) => {
    await page.goto('/blog');
    test.skip((await page.locator(musicHref).count()) === 0, 'no music view');

    for (let i = 0; i < 3; i++) {
      await page.locator(musicHref).first().click();
      await expect(page).toHaveURL(/view=music/);
      await page.locator('main a[href="/blog"]').first().click();
      await expect(page).toHaveURL(/\/blog$/);
    }
    await page.locator(musicHref).first().click();
    // ⚠ WAIT FOR THE URL BEFORE COUNTING ANYTHING. `click()` returns as soon as
    // the press is dispatched, and the swap that brings the pane in is a
    // client-side fetch — so a bare `.count()` here reads the OLD document and
    // returns 0, which skipped this test into a green tick on the first run.
    // A skip that looks like a pass is worse than a failure.
    await expect(page).toHaveURL(/view=music/);
    test.skip((await page.locator(SLOT).count()) === 0, 'no sets published');
    await expect(page.locator(SLOT)).toHaveClass(/is-ready/, REVEAL);

    const sets = page.locator('[data-set]');
    test.skip((await sets.count()) < 2, 'needs two sets to switch between');

    // ⚠ HISTORY LENGTH IS THE OBSERVABLE PROXY FOR A STACKED LISTENER, and it is
    // the reason this test crosses four times before measuring. The capturing
    // click handler and the `popstate` handler live on `document`/`window`,
    // which the router never replaces — so if they were still bound inside
    // `wireMusicSets` they would accumulate one copy per arrival, and ONE press
    // on a set would run `history.pushState` four times. Nothing about the pane
    // would look wrong; the Back button would simply need four presses.
    const before = await page.evaluate(() => history.length);
    await sets.nth(1).click();
    await expect(page).toHaveURL(/set=/);
    const after = await page.evaluate(() => history.length);
    expect(after - before, 'one press must push exactly one history entry').toBe(1);

    // And the switch is IN PLACE — the whole reason the click is intercepted at
    // all (re-parenting or re-navigating would reload the iframe).
    await expect(page).toHaveURL(/\/blog\?/);
    await expect(page.locator(SLOT)).toHaveClass(/is-ready/, REVEAL);
  });
});
