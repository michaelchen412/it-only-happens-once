// Plan 16 · Piece 1, at 390px — the width the writing sheet had never been
// opened at. `admin-layout.mobile.spec.ts` exists and measures the chrome;
// nothing measured this row, which before that piece held thirteen children
// with no `flex-wrap` and could therefore only overflow.
//
// 2026-08-17 took the other half of that answer. Piece 1 stopped the overflow by
// letting the row WRAP; this file now also asserts that it doesn't need to,
// because what was on the second line has gone rather than moved, and that the
// formatting toolbar has left the top of the sheet for the bottom of it.
//
// ⚠ Chromium at 390px, not Safari on a phone — the caveat playwright.config.ts
// already writes down about this whole project. It catches overflow and it
// catches layout; it cannot catch the iOS keyboard, which is what `--kb` and the
// dock below it exist for. That half is Michael's phone or nothing.
import type { Page } from '@playwright/test';
import type { actions } from 'astro:actions';
import { test, expect, stubActions } from './fixtures';

type Returns<T> = T extends (...a: never[]) => Promise<infer R>
  ? R extends { data: infer D }
    ? NonNullable<D>
    : never
  : never;

const FRAGMENT = '11111111-2222-4333-8444-555555555555';
const ISO = '2026-07-20T10:00:00.000Z';

async function openPublished(page: Page) {
  await stubActions(page, {
    'fragments.get': (): Returns<typeof actions.fragments.get> => ({
      id: FRAGMENT,
      type: 'writing',
      title: 'A published piece',
      slug: 'a-published-piece',
      status: 'published',
      body: 'The published text, as readers see it.',
      excerpt: 'A blurb.',
      subjects: '',
      constellationIds: [],
      occurredIso: ISO,
      updatedAt: ISO,
      paired: null,
    }),
    'versions.list': (): Returns<typeof actions.versions.list> => ({
      canonical: { title: 'A published piece', preview: 'x', updatedAt: ISO },
      versions: [],
    }),
    'versions.saveWorking': () => ({ id: 'v1', updatedAt: ISO }),
  });
  await page.goto(`/admin/fragments#edit=${FRAGMENT}`);
  await expect(page.locator('#wsheet')).toBeVisible();
  await expect(page.locator('#ws-editor .tiptap-doc')).toBeVisible();
  // ⚠ The drawer slides in from the right — measure before it lands and every
  // child is still off to the right of where it will end up, which reads as an
  // overflow that isn't there. See the note in writing-header.spec.ts.
  const x = () => page.locator('#wsheet').evaluate((el) => Math.round(el.getBoundingClientRect().x));
  await expect
    .poll(async () => {
      const a = await x();
      await page.waitForTimeout(60);
      return (await x()) === a ? 'still' : 'moving';
    })
    .toBe('still');
}

test.describe('the writing sheet on a phone', () => {
  test('the command row does not scroll sideways', async ({ page }) => {
    await openPublished(page);
    const row = page.locator('#ws-command-row');
    const { scrollWidth, clientWidth } = await row.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    // A top bar you have to swipe, in a near-fullscreen drawer, hides its own
    // Save button. The TAB STRIP is what scrolls, and it does that inside its
    // own box.
    expect(scrollWidth).toBe(clientWidth);
  });

  test('the command row is ONE line', async ({ page }) => {
    await openPublished(page);
    // ⚠ THE POINT OF THE 2026-08-17 PASS. This row used to wrap below `sm`, and
    // what landed on the second line — autosave's sentence, the word count, the
    // view link's label — is what a phone least needed above the document.
    //
    // Measured on CENTRES, not top edges. The row is `items-center`, so children
    // of different heights legitimately start at different `y` on the SAME line:
    // the first version of this test read a spread of 18px across a button, a
    // tab strip and an sr-only span and called a perfectly flat row wrapped.
    // Centres collapse that — identical on one line, a whole line-height apart
    // on two — which is also why this asserts a SPREAD rather than the row's
    // height, a number that would pass just as well if the row grew for some
    // unrelated reason.
    const centres = await page.locator('#ws-command-row').evaluate((el) =>
      [...el.children]
        .filter((c) => c.getClientRects().length > 0)
        .map((c) => {
          const r = c.getBoundingClientRect();
          return Math.round(r.top + r.height / 2);
        }),
    );
    expect(centres.length, 'nothing visible in the row to measure').toBeGreaterThan(2);
    const spread = Math.max(...centres) - Math.min(...centres);
    expect(spread, `the row wrapped — children centre at ${[...new Set(centres)].join(', ')}`).toBeLessThanOrEqual(2);
  });

  test('autosave says nothing while it is working, and the count is desktop-only', async ({ page }) => {
    await openPublished(page);
    // Silent while healthy: the resting sentence is the surface's contract, not
    // news. The two states that ARE news carry a class and keep their words —
    // which is why this asserts on the resting element rather than deleting it.
    await expect(page.locator('#ws-status-text')).toBeHidden();
    await expect(page.locator('#ws-count')).toBeHidden();
    // Still in the DOM and still inside the live region, so a failure can speak.
    await expect(page.locator('#ws-status #ws-status-text')).toHaveCount(1);
  });

  test('the primary action is on screen and reachable without scrolling the row', async ({ page }) => {
    await openPublished(page);
    for (const sel of ['#ws-save-changes', '#ws-view-link', '#ws-more-btn']) {
      const box = await page.locator(sel).boundingBox();
      expect(box, `${sel} has no box`).not.toBeNull();
      expect(box!.x, `${sel} starts off-screen`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${sel} runs off the right edge`).toBeLessThanOrEqual(390);
    }
  });

  test('the tab strip scrolls rather than pushing the row wide', async ({ page }) => {
    await openPublished(page);
    const tabs = page.locator('#ws-tabs');
    const { scrollWidth, clientWidth } = await tabs.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    // Four tabs and their counts genuinely don't fit 390px, so this SHOULD
    // overflow — the assertion is that the overflow is contained here, which is
    // what keeps the row above at scrollWidth === clientWidth.
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    // And every tab is still reachable by scrolling the strip itself.
    await expect(page.locator('#ws-tabs [data-tab="doc"]')).toBeVisible();
  });

  test('the ✕ is on the right, clear of the primary action', async ({ page }) => {
    await openPublished(page);
    const close = await page.locator('#ws-command-row [data-ws-close]').boundingBox();
    const save = await page.locator('#ws-save-changes').boundingBox();
    expect(close, 'no close button in the row').not.toBeNull();
    expect(save, 'no primary action in the row').not.toBeNull();
    // Every other sheet in the building puts it last (SheetHeader). This one was
    // the outlier until 2026-08-17.
    expect(close!.x, 'the ✕ is still to the left of the primary action').toBeGreaterThan(save!.x + save!.width);
    // And far enough from it that a thumb cannot mean one and hit the other —
    // the divider plus its margins. Adjacency is the cost of moving it right.
    expect(close!.x - (save!.x + save!.width), 'the ✕ is crowding the primary action').toBeGreaterThanOrEqual(8);
  });

  test('the formatting toolbar docks BELOW the document', async ({ page }) => {
    await openPublished(page);
    const tools = await page.locator('#ws-toolbar').boundingBox();
    const scroll = await page.locator('#ws-scroll').boundingBox();
    expect(tools, 'no toolbar').not.toBeNull();
    expect(scroll, 'no document scroller').not.toBeNull();
    // Where your thumbs are, and where the keyboard will open under it. On the
    // desktop layout it is the other way round — same DOM, `order` only.
    expect(tools!.y, 'the toolbar is still above the document').toBeGreaterThanOrEqual(scroll!.y + scroll!.height - 1);
  });

  test('Delete is at the foot of the document, not in the row', async ({ page }) => {
    await openPublished(page);
    await expect(page.locator('#ws-command-row #ws-delete')).toHaveCount(0);
    const zone = page.locator('#ws-delete-zone');
    await zone.scrollIntoViewIfNeeded();
    await expect(zone).toBeVisible();
  });
});
