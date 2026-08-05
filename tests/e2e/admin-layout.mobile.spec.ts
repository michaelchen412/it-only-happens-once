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
  // Both front doors, because they are now different pages: `/admin` is Today
  // (the one opened on a phone every morning) and `/admin/fragments` is the
  // manager's dense table. Today is the one that has to hold at 390px.
  for (const route of ['/admin', '/admin/fragments']) {
    test(`${route} never scrolls sideways`, async ({ page }) => {
      await page.goto(route);
      const doc = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(doc.scroll, 'the whole page scrolling sideways is the failure mode to look for').toBeLessThanOrEqual(
        doc.client + 1,
      );
    });
  }

  // TRAP 5 (10-hq.md §10h), pre-armed. A zone's `overflow: hidden` shears a too-
  // wide child off the card SILENTLY: a page-level sideways-scroll check never
  // reaches the page edge, and `scrollWidth` on an ancestor reports nothing
  // because the overflow is hidden. The only assertion that catches it measures
  // descendants against their container's own content edge, which is what this
  // does. It has nothing to shear yet — the point is that it is already here
  // when the check-in's scales arrive.
  test('nothing inside a zone is wider than the zone', async ({ page }) => {
    await page.goto('/admin');
    const zones = page.locator('.zone');
    await expect(zones.first()).toBeVisible();

    const overflows = await zones.evaluateAll((els) =>
      els.flatMap((zone) => {
        const box = zone.getBoundingClientRect();
        const style = getComputedStyle(zone);
        const right = box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
        const left = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
        return [...zone.querySelectorAll('*')]
          .filter(
            (el) =>
              // ONLY WHAT IS ACTUALLY DRAWN. An unrendered element — a hidden
              // panel, or an SVG `<symbol>`/`<path>` living in a sprite — has an
              // all-zero rect, so `left - 0` reports the zone's own left inset
              // as an overflow. First run of this assertion flagged 162
              // elements, every one of them by exactly the same 17px, which is
              // the tell: a real shear does not produce a uniform number.
              el.getClientRects().length > 0 && !el.closest('svg'),
          )
          .map((el) => {
            const r = el.getBoundingClientRect();
            const over = Math.max(r.right - right, left - r.left);
            return { tag: el.tagName.toLowerCase(), cls: String(el.className), over: Math.round(over) };
          })
          .filter((x) => x.over > 1);
      }),
    );
    expect(overflows, `content escaping its zone at 390px: ${JSON.stringify(overflows)}`).toHaveLength(0);
  });

  // ✅ FIXED 2026-08-04 by plan 16 · Piece 1. This carried `test.fail()` from
  // 2026-07-30 to 2026-08-04, and it did its job exactly as designed: it went
  // "expected to fail, but passed" on the run that fixed the row, which is the
  // signal its own comment said to watch for. Kept — as a real assertion now —
  // because the row will be edited again.
  //
  // What it was recording, worth keeping for scale: 501px of content in a 389px
  // drawer on an empty new piece, rising to 599px once you had typed and the
  // word count appeared, and worsening to 565px-at-rest on 2026-07-31 when a
  // fourth tab (Music) arrived. The row was `flex items-center gap-3 px-6` with
  // no wrap and no responsive rules, carrying up to thirteen children.
  //
  // ⚠ The plan that fixed it claimed "nothing measures this header". It was
  // wrong: this did, for five days, with a number. A known defect left
  // executable is worth more than a known defect written down.
  test('the writing sheet command row fits its drawer', async ({ page }) => {
    await blockWrites(page);
    await page.goto('/admin/fragments#new-writing');
    await expect(page.locator('#wsheet')).toBeVisible();

    const row = await overflowOf(page, '#ws-command-row');
    expect(
      row.over,
      `command row overflows its drawer by ${row.over}px at 390px (content ${row.scroll}px in ${row.client}px)`,
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
      `browser table overflows by ${table.over}px at 390px (content ${table.scroll}px in ${table.client}px)`,
    ).toBeLessThanOrEqual(0);
  });

  test('tap targets in the command row clear the 44px guideline', async ({ page }) => {
    await blockWrites(page);
    await page.goto('/admin/fragments#new-writing');
    await expect(page.locator('#wsheet')).toBeVisible();

    const publish = await page.locator('#ws-open-publish').boundingBox();
    expect(publish, 'Publish… should be on screen at all').not.toBeNull();
    // Reported rather than hard-failed at first: this is an audit, and the
    // number is the finding. Tighten to a hard assertion once it's fixed.
    if (publish && publish.height < 44) {
      test
        .info()
        .annotations.push({ type: 'finding', description: `Publish… is ${Math.round(publish.height)}px tall (<44px)` });
    }
  });
});
