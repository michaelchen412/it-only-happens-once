// The reader sheet's EXIT — that closing it animates instead of vanishing.
//
// ⚠ WHY A SPEC FOR AN ANIMATION. This is the shape CLAUDE.md §9a warns about:
// the bug it guards shipped under a fully green run and stayed for weeks.
// Nothing was wrong with the CSS — the drawer's 0.28s slide-out was correct and
// had its own careful comment in admin.css. What was wrong was two blocks of
// code that never met: the reader wrote its own hash (`location.hash = …`),
// which the ClientRouter never learns about, so the `history.back()` that closes
// the sheet read to the router as a PAGE navigation. It refetched `/blog` and
// swapped the document — **73ms into the 280ms slide** — throwing away the
// dialog node mid-animation. The sheet began to leave, then disappeared.
//
// No compiler, unit test or a11y check can see that. It is only visible as
// timing between a router and a transition, in a real browser. So the two
// assertions here are the two halves of the failure:
//
//   1. NO document swap on close — the sheet survives its own exit.
//   2. The exit actually RAN — `transitionend` for `translate` fires on a
//      dialog still attached to the document.
//
// Both are event-shaped rather than clock-shaped on purpose: asserting "it is
// 50% off-screen at 140ms" would fail on a slow CI box for a reason that has
// nothing to do with the bug.
//
// ⚠⚠ AND THERE WAS A SECOND CAUSE UNDERNEATH THE FIRST, which is why there is a
// third assertion. Fixing the swap made the exit correct in Chromium and
// changed nothing on a phone: animating a dialog OUT after `close()` needs the
// CSS `overlay` property to hold it in the top layer, and `overlay` is
// Chromium-only — absent in Safari (desktop and iOS) and Firefox. Every iOS
// browser is WebKit, so "Chrome on an iPhone" is Safari, and there the sheet
// still vanished in a frame. The cure is that the dialog now stays OPEN for the
// length of its slide and closes afterwards.
//
//   3. The exit ran on an OPEN dialog — `slidWhileOpen`. This is the only
//      assertion that would catch a regression to the `overlay`-dependent
//      pattern, because Chromium passes 1 and 2 either way. It is a property
//      test standing in for a browser this suite cannot run.
//
// Signed out, and read-only by construction — every route touched is a GET.
import type { Page } from '@playwright/test';
// ⚠ `test` FROM ./fixtures, never from @playwright/test — that import is what
// carries the read-only guard (2026-08-09). Only the TYPE comes from upstream.
import { test, expect } from './fixtures';

const READER = '#site-reader';

interface Exit {
  /** `astro:before-swap` fired — the document was replaced mid-close. */
  swapped: boolean;
  /** The slide-out ran to completion on a node still in the document. */
  slid: boolean;
  /**
   * The slide finished while the dialog was still OPEN — the whole of the
   * cross-engine fix, in one boolean. See the second test below.
   */
  slidWhileOpen: boolean;
  /** Still attached when the dust settled (a swap replaces the node). */
  sameNode: boolean;
  open: boolean;
  hash: string;
  /** The scroll-lock must be released, and only after the slide. */
  htmlClass: string;
}

/** Open the first thing on the page that opens the reader, and wait for it. */
async function openReader(page: Page): Promise<void> {
  const trigger = page.locator('[data-read]').first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator(READER)).toHaveJSProperty('open', true);
  // The sheet opens before it fills (it may be fetching); wait for the content
  // so the close is measured against a settled page, as a reader's would be.
  await expect(page.locator(`${READER} .reader-inner`)).not.toHaveText('Opening…');
  await expect(page).toHaveURL(/#read=/);
  // ⚠ AND WAIT FOR IT TO STOP MOVING, which the three assertions above do not
  // guarantee — they can all pass inside the 280ms slide-IN. Closing a sheet
  // that is still arriving REVERSES the transition, and a reversed transition is
  // shortened to match how far it got: caught in the act, `transitionend`
  // reported `elapsedTime: 0.035` and the sheet was shut 67ms after the press.
  // That is correct behaviour (dismiss something on its way in and it should
  // leave promptly) and useless as a measurement of the exit — it made this file
  // fail about half the time for a reason that had nothing to do with the code
  // under test.
  await page.waitForFunction(() => {
    const d = document.getElementById('site-reader');
    return !!d && ['0px', 'none', '0px 0px'].includes(getComputedStyle(d).translate);
  });
}

/**
 * Close the reader the given way and report what happened to the sheet.
 *
 * The listeners go on BEFORE the close and the promise resolves from events, so
 * this measures the exit rather than sampling it.
 */
async function closeReader(page: Page, how: 'button' | 'escape' | 'backdrop'): Promise<Exit> {
  await page.evaluate(() => {
    const d = document.getElementById('site-reader') as HTMLDialogElement;
    const w = window as unknown as {
      __exit: { swapped: boolean; slid: boolean; slidWhileOpen: boolean; node: Element };
    };
    w.__exit = { swapped: false, slid: false, slidWhileOpen: false, node: d };
    document.addEventListener('astro:before-swap', () => (w.__exit.swapped = true), { once: true });
    // `transitionend` fires once per property and bubbles; take the drawer's own
    // `translate` and ignore a hover transition on some button inside it.
    d.addEventListener('transitionend', (e) => {
      if (e.target !== d || e.propertyName !== 'translate' || !document.contains(d)) return;
      w.__exit.slid = true;
      // ⚠ THE ONE THAT TRAVELS. `d.open` is still true here because the sheet is
      // only closed AFTER its slide — which is what lets the animation run on an
      // engine without the `overlay` property. Chromium would pass this test
      // either way; Safari and Firefox only pass it this way.
      if (d.open) w.__exit.slidWhileOpen = true;
    });
  });

  if (how === 'escape') await page.keyboard.press('Escape');
  else if (how === 'backdrop')
    await page.mouse.click(20, 400); // the dimmed feed, left of the sheet
  // ⚠ `.first()` — the sheet carries TWO of these since 2026-08-19 (the sticky
  // "Back to the blog" at the top and its twin under the essay), and a bare
  // locator matching two elements is a strict-mode failure rather than a click.
  // The top one is the one always on screen, which is what this exercises.
  else await page.locator('[data-reader-close]').first().click();

  await expect(page.locator(READER)).toHaveJSProperty('open', false);
  // Long enough for the 0.28s slide plus the deferred scroll-unlock at 320ms.
  await page.waitForTimeout(700);

  return page.evaluate(() => {
    const d = document.getElementById('site-reader') as HTMLDialogElement;
    const w = window as unknown as {
      __exit: { swapped: boolean; slid: boolean; slidWhileOpen: boolean; node: Element };
    };
    return {
      swapped: w.__exit.swapped,
      slid: w.__exit.slid,
      slidWhileOpen: w.__exit.slidWhileOpen,
      sameNode: w.__exit.node === d && document.contains(d),
      open: d.open,
      hash: location.hash,
      htmlClass: document.documentElement.className,
    };
  });
}

for (const how of ['button', 'escape', 'backdrop'] as const) {
  test(`the reader slides out when closed by ${how}, without swapping the page`, async ({ page }) => {
    // ⚠ Below 640px the reader is a FULL-SCREEN sheet (admin.css `.reader`),
    // so there is no backdrop on screen to dismiss with — the affordance
    // itself is desktop-only, not merely hard to reach (plan 43 §7). Button
    // and Escape still run at every width; the phone's third way out is Back,
    // which has its own spec below.
    test.skip(
      how === 'backdrop' && (page.viewportSize()?.width ?? 1280) < 640,
      'no backdrop exists on a full-screen sheet',
    );
    await page.goto('/blog');
    await openReader(page);

    const exit = await closeReader(page, how);

    expect(exit.swapped, 'the document was swapped mid-close — the reader opened its hash outside the router').toBe(
      false,
    );
    expect(exit.slid, 'the slide-out never finished on the live node — the sheet vanished instead of leaving').toBe(
      true,
    );
    expect(
      exit.slidWhileOpen,
      'the slide finished on a CLOSED dialog — that only renders in Chromium, and on WebKit the sheet vanishes instantly',
    ).toBe(true);
    expect(exit.sameNode).toBe(true);
    expect(exit.open).toBe(false);
    expect(exit.hash).toBe('');
    // The lock is held THROUGH the slide and dropped after: released early and
    // the feed reflows sideways behind a still-moving drawer.
    expect(exit.htmlClass).not.toContain('scroll-locked');
  });
}

test('the quotes view closes the same way', async ({ page }) => {
  await page.goto('/blog?view=quotes');
  await openReader(page);

  const exit = await closeReader(page, 'button');

  expect(exit.swapped).toBe(false);
  expect(exit.slid).toBe(true);
  expect(exit.slidWhileOpen).toBe(true);
  expect(exit.hash).toBe('');
});

test('back closes the reader and forward reopens it', async ({ page }) => {
  await page.goto('/blog');
  await openReader(page);
  const slug = new URL(page.url()).hash.replace('#read=', '');

  // The browser's own Back is the same pop the close button triggers, so it
  // must take the same short circuit — no swap, and the sheet still animates.
  await page.evaluate(() => {
    const w = window as unknown as { __swapped: boolean };
    w.__swapped = false;
    document.addEventListener('astro:before-swap', () => (w.__swapped = true), { once: true });
  });
  await page.goBack();
  await expect(page.locator(READER)).toHaveJSProperty('open', false);
  // ⚠ WAIT BEFORE READING THE FLAG. A swap is not synchronous with the pop — it
  // has to fetch the page first, and it landed ~73ms in when this was broken.
  // Reading straight after `goBack` resolves says "no swap" on code that swaps,
  // which is how this assertion first passed against the bug it guards.
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as unknown as { __swapped: boolean }).__swapped)).toBe(false);

  // The entry we pushed is still there — closing must not have eaten it.
  await page.goForward();
  await expect(page.locator(READER)).toHaveJSProperty('open', true);
  await expect(page).toHaveURL(new RegExp(`#read=${slug}$`));
});

test('a deep-linked reader closes without leaving the page', async ({ page }) => {
  await page.goto('/blog');
  const slug = await page.locator('[data-read]').first().getAttribute('data-read');
  expect(slug).toBeTruthy();

  // Arrived already open: there is no pushed entry to pop, so the close strips
  // the hash in place. Different branch, same requirement — it must animate.
  await page.goto(`/blog#read=${slug}`);
  await expect(page.locator(READER)).toHaveJSProperty('open', true);

  const exit = await closeReader(page, 'escape');

  expect(exit.swapped).toBe(false);
  expect(exit.slid).toBe(true);
  expect(exit.hash).toBe('');
  await expect(page).toHaveURL(/\/blog$/);
});

test('reopening mid-slide keeps the new sheet, not the one that was leaving', async ({ page }) => {
  // Tapping a second fragment straight after dismissing the first. The close in
  // flight must stand down rather than shutting a sheet that has just been
  // handed new content — and it must not take the scroll-lock with it.
  //
  // ⚠ BOTH CLICKS ARE DISPATCHED FROM INSIDE THE PAGE, and that is the only way
  // this test means what it says. Driving it with `locator.click()` spends
  // ~300ms on actionability checks before the press lands, which is longer than
  // the 280ms slide — so the first draft of this test waited 90ms, reopened
  // after the sheet had already finished closing, and was measuring the
  // ordinary sequential path while claiming to measure the overlap. It failed
  // on timing noise rather than on behaviour.
  //
  // The trigger is also chosen BY SLUG rather than by index: a card carries
  // three `[data-read]` elements (title, excerpt, `Read →`), so `nth(1)` is the
  // same essay as `nth(0)` and the test proved nothing about switching.
  await page.goto('/blog');
  await openReader(page);
  const first = await page.locator(READER).getAttribute('data-reader-slug');
  expect(first).toBeTruthy();

  const after = await page.evaluate(async (firstSlug) => {
    const d = document.getElementById('site-reader') as HTMLDialogElement;
    const other = [...document.querySelectorAll<HTMLElement>('[data-read]')].find(
      (el) => el.dataset.read && el.dataset.read !== firstSlug,
    );
    if (!other) return { skipped: true } as const;

    document.querySelector<HTMLElement>('[data-reader-close]')!.click();
    await new Promise((r) => setTimeout(r, 90)); // squarely mid-slide
    const midSlide = { open: d.open, closing: d.dataset.closing ?? null };
    other.click();
    // Well past where the abandoned close would otherwise have landed, fallback
    // timer (350ms) included.
    await new Promise((r) => setTimeout(r, 900));
    return {
      skipped: false as const,
      midSlide,
      open: d.open,
      closing: d.dataset.closing ?? null,
      slug: d.dataset.readerSlug ?? null,
      locked: document.documentElement.classList.contains('scroll-locked'),
      chars: d.querySelector('.reader-inner')?.textContent?.trim().length ?? 0,
    };
  }, first);

  test.skip(after.skipped, 'this page has only one distinct fragment to open');
  if (after.skipped) return;

  // The overlap really happened — otherwise the rest asserts nothing.
  expect(after.midSlide.open, 'the sheet had already closed before the reopen').toBe(true);
  expect(after.midSlide.closing).toBe('1');

  expect(after.open, 'the abandoned close shut the sheet that replaced it').toBe(true);
  expect(after.closing, 'the sheet is still flagged as leaving while it is on screen').toBeNull();
  expect(after.slug).not.toBe(first);
  expect(after.chars).toBeGreaterThan(40);
  expect(after.locked, 'the scroll-lock was released out from under an open sheet').toBe(true);
});

test('a second Escape during the slide still tears everything down', async ({ page }) => {
  // ⚠ CHROMIUM CLOSES THE DIALOG PAST OUR HANDLER HERE, and that is by design:
  // its close watcher fires `cancel` only while the press still carries user
  // activation, so a second Escape shuts the dialog directly. Cutting the
  // animation short is a fine answer to pressing Escape twice — what must not
  // happen is a scroll-lock left behind on a page with no sheet on it. The
  // teardown hangs off the dialog's own `close` event for exactly this reason.
  await page.goto('/blog');
  await openReader(page);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(40);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => ({
    open: (document.getElementById('site-reader') as HTMLDialogElement).open,
    closing: (document.getElementById('site-reader') as HTMLElement).dataset.closing ?? null,
    locked: document.documentElement.classList.contains('scroll-locked'),
    // The scrollbar compensation is a CUSTOM PROPERTY, not an inline
    // `padding-right` — `html.scroll-locked` is what turns it into padding. The
    // old assertion read `style.paddingRight`, which this code never sets, so it
    // passed whether or not the lock cleaned up after itself.
    padded: document.documentElement.style.getPropertyValue('--scrollbar-w'),
    hash: location.hash,
  }));

  expect(after.open).toBe(false);
  expect(after.closing).toBeNull();
  expect(after.locked, 'the page was left unscrollable with no sheet open').toBe(false);
  expect(after.padded, 'the scrollbar compensation outlived the lock that needed it').toBe('');
  expect(after.hash).toBe('');
});
