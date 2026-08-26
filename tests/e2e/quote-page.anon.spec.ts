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

  test('⚠ THE POPOVER STAYS ON SCREEN — the other half of the 0×0 bug', async ({ page }) => {
    // §4a fixed two corrections that were both reading a `display: none` box as
    // 0×0. The flip-above half has a spec above; THIS is the clamp half, and it
    // is the one that actually ran a box off the edge. It never fired in the
    // shipped component because its only trigger sat at the left of the measure
    // — the strip's controls are right-aligned, so they are what exposes it.
    //
    // Real numbers at 1280: the trigger sits near x≈1150 and the box is 416
    // wide, so an unclamped `left = r.left - 8` puts its right edge at ~1558.
    // ⚠ THE RIGHT-MOST control, whichever it is, not a named one. The clamp's
    // worst case is the trigger nearest the edge, and which control that is
    // depends on what this quote happens to have — the first version asked for
    // "related lines" and skipped on a fixture that only had a constellation.
    const controls = page.locator('.qp-ctl');
    const n = await controls.count();
    expect(n, 'this quote has no strip controls at all').toBeGreaterThan(0);
    await controls.nth(n - 1).click();
    const box = (await page.locator('.rv__pop:popover-open').boundingBox())!;
    const vw = page.viewportSize()!.width;
    expect(box.x, 'the popover ran off the left edge').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'the popover ran off the right edge').toBeLessThanOrEqual(vw);
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
    /*
      ⚠ ITS OWN ESSAY, NOT THE `beforeEach`'s. This is the one test in the block
      that needs the piece to HAVE subjects, and `publishedSlug` is only ever
      "the first published essay back" — which on 2026-08-15 was one with zero of
      them. The result was a red spec on a public page and a look through the
      database for a fault that was not there.

      `subjectedEssaySlug` is discovered in auth.setup.ts, the same way
      `richQuoteSlug` is and for the same reason: a spec that needs a richer row
      than "any" should ask for that shape and SKIP when the corpus has none,
      rather than assert against whatever turned up first. The four tests around
      this one still want the ordinary case, so the shared fixture is untouched.
    */
    const { subjectedEssaySlug } = fixtures();
    test.skip(!subjectedEssaySlug, 'no published essay in the corpus carries a subject');
    await page.goto(`/blog/${subjectedEssaySlug}`);
    await expect(page.locator('.post-article')).toBeVisible();

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

/*
  ⚠ THE APPARATUS WORKS WHEN THE READER **FETCHED** THE PIECE, and until
  2026-08-21 it did not. The Reader has two sources (Reader.astro): a
  `<template>` shipped with the feed, or the permalink fetched over the network
  when the page carries no template for that slug. Every spec above walks the
  template path, and the template path was the one that worked — by an accident
  of the platform, since cloning template content DOES execute the scripts
  inside it. A `DOMParser` document marks its scripts "already started", so the
  copy inside a FETCHED essay can never run, and on a feed page whose only other
  copy is sealed inside a template the pairing code never ran at all. The strip
  rendered perfectly and every control in it was dead: "1 constellation" and "7
  related" were plain text, and the share mark was a button that did nothing.
  Confirmed on the live site before the fix.

  THE SEARCH IS THE LEVER, and it is deterministic where pagination is not: a
  query that matches nothing ships NO reader templates, so `#read=<slug>` on
  that page has no choice but to fetch. Same slug, same essay, other source.
*/
test.describe('an essay the Reader had to FETCH', () => {
  test.skip(!publishedSlug, 'no published essay in the database');

  /** A slug whose closing strip actually HAS a reveal — half the corpus does
   *  not, and a spec that asserts against whatever turned up first is the
   *  mistake `subjectedEssaySlug` was invented to stop making. */
  async function slugWithAReveal(page: import('@playwright/test').Page): Promise<string | null> {
    await page.goto('/blog');
    return page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLTemplateElement>('template[data-reader-content]')].find(
          (t) => t.content.querySelector('[data-rv]') !== null,
        )?.dataset.readerContent ?? null,
    );
  }

  test('its share mark is bound — a fetched article brings no working scripts of its own', async ({ page }) => {
    await page.goto(`/blog?q=zzq-matches-nothing#read=${publishedSlug}`);
    await expect(page.locator('#site-reader .reading')).toBeVisible();
    await expect(page.locator('template[data-reader-content]'), 'the search still shipped templates').toHaveCount(0);
    // The behaviour is delegated from `document` and flags itself on <html>, so
    // this asks the one question that matters: did the delegation get installed?
    await expect(page.locator('html')).toHaveAttribute('data-share-bound', '1');
    await expect(page.locator('#site-reader [data-share]')).toHaveCount(1);
  });

  test('its reveals pair, open, and follow the sheet when it scrolls', async ({ page }) => {
    const slug = await slugWithAReveal(page);
    test.skip(!slug, 'no essay on the feed closes with a constellation or a related list');

    await page.goto(`/blog?q=zzq-matches-nothing#read=${slug}`);
    const host = page.locator('#site-reader .reader-inner [data-rv]').first();
    await expect(host).toBeAttached();
    // `[data-rv-live]` IS the gate: no attribute, no underline, no popover.
    await expect(host).toHaveAttribute('data-rv-live', '');

    const trigger = host.locator('.rv__trigger');
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const pop = host.locator('.rv__pop');
    await expect(pop).toBeVisible();

    /*
      ⚠ AND IT TRACKS THE SHEET'S SCROLLER, NOT THE WINDOW. A `scroll` event does
      not bubble, so a listener on `window` hears the page and nothing else — and
      inside the Reader the page does not scroll at all: <html> is locked and
      `.reader-scroll` is the scroller. The box kept its 8px gap while the essay
      moved out from under it. Adjacency, not a fixed edge: near the viewport
      floor the box legitimately flips above its trigger.

      ⚠⚠ AND BELOW `sm` THE INVARIANT IS A DIFFERENT ONE, WHICH IS WHY THIS SPEC
      WAS RED ON A PRODUCT THAT WAS RIGHT (fixed 2026-08-26). A `--wide` reveal
      at ≤639px deliberately STOPS being an anchored popover and becomes a bottom
      sheet — Reveal.astro argues it at length: a five-row box has no room under
      a trigger halfway down a phone, and a tooltip that fills the screen "is a
      modal pretending to be a tooltip, dismissed by tapping a part of the screen
      whose point the reader can no longer see." `place()` returns early for it
      and CSS pins it to the floor. Asking a sheet to sit 24px from its trigger
      asks it to stop being a sheet; it measured 51px and was correct.

      So the mobile question is the one that actually matters there: does it stay
      PINNED while the essay scrolls under it? That is the same defect in the
      same clothes — a box that drifts away from the reader's thumb — and it is
      what the window-vs-scroller bug would have broken here too.
    */
    const isSheet = await pop.evaluate(
      (el) => el.classList.contains('rv__pop--wide') && matchMedia('(max-width: 639px)').matches,
    );

    /** Anchored: the gap to the trigger, whichever side it took. Sheet: the gap to the viewport floor. */
    const drift = async () =>
      page.evaluate((sheet) => {
        const p = document.querySelector('#site-reader .rv__pop')!.getBoundingClientRect();
        if (sheet) return Math.abs(window.innerHeight - p.bottom);
        const t = document.querySelector('#site-reader .reader-inner .rv__trigger')!.getBoundingClientRect();
        return Math.min(Math.abs(p.top - t.bottom), Math.abs(t.top - p.bottom));
      }, isSheet);

    expect(await drift()).toBeLessThan(24);
    await page.evaluate(() => document.querySelector('#site-reader .reader-scroll')!.scrollBy(0, -120));
    await expect
      .poll(drift, {
        message: isSheet ? 'the sheet came unpinned from the floor' : 'the popover stayed put while the sheet moved',
      })
      .toBeLessThan(24);
  });
});
