// The sets pane survives a navigation — src/scripts/music-sets.ts.
//
// ⚠ THIS FILE EXISTS BECAUSE THE MUSIC ROOM HAD NO E2E COVERAGE AT ALL, and a
// bug walked straight through the gap onto the live site. Michael, 2026-08-19:
// *"if I navigate to the music section of the blog from the writing section,
// there is an infinite loading skeleton of the playlist embed. Hard refreshing
// the page will cause it to properly load."*
//
// The cause is the one this repo keeps re-learning: **a module script executes
// once per document, and a view-transition swap replaces the DOM without
// re-running it.** The page called `wireMusicSets()` once; arriving anywhere
// without a pane it returned immediately and correctly, and nothing ever ran
// against the pane the swap brought in. Nothing called `conceal()`, so nothing
// armed the reveal deadline, so the skeleton breathed forever.
//
// ⚠ THE ROOM MOVED TO `/listening` ON 2026-08-21 (ADR 0040) AND EVERY WORD ABOVE
// SURVIVED IT, which is itself the point. The bug was found crossing Writing →
// Music inside `/blog`, but nothing in it was ever about that page: the
// ClientRouter swaps documents the same way across two routes as it did across
// two views of one. So the crossing under test is now Blog → Music in the top
// bar, and it exercises the identical failure. (The file keeps its name: it
// tests `scripts/music-sets.ts` and the `MusicSets` pane, and neither of those
// followed the copy — see the room's own header on why the schema stays put.)
//
// ⚠ AND NOTE WHAT A HARD RELOAD DOES TO THIS BUG: it fixes it. So every way of
// checking the room that starts with `page.goto('/listening')` — which is every
// obvious way — passes while the site is broken. The test that matters is the
// SECOND navigation, through the router, and that is the one assertion below
// that could not have been guessed from the feature.
//
// ⚠ IT DOES NOT DEPEND ON SPOTIFY ANSWERING, deliberately. `is-ready` is set by
// `reveal()`, which fires on the embed's `ready`/`load` — but `conceal()` also
// arms a 4s deadline that reveals regardless, and a blocked API script falls
// back to a plain iframe at 2.5s. So a pane that is WIRED goes ready within a
// few seconds on any network, including one with no reach to open.spotify.com,
// and a pane that is NOT wired never does. That is exactly the line this file
// wants to sit on: it tests our wiring, not somebody else's uptime.
import { test, expect, openSiteMenuIfCollapsed } from './fixtures';

const SLOT = '#set-embed-slot';
/** Comfortably past the 4s reveal deadline, which is the slowest honest path. */
const REVEAL = { timeout: 9_000 };

// ⚠ THE CHROME'S OWN LINKS, AND THERE IS NO `test.skip` GUARDING THEM ANY MORE.
// There used to be one — the Music TAB waited on a published set, so a spec that
// assumed it was drawn would have failed on an empty corpus. The nav item is
// unconditional (see `SiteLayout`), so that skip could never fire again, and a
// skip that cannot fire is a green tick standing where a test used to be.
const TO_LISTENING = '#site-menu a[href="/listening"]';
const TO_BLOG = '#site-menu a[href="/blog"]';

/**
 * ⚠ THIS SPEC RUNS AT 390px TOO (`anon-mobile` takes every `*.anon.spec.ts`),
 * AND THAT IS WHERE THE CROSSING NOW LIVES BEHIND A BURGER. The old version
 * clicked the Music TAB, which was in `<main>` and visible at every width; the
 * crossing is chrome now, and below `md:` the chrome is a closed menu. Scoping
 * to `#site-menu` rather than taking `.first()` of a bare href is the other half
 * of it — the footer renders the same two hrefs, and a `.first()` that silently
 * resolved to the footer would be testing a different press than the one named.
 */
async function cross(page: import('@playwright/test').Page, to: string): Promise<void> {
  await openSiteMenuIfCollapsed(page);
  await page.locator(to).click();
}

test.describe('the sets pane', () => {
  test('is ready on a direct arrival', async ({ page }) => {
    await page.goto('/listening');
    test.skip((await page.locator(SLOT).count()) === 0, 'no sets published');
    await expect(page.locator(SLOT)).toHaveClass(/is-ready/, REVEAL);
  });

  test('⚠ is ready after navigating in from the blog, which a reload hides', async ({ page }) => {
    await page.goto('/blog');
    await cross(page, TO_LISTENING);
    await expect(page).toHaveURL(/\/listening$/);
    test.skip((await page.locator(SLOT).count()) === 0, 'no sets published');

    // The regression. Before the fix this stayed a breathing skeleton for as
    // long as the page was open.
    await expect(page.locator(SLOT)).toHaveClass(/is-ready/, REVEAL);
  });

  test('crossing back and forth neither stacks handlers nor re-requests the API', async ({ page }) => {
    await page.goto('/blog');

    for (let i = 0; i < 3; i++) {
      await cross(page, TO_LISTENING);
      await expect(page).toHaveURL(/\/listening$/);
      await cross(page, TO_BLOG);
      await expect(page).toHaveURL(/\/blog$/);
    }
    await cross(page, TO_LISTENING);
    // ⚠ WAIT FOR THE URL BEFORE COUNTING ANYTHING. `click()` returns as soon as
    // the press is dispatched, and the swap that brings the pane in is a
    // client-side fetch — so a bare `.count()` here reads the OLD document and
    // returns 0, which skipped this test into a green tick on the first run.
    // A skip that looks like a pass is worse than a failure.
    await expect(page).toHaveURL(/\/listening$/);
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
    await expect(page).toHaveURL(/\/listening\?/);
    await expect(page.locator(SLOT)).toHaveClass(/is-ready/, REVEAL);
  });
});
