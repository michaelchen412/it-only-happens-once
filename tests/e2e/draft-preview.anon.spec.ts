// Plan 01, the public half — and the half that matters if it's ever wrong.
//
// This project runs with NO storageState, so the browser here is a stranger.
// Same URLs as `draft-preview.spec.ts`, opposite expectations. The app-side
// filter is only half the story: RLS is the real boundary (verified separately
// against the live database), and this proves the two agree over HTTP.
import { test, expect } from '@playwright/test';
import { fixtures } from './fixtures';

test.describe('draft preview — signed out', () => {
  test('an unpublished essay is not there at all', async ({ page }) => {
    const { draftSlug } = fixtures();
    test.skip(!draftSlug, 'no unpublished essay in the database to probe');

    const response = await page.goto(`/blog/${draftSlug}`);
    expect(response?.status(), 'a draft must 404 for the public').toBe(404);

    await expect(page.getByText('This piece isn’t here.')).toBeVisible();
    // Not a word of it should reach the page — no title, no body, no bar.
    await expect(page.locator('article.post-article')).toHaveCount(0);
    await expect(page.getByText('only you can see this.')).toHaveCount(0);
  });

  test('a 404 carries no cache header, so the miss is never stored', async ({ page }) => {
    const { draftSlug } = fixtures();
    test.skip(!draftSlug, 'no unpublished essay in the database to probe');

    const response = await page.goto(`/blog/${draftSlug}`);
    const cacheControl = response?.headers()['cache-control'];
    expect(cacheControl === undefined || cacheControl.includes('no-store')).toBeTruthy();
  });

  test('the published essay is still public and still cacheable', async ({ page }) => {
    const { publishedSlug } = fixtures();
    const response = await page.goto(`/blog/${publishedSlug}`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toContain('s-maxage=60');
    await expect(page.locator('article.post-article h1')).toBeVisible();
  });

  test('the admin is still behind the door', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
