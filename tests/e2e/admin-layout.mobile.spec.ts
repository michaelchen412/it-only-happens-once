// Plan 08's static findings, turned into measurements at 390px.
//
// READ THE CAVEAT IN playwright.config.ts FIRST. This is chromium at a narrow
// viewport, not mobile Safari. It measures overflow, which is real and which
// the source already predicts. It cannot measure the thing plan 08 is most
// worried about — the iOS keyboard not shrinking `100%`/`vh` under a dialog in
// the top layer — because chromium has no such keyboard. A green run here does
// NOT close plan 08; it just means the walkthrough can spend its attention on
// the keyboard instead of on things a script could have caught.
import { test, expect } from '@playwright/test';
import { blockWrites, fixtures } from './fixtures';

/** Does this element's content run wider than the space it has? */
async function overflowOf(page: import('@playwright/test').Page, selector: string) {
  return page.locator(selector).evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    over: el.scrollWidth - el.clientWidth,
  }));
}

test.describe('the admin at 390px', () => {
  test('the page itself never scrolls sideways', async ({ page }) => {
    await page.goto('/admin');
    const doc = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(doc.scroll, 'the whole page scrolling sideways is the failure mode to look for').toBeLessThanOrEqual(doc.client + 1);
  });

  // KNOWN DEFECT, recorded rather than hidden — plan 08, finding 4.
  //
  // Measured 2026-07-30: the row is 501px of content in a 389px drawer on an
  // empty new piece (112px over), rising to 599px once you've typed and the
  // word count appears (210px over). It is `flex items-center gap-3 px-6` with
  // no wrap and no responsive rules, carrying close, type mark, "WRITING", two
  // tabs, the status area, View/Preview, Publish… and Delete.
  //
  // The overflow PREDATES the plan 06 word count — 112px of it is the row as it
  // has always been; the count adds the other 98px. Left failing-on-purpose so
  // the suite stays green while the finding stays executable: fix the row and
  // Playwright will flag this as "expected to fail but passed", which is the
  // signal to delete this comment and the `test.fail()` below.
  //
  // Worse since 2026-07-31, measured not guessed: plan 04 Piece 3 added a
  // fourth tab (Music) and the row went 501px → 565px in the same 389px, i.e.
  // over by 176px rather than 112px. Recorded here because a known defect
  // getting quietly worse is how it stops being known. When this row is finally
  // fixed, four tabs is the number to fix it for.
  test('the writing sheet command row fits its drawer', async ({ page }) => {
    test.fail();
    await blockWrites(page);
    await page.goto('/admin#new-writing');
    await expect(page.locator('#wsheet')).toBeVisible();

    const row = await overflowOf(page, '#wsheet form > div > div.flex.items-center');
    expect(
      row.over,
      `command row overflows its drawer by ${row.over}px at 390px (content ${row.scroll}px in ${row.client}px)`
    ).toBeLessThanOrEqual(0);
  });

  test('the fragment browser table does not force a sideways scroll', async ({ page }) => {
    const { constellationId } = fixtures();
    test.skip(!constellationId, 'no constellation exists to open the browser from');

    // The browser is mounted in the constellation composer, reached by "Add".
    await page.goto(`/admin/constellations/${constellationId}`);
    await page.locator('[data-browse]').first().click();
    await expect(page.locator('#fbrowser')).toBeVisible();
    await expect(page.locator('#fbrowser tbody tr').first()).toBeVisible();

    const doc = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(doc.scroll, 'plan 08 predicts the table needs a card layout below sm').toBeLessThanOrEqual(doc.client + 1);

    const table = await overflowOf(page, '#fbrowser table');
    expect(
      table.over,
      `browser table overflows by ${table.over}px at 390px (content ${table.scroll}px in ${table.client}px)`
    ).toBeLessThanOrEqual(0);
  });

  test('tap targets in the command row clear the 44px guideline', async ({ page }) => {
    await blockWrites(page);
    await page.goto('/admin#new-writing');
    await expect(page.locator('#wsheet')).toBeVisible();

    const publish = await page.locator('#ws-open-publish').boundingBox();
    expect(publish, 'Publish… should be on screen at all').not.toBeNull();
    // Reported rather than hard-failed at first: this is an audit, and the
    // number is the finding. Tighten to a hard assertion once it's fixed.
    if (publish && publish.height < 44) {
      test.info().annotations.push({ type: 'finding', description: `Publish… is ${Math.round(publish.height)}px tall (<44px)` });
    }
  });
});
