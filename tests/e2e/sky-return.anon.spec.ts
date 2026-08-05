// The sky remembers where you were (plan 18).
//
// The complaint, stated as a number: "I don't see the title return back to its
// original position." So the assertion this whole file is built around is not
// `scrollY` — it is the clicked name's `getBoundingClientRect().top`, before
// and after. `scrollY` is checked too, but it is the weaker claim: it can only
// say the page is in the same place, not that the NAME is.
//
// Signed out on purpose. This is the front door — the one item on the board a
// visitor would ever notice — and `anon` runs with no storageState, so these
// measurements are taken by a genuinely strange browser. Read-only by
// construction: `/` and `/{slug}` are GET surfaces and nothing here writes, so
// unlike the admin specs there is no action to stub.
//
// ⚠ WHY SEVEN WAYS AND NOT FIVE. design.md §13 gives a suite five deliberate
// ways home (the ✦, the name, the outro, the floating ✦, Escape) — and
// SiteLayout puts a wordmark and a Home nav item on the same page, which also
// land on `/`. Seven code paths to one destination is exactly the situation
// that looks fine one at a time and wrong in sequence, so every one of them is
// driven here rather than assumed. If a future change wires the restore into
// the affordances instead of into the arrival, this is where it shows up.
//
// ⚠ GEOMETRY, NOT THE TWEEN. Chromium runs view transitions under Playwright,
// but asserting on an animation mid-flight is how you get a flaky spec. Every
// assertion below reads the settled DOM through `toPass`, never the
// pseudo-elements.
import { test, expect, type Page } from '@playwright/test';
import { hideDevToolbar } from './fixtures';

/** Sub-pixel layout and font rendering; anything larger is a real miss. */
const TOL = 2;

interface Picked {
  slug: string;
  /** where the name sat in the viewport when we left through it */
  top: number;
  scrollY: number;
}

/**
 * Scroll into the middle of the sky and open whichever constellation is
 * sitting comfortably in view.
 *
 * Picked by POSITION rather than by slug on purpose: the admin index can drag
 * the sky into a new order and a name's tier changes with its fragment count,
 * so a spec that hardcodes "the fourth one" is a spec that starts failing for
 * reasons that have nothing to do with this feature.
 */
async function openFromMidSky(page: Page): Promise<Picked> {
  await page.goto('/');
  // ⚠ Wait for the sky BEFORE touching the toolbar. `goto` resolves on `load`,
  // but a cold Vite compile of this route can still send a full-reload down the
  // HMR socket a moment later — and `hideDevToolbar`'s `evaluate` then dies
  // with "execution context was destroyed", which reads exactly like a broken
  // page. Waiting on the page's own content first removes the race.
  await expect(page.locator('[data-sky-slot]').first()).toBeVisible();
  await hideDevToolbar(page);

  await page.evaluate(() =>
    window.scrollTo({ top: Math.round(document.documentElement.scrollHeight * 0.45), behavior: 'instant' }),
  );

  const picked = await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-sky-slot]')) {
      const top = el.getBoundingClientRect().top;
      // clear of the 56px sticky header, and clear of the fold
      if (top > 140 && top < window.innerHeight - 220) {
        return { slug: el.dataset.skySlot as string, top, scrollY: window.scrollY };
      }
    }
    return null;
  });

  expect(picked, 'the sky must be long enough to scroll and still show a name').not.toBeNull();
  // Without this the whole file could pass at scroll 0, which is the exact bug.
  expect(picked!.scrollY, 'nothing is being tested unless we actually scrolled').toBeGreaterThan(0);

  await page.locator(`[data-sky-slot="${picked!.slug}"]`).click();
  await page.waitForURL(`/${picked!.slug}`);
  await expect(page.locator('.suite-item').first()).toBeVisible();
  return picked!;
}

/** The name is back in its own line — the complaint, inverted. */
async function expectNameBackInItsLine(page: Page, picked: Picked): Promise<void> {
  await page.waitForURL('/');
  await expect(async () => {
    const now = await page.evaluate((slug) => {
      const el = document.querySelector<HTMLElement>(`[data-sky-slot="${slug}"]`);
      return el ? { top: el.getBoundingClientRect().top, scrollY: window.scrollY } : null;
    }, picked.slug);

    expect(now, 'the overview must be back').not.toBeNull();
    expect(
      Math.abs(now!.top - picked.top),
      `"${picked.slug}" left from ${Math.round(picked.top)}px and returned to ${Math.round(now!.top)}px`,
    ).toBeLessThanOrEqual(TOL);
    expect(Math.abs(now!.scrollY - picked.scrollY), 'and the page is where it was').toBeLessThanOrEqual(TOL);
  }).toPass({ timeout: 5_000 });
}

/** Every way out of a suite. The point is that none of them knows about the
 *  restore — they all just navigate to `/`. */
const WAYS: { name: string; take: (page: Page) => Promise<void> }[] = [
  {
    name: 'the ✦ beside the title',
    take: async (page) => void (await page.locator('a.sky-star[href="/"]').click()),
  },
  {
    name: 'the title itself',
    take: async (page) => void (await page.locator('h1 a[href="/"]').click()),
  },
  {
    name: 'the return at the foot',
    take: async (page) => void (await page.locator('a.return-link').click()),
  },
  {
    name: 'the floating ✦, from the very bottom',
    take: async (page) => {
      // The deepest return — furthest to travel, and the one most likely to
      // expose a wrong offset. It only appears past 0.75 of a screen, and its
      // resting state is `opacity: 0; pointer-events: none`, which Playwright
      // still counts as "visible" — so wait on the class the script sets,
      // not on visibility, or the click races the scroll handler.
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      const star = page.locator('[data-sky-return]');
      await expect(star).toHaveClass(/is-visible/);
      await star.click();
    },
  },
  {
    name: 'Escape',
    // The one that is not a link. A restore wired to click handlers would
    // silently skip it, which is the failure this entry exists to catch.
    take: async (page) => await page.keyboard.press('Escape'),
  },
  {
    name: 'the wordmark',
    take: async (page) => void (await page.locator('header a[aria-label*="home"]').click()),
  },
  {
    name: 'the Home nav item',
    take: async (page) => void (await page.locator('#site-menu a[href="/"]').click()),
  },
];

test.describe('the name returns to its own line', () => {
  for (const way of WAYS) {
    test(`via ${way.name}`, async ({ page }) => {
      const picked = await openFromMidSky(page);
      await way.take(page);
      await expectNameBackInItsLine(page, picked);
    });
  }
});

test.describe('with reduced motion', () => {
  // The position is the substance; the motion is the polish. Someone who asked
  // for less motion gets no animation to explain a jump, so they need the
  // destination to be right MORE, not less. This also guards a real trap:
  // app.css flips `scroll-behavior` from smooth to auto under this media
  // query, so an implementation that forgot `behavior: 'instant'` would pass
  // here and fail everywhere else.
  //
  // `page.emulateMedia` rather than `test.use({ reducedMotion })`: the latter
  // runs, but `astro check` rejects it — a describe-level `test.use` is typed
  // against fixture overrides, not against the context options, so it is an
  // error in the one gate that has to stay green.
  test('the name still returns to its own line', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const picked = await openFromMidSky(page);
    await page.locator('a.return-link').click();
    await expectNameBackInItsLine(page, picked);
  });
});

test.describe('the correction lands before the transition does', () => {
  // ⚠ THE ASSERTION ABOVE CANNOT SEE THIS, AND THAT WAS MEASURED, NOT ASSUMED.
  //
  // app.css sets `scroll-behavior: smooth` on <html>. Drop `behavior: 'instant'`
  // from the restore and the scroll ANIMATES instead of jumping — so the
  // geometry the browser captures for the reverse morph is taken at the OLD
  // scroll, the name flies to the wrong place exactly as before, and the page
  // then slides underneath it afterwards. Every one of the tests above still
  // passes, because `toPass` retries and the smooth scroll does eventually
  // arrive: the destination is right, the timing is wrong, and settled geometry
  // is blind to the difference. (Verified by making that exact change: 12/12
  // green with the bug in.)
  //
  // So this measures the one thing that distinguishes them — whether the
  // correction is already applied when `astro:after-swap` returns. That is not
  // an implementation detail smuggled into a test; it IS the requirement, and
  // it is Astro's own reason for documenting this hook: after-swap runs before
  // the view transition ends, so what happens here is what the morph aims at.
  // Anything later is a correction the visitor watches happen.
  test('the scroll is already correct when astro:after-swap returns', async ({ page }) => {
    const picked = await openFromMidSky(page);

    // Registered from the suite, so it runs AFTER the module's own handler —
    // listeners on one target fire in registration order, and the module's was
    // bound when the page loaded.
    await page.evaluate(() => {
      (window as Window & { __atSwap?: number[] }).__atSwap = [];
      document.addEventListener('astro:after-swap', () => {
        (window as Window & { __atSwap?: number[] }).__atSwap!.push(window.scrollY);
      });
    });

    await page.locator('a.return-link').click();
    await expectNameBackInItsLine(page, picked);

    const seen = await page.evaluate(() => (window as Window & { __atSwap?: number[] }).__atSwap ?? []);
    expect(seen, 'exactly one swap happened').toHaveLength(1);
    expect(
      Math.abs(seen[0] - picked.scrollY),
      `at after-swap the page was at ${seen[0]}px; it needed to already be at ${picked.scrollY}px ` +
        `for the morph to aim there. A smooth scroll reads 0 here and corrects itself afterwards.`,
    ).toBeLessThanOrEqual(TOL);
  });
});

test.describe('the edges', () => {
  test('a deep link has nothing to restore, and says so quietly', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // Land inside a suite with no stored slot at all — the case where the
    // module on the overview has never run.
    await page.goto('/');
    const slug = await page.locator('[data-sky-slot]').first().getAttribute('data-sky-slot');
    await page.goto(`/${slug}`);
    await expect(page.locator('a.return-link')).toBeVisible();
    await hideDevToolbar(page);
    await page.locator('a.return-link').click();
    await page.waitForURL('/');

    await expect(async () => {
      expect(await page.evaluate(() => window.scrollY), 'no memory means the top, not a guess').toBe(0);
    }).toPass({ timeout: 5_000 });
    expect(errors, 'and nothing throws on the way').toEqual([]);
  });

  test('coming home from somewhere else lands at the top', async ({ page }) => {
    // The narrow rule, stated as a test: the sky remembers where you were in
    // the constellation you left through — not forever, and not from anywhere.
    // Three navigations later, a page that silently scrolls itself reads as a
    // bug rather than as being remembered.
    const picked = await openFromMidSky(page);
    await page.locator('#site-menu a[href="/blog"]').click();
    await page.waitForURL('/blog');
    await page.locator('#site-menu a[href="/"]').click();
    await page.waitForURL('/');

    await expect(async () => {
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    }).toPass({ timeout: 5_000 });
    expect(picked.scrollY, 'and we really had been scrolled before').toBeGreaterThan(0);
  });

  test('the browser Back button still restores, on its own', async ({ page }) => {
    // Astro's own scroll restoration owns history navigation, and this fix
    // stands down for it (`navigationType === 'traverse'`). That inconsistency
    // — Back worked, the return links did not — is what diagnosed the bug in
    // the first place, so it is worth an assertion that it still holds.
    const picked = await openFromMidSky(page);
    await page.goBack();
    await expectNameBackInItsLine(page, picked);
  });
});
