// Plan 16 · Piece 1, at 390px — the width the writing sheet had never been
// opened at. `admin-layout.mobile.spec.ts` exists and measures the chrome;
// nothing measured this row, which before this piece held thirteen children
// with no `flex-wrap` and could therefore only overflow.
//
// ⚠ Chromium at 390px, not Safari on a phone — the caveat playwright.config.ts
// already writes down about this whole project. It catches overflow; it cannot
// catch the iOS keyboard.
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
    // Save button. Below `sm` the row wraps instead; the TAB STRIP is what
    // scrolls, and it does that inside its own box.
    expect(scrollWidth).toBe(clientWidth);
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

  test('Delete is at the foot of the document, not in the row', async ({ page }) => {
    await openPublished(page);
    await expect(page.locator('#ws-command-row #ws-delete')).toHaveCount(0);
    const zone = page.locator('#ws-delete-zone');
    await zone.scrollIntoViewIfNeeded();
    await expect(zone).toBeVisible();
  });
});
