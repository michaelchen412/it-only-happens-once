// A quote's own page — `/blog/<slug>` serving something that is not an essay
// (plan 32 · §3).
//
// Signed out ON PURPOSE. This is a reader-facing surface and `anon` runs with no
// storageState, so every assertion here is made by a genuinely strange browser.
// It also proves the RLS side incidentally: the page reads `authors`,
// `constellations` and `fragment_subjects`, and a policy that closed any of them
// would empty a control rather than error, which is exactly the kind of silence
// a spec is for.
//
// ⚠ Read-only by construction. Every route is a GET, and the one control that is
// clicked (a popover trigger) writes nothing. The share mark is deliberately NOT
// pressed: `navigator.share` opens an OS sheet chromium cannot dismiss, and the
// clipboard path needs a permission grant that would make the assertion about
// the grant rather than about the button. That gap is real and is on plan 32's
// hands list — a phone, once, by a person.
import { test, expect } from './fixtures';
import { fixtures } from './fixtures';

const { quoteSlug, richQuoteSlug } = fixtures();

test.describe('the route serves a quote', () => {
  test.skip(!quoteSlug, 'no published quote in the database');

  test('a quote slug renders its own page, not a 404', async ({ page }) => {
    // Before 2026-08-10 `getWritingBySlug` hard-filtered `type = writing`, so
    // every quote slug on the site answered 404. This is the whole §3.
    const res = await page.goto(`/blog/${quoteSlug}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('figure blockquote')).toBeVisible();
  });

  test('an unknown slug still 404s — the branch did not become a catch-all', async ({ page }) => {
    // The control for the test above. A route that answers 200 for everything
    // would pass the first assertion and be badly broken.
    const res = await page.goto('/blog/definitely-not-a-real-fragment-slug');
    expect(res?.status()).toBe(404);
  });

  test('the card describes the quote, because the quote IS what is shared', async ({ page }) => {
    await page.goto(`/blog/${quoteSlug}`);
    const body = ((await page.locator('figure blockquote').innerText()) ?? '').trim();
    const description = await page.locator('meta[property="og:description"]').getAttribute('content');
    // A client that ignores the image still shows the line.
    expect(description).toBeTruthy();
    expect(body.startsWith(description!.slice(0, 40))).toBe(true);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/blog/${quoteSlug}$`));
  });
});

test.describe('the strip', () => {
  test.skip(!richQuoteSlug, 'no published quote that is both placed and by a repeat author');

  test.beforeEach(async ({ page }) => {
    await page.goto(`/blog/${richQuoteSlug}`);
    await expect(page.locator('figure blockquote')).toBeVisible();
  });

  test('THE SHARE MARK DOES NOT MOVE WITH THE STRIP — the whole reason it is on the rule', async ({ page }) => {
    // Michael's complaint about the version that trailed the controls: "it kind
    // of just oddly sits to the right, especially when it gets to 2 lines since
    // it moves with the related stuff". It is now absolutely positioned to the
    // strip's top-right, which IS the rule's right terminus — so its right edge
    // must equal the rule's, whatever wraps beneath it.
    const strip = page.locator('[data-share]').locator('..');
    const mark = page.locator('[data-share]');
    const s = (await strip.boundingBox())!;
    const m = (await mark.boundingBox())!;
    expect(Math.abs(s.x + s.width - (m.x + m.width))).toBeLessThan(2);
    // And it straddles the rule rather than clearing it.
    expect(Math.abs(s.y - (m.y + m.height / 2))).toBeLessThan(3);
  });

  test('the share mark is a 44px target and says what it does', async ({ page }) => {
    // Icon-only, so the accessible name and the tap target are the only things
    // carrying what the word used to say for free (plan 19 · Piece 8).
    const mark = page.locator('[data-share]');
    await expect(mark).toHaveAttribute('aria-label', /share/i);
    await expect(mark).toHaveAttribute('title', /share/i);
    const box = (await mark.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  });

  test('the constellations control opens onto real doors, in their own colours', async ({ page }) => {
    await page.getByRole('button', { name: /appears in/i }).click();
    const pop = page.locator('.rv__pop:popover-open');
    await expect(pop).toBeVisible();
    // Not a flat list: the Sky's own vocabulary, so a row carries a colour slot
    // and a star that can bloom.
    await expect(pop.locator('a[class*="cn-"]').first()).toBeVisible();
    await expect(pop.locator('.sky-star').first()).toBeVisible();
    const href = await pop.locator('a').first().getAttribute('href');
    expect(href).toMatch(/^\/[a-z0-9-]+$/); // a constellation, at the root
  });

  test('THE POPOVER DOES NOT COVER THE QUOTE — a modal in disguise is the bug', async ({ page }) => {
    // The bench's finding: a five-row box anchored to a strip ~62% down the page
    // has no room beneath it, flips above, and lands across the line you are
    // reading. The cap on `.rv__pop--wide` exists for exactly this assertion.
    await page.getByRole('button', { name: /appears in/i }).click();
    const pop = (await page.locator('.rv__pop:popover-open').boundingBox())!;
    const quote = (await page.locator('figure blockquote').boundingBox())!;
    expect(pop.y, 'the popover opened over the quote').toBeGreaterThan(quote.y + quote.height);
  });

  test('the attribution opens even when the citation is empty — the author is the second door', async ({ page }) => {
    // §5. Before this, an attribution with no citation behind it was inert, so a
    // plainly-quoted person was a dead end.
    const trigger = page.locator('figcaption .rv__trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();
    const pop = page.locator('.rv__pop:popover-open');
    await expect(pop.locator('a[href*="author="]')).toBeVisible();
  });
});
