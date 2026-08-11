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

const { quoteSlug, richQuoteSlug, quoteConstellationSlug, publishedSlug } = fixtures();

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

// ── The same apparatus, in a constellation ──────────────────────────────────
//
// Michael, 2026-08-10: *"within the constellation view, the quotes should be
// clickable … they should show up in a sheet and, obviously, not in their own
// dedicated page, but basically the same feature set."*
//
// ⚠ THESE GUARD TWO FAILURES THAT DREW NOTHING AND THREW NOTHING, which is why
// they are worth their length. Both were found by driving the page, not by any
// check:
//   1. `Reveal` pairs its popovers at parse time, and template content lives in
//      a DocumentFragment `document.querySelectorAll` cannot see — so a cloned
//      citation control rendered, refused to open, and never showed its
//      underline.
//   2. astro-icon dedupes to a page-level <symbol>, which gets emitted inside
//      whichever inert <template> comes first — leaving every other instance's
//      <use> pointing at a node not in the document. The share mark had a
//      bounding box, reported `visible`, and drew NOTHING.
test.describe('a quote inside a constellation', () => {
  test.skip(!quoteConstellationSlug, 'no published constellation holds a published quote');

  test.beforeEach(async ({ page }) => {
    await page.goto(`/${quoteConstellationSlug}`);
    await expect(page.locator('#suite')).toBeVisible();
  });

  test('opens into the Reader rather than navigating away', async ({ page }) => {
    const trigger = page.locator('figure a[data-read]').first();
    const before = new URL(page.url()).pathname;
    await trigger.click();
    await expect(page.locator('#site-reader')).toBeVisible();
    // Same page, same scroll position — a sheet, not a destination.
    expect(new URL(page.url()).pathname).toBe(before);
    expect(new URL(page.url()).hash).toMatch(/^#read=/);
  });

  test('⚠ its citation control WORKS after being cloned', async ({ page }) => {
    // ⚠ WALKS THE SUITE FOR A QUOTE THAT HAS A CONTROL rather than taking the
    // first and skipping. Not every quote has one — an unattributed line with a
    // one-quote author has nothing behind its name, and renders none by design
    // — and a guard that skips on the common case guards nothing. This was
    // written as `.first()` and skipped silently on the very constellation it
    // was meant to cover.
    const triggers = page.locator('figure a[data-read]');
    const n = await triggers.count();
    let found = false;
    for (let i = 0; i < n; i++) {
      await triggers.nth(i).click();
      await expect(page.locator('#site-reader')).toBeVisible();
      if ((await page.locator('#site-reader .rv__trigger').count()) > 0) {
        found = true;
        break;
      }
      await page.keyboard.press('Escape');
    }
    expect(found, 'no quote in this suite has a citation or a sibling — pick another fixture').toBe(true);

    // The gate the script sets. Without it the underline never appears, so the
    // control is not merely broken — it is invisible AS a control.
    await expect(page.locator('#site-reader [data-rv-live]').first()).toBeVisible();
    await page.locator('#site-reader .rv__trigger').first().click();
    await expect(page.locator('.rv__pop:popover-open')).toBeVisible();
  });

  test('⚠ its share mark actually DRAWS — a dangling <use> has a bounding box', async ({ page }) => {
    const trigger = page.locator('figure a[data-read]').first();
    await trigger.click();
    const mark = page.locator('#site-reader [data-share]').first();
    await expect(mark).toBeVisible();
    const drew = await mark.evaluate((el) => {
      const use = el.querySelector('use');
      // A sprite reference is only real if its symbol is in THIS document.
      if (use) return Boolean(document.getElementById((use.getAttribute('href') ?? '').slice(1)));
      return Boolean(el.querySelector('svg path'));
    });
    expect(drew, 'the glyph is laid out but paints nothing').toBe(true);
  });

  test('does not offer a door back into the constellation you are standing in', async ({ page }) => {
    const trigger = page.locator('figure a[data-read]').first();
    const here = new URL(page.url()).pathname;
    await trigger.click();
    const control = page.locator('#site-reader .qp-ctl', { hasText: /constellation/ });
    if ((await control.count()) === 0) return; // only in this one → correctly absent
    await control.click();
    const hrefs = await page
      .locator('.rv__pop:popover-open a')
      .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')));
    expect(hrefs).not.toContain(here);
  });
});

// ── The essay closes the same way ───────────────────────────────────────────
//
// ADR-0023. The share mark shipped at an essay's HEAD and moved to the foot:
// published essays average 5,738 characters and run to 14,296, so the reader who
// has just finished — the one the whole feature is for — was thousands of pixels
// below it.
test.describe('an essay closes with its apparatus', () => {
  test.skip(!publishedSlug, 'no published essay in the database');

  test.beforeEach(async ({ page }) => {
    await page.goto(`/blog/${publishedSlug}`);
    await expect(page.locator('.post-article')).toBeVisible();
  });

  test('THE SHARE MARK IS BELOW THE PROSE, not above it', async ({ page }) => {
    const body = (await page.locator('.post-article .reading').boundingBox())!;
    const mark = (await page.locator('[data-share]').boundingBox())!;
    expect(mark.y, 'the share mark is back in the header').toBeGreaterThan(body.y + body.height);
  });

  test('there is exactly ONE of them — moved, not duplicated', async ({ page }) => {
    // Two would be the same redundancy that deleted the paired-song caption.
    await expect(page.locator('[data-share]')).toHaveCount(1);
  });

  test('the header carries only what a reader needs before committing', async ({ page }) => {
    // The date and the read time. Subjects moved down with the share mark, so
    // the runway from title to first sentence is one row of chrome, not four.
    const head = page.locator('.post-article > div').first();
    await expect(head).toContainText('min read');
    const links = await head.locator('a[href*="subject="]').count();
    expect(links, 'the subjects are back in the header').toBe(0);
  });

  test('the subjects are in the strip, and still filter the feed', async ({ page }) => {
    const strip = page.locator('[data-share]').locator('..');
    const first = strip.locator('a[href*="subject="]').first();
    await expect(first).toBeVisible();
    // Writing filters the writing feed — no `view=quotes` on an essay's tags.
    expect(await first.getAttribute('href')).not.toContain('view=quotes');
  });

  test('and it closes the piece inside the Reader too, not only on the page', async ({ page }) => {
    await page.goto('/blog');
    await page.locator('.post-title a').first().click();
    await expect(page.locator('#site-reader')).toBeVisible();
    const mark = page.locator('#site-reader [data-share]');
    await expect(mark).toHaveCount(1);
    const body = (await page.locator('#site-reader .reading').boundingBox())!;
    expect((await mark.boundingBox())!.y).toBeGreaterThan(body.y + body.height);
  });
});
