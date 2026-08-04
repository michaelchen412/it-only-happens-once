// Plan 01, the admin half: an unpublished essay renders on its real public URL
// for the person who wrote it, and is marked unmistakably as not-yet-public.
//
// The paired spec `draft-preview.anon.spec.ts` asserts the opposite for the
// same URL. Neither is meaningful alone — read them together.
import { test, expect } from '@playwright/test';
import { fixtures } from './fixtures';

test.describe('draft preview — signed in as the admin', () => {
  test('an unpublished essay renders instead of 404ing', async ({ page }) => {
    const { draftSlug } = fixtures();
    test.skip(!draftSlug, 'no unpublished essay in the database to preview');

    const response = await page.goto(`/blog/${draftSlug}`);
    expect(response?.status(), 'the admin should get the page, not a 404').toBe(200);

    // The piece itself is there — not an empty shell with a bar on top.
    await expect(page.locator('article.post-article h1')).toBeVisible();
    await expect(page.getByText('This piece isn’t here.')).toHaveCount(0);
  });

  test('says plainly that it is not public, and offers the way back', async ({ page }) => {
    const { draftSlug, draftStatus } = fixtures();
    test.skip(!draftSlug, 'no unpublished essay in the database to preview');

    await page.goto(`/blog/${draftSlug}`);

    const label = draftStatus === 'note' ? 'A note' : 'Draft';
    await expect(page.getByText(`${label} — only you can see this.`)).toBeVisible();

    // The bar is the ONE difference from the live page, so it has to survive
    // scrolling down a long draft — that's what `sticky` is buying.
    const bar = page.getByText(`${label} — only you can see this.`);
    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect(bar).toBeInViewport();

    await expect(page.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', /^\/admin\/fragments#edit=/);
  });

  // The one way to get this feature badly wrong: a draft cached at the edge and
  // served to the public by a machine that never saw the session.
  test('a preview is never cacheable, and a published page still is', async ({ page }) => {
    const { draftSlug, publishedSlug } = fixtures();
    test.skip(!draftSlug, 'no unpublished essay in the database to preview');

    const draft = await page.goto(`/blog/${draftSlug}`);
    expect(draft?.headers()['cache-control']).toBe('private, no-store');

    const live = await page.goto(`/blog/${publishedSlug}`);
    expect(live?.headers()['cache-control']).toContain('s-maxage=60');
  });

  test('a published essay shows no preview bar to anyone, admin included', async ({ page }) => {
    const { publishedSlug } = fixtures();
    await page.goto(`/blog/${publishedSlug}`);
    await expect(page.getByText('only you can see this.')).toHaveCount(0);
  });
});
