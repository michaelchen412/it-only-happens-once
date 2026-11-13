// The publish dialog's custom posted date starts OFF — for every piece.
//
// ⚠ IT STARTED ON FOR EVERY EXISTING PIECE, and the tick is what sends the
// date. So a draft written in September and published in November went out
// dated September: the dialog promises "set automatically when you publish",
// and the checkbox quietly overrode it with the day the draft was created.
// Michael, 2026-11-13, noticed the box ticked. See `populate` in
// writing-sheet.ts for why unticked is also right for a published piece.
//
// STUBBED `fragments.get`, so the piece can be a draft or published on demand
// and nothing here writes.
import type { actions } from 'astro:actions';
import { expect, test, fixtures, stubActions } from './fixtures';

type FragmentGet = Awaited<ReturnType<typeof actions.fragments.get.orThrow>>;

const FRAGMENT = '11111111-2222-3333-4444-555555555555';
const MADE = '2026-09-02T00:00:00.000Z';

async function openDialog(page: import('@playwright/test').Page, status: 'draft' | 'published') {
  const { constellationId } = fixtures();
  test.skip(!constellationId, 'no constellation to reach the composer from');
  await stubActions(page, {
    'fragments.get': (): FragmentGet => ({
      id: FRAGMENT,
      type: 'writing',
      title: `A ${status} piece`,
      slug: `a-${status}-piece`,
      excerpt: '',
      body: 'Some words.',
      status,
      occurredIso: MADE,
      updatedAt: MADE,
      subjects: '',
      constellationIds: [],
      music: null,
    }),
    'versions.list': () => ({ canonical: null, versions: [] }),
  });
  await page.goto(`/admin/constellations/${constellationId}#edit=${FRAGMENT}`);
  await expect(page.locator('#wsheet input[name="title"]')).toHaveValue(`A ${status} piece`);
  // The same dialog, two doors: "Publish…" on a draft, and "Post details" in
  // the ⋯ menu once a piece is live.
  if (status === 'draft') {
    await page.locator('#ws-open-publish').click();
  } else {
    await page.locator('#ws-more-btn').click();
    await page.locator('#ws-open-details').click();
  }
  await expect(page.locator('#publish-dialog')).toBeVisible();
}

test.describe('the custom posted date', () => {
  test('is off for an existing DRAFT, so its first publish is dated today', async ({ page }) => {
    await openDialog(page, 'draft');
    await expect(page.locator('#date-toggle')).not.toBeChecked();
    await expect(page.locator('#occurred-field')).toBeDisabled();
    await expect(page.locator('#date-auto-note')).toHaveText(/set automatically when you publish/);
  });

  test('is off for a PUBLISHED piece too, which keeps the date it was posted', async ({ page }) => {
    await openDialog(page, 'published');
    await expect(page.locator('#date-toggle')).not.toBeChecked();
    await expect(page.locator('#date-auto-note')).toHaveText(/keeps the date it was first posted/);
  });

  test('ticking it starts from the stored date, not from now', async ({ page }) => {
    await openDialog(page, 'draft');
    await page.locator('#date-toggle').check();
    await expect(page.locator('#occurred-field')).toBeEnabled();
    // Local-time round trip of 2026-09-02T00:00Z — the day, in any zone this runs in.
    await expect(page.locator('#occurred-field')).toHaveValue(/^2026-09-0[12]T/);
    await expect(page.locator('#date-auto-note')).toBeHidden();
  });
});
