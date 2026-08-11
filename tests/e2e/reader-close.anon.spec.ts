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
}

/**
 * Close the reader the given way and report what happened to the sheet.
 *
 * The listeners go on BEFORE the close and the promise resolves from events, so
 * this measures the exit rather than sampling it.
 */
async function closeReader(page: Page, how: 'button' | 'escape' | 'backdrop'): Promise<Exit> {
  await page.evaluate(() => {
    const d = document.getElementById('site-reader')!;
    const w = window as unknown as { __exit: { swapped: boolean; slid: boolean; node: Element } };
    w.__exit = { swapped: false, slid: false, node: d };
    document.addEventListener('astro:before-swap', () => (w.__exit.swapped = true), { once: true });
    // `transitionend` fires once per property and bubbles; take the drawer's own
    // `translate` and ignore a hover transition on some button inside it.
    d.addEventListener('transitionend', (e) => {
      if (e.target === d && e.propertyName === 'translate' && document.contains(d)) w.__exit.slid = true;
    });
  });

  if (how === 'escape') await page.keyboard.press('Escape');
  else if (how === 'backdrop')
    await page.mouse.click(20, 400); // the dimmed feed, left of the sheet
  else await page.locator('[data-reader-close]').click();

  await expect(page.locator(READER)).toHaveJSProperty('open', false);
  // Long enough for the 0.28s slide plus the deferred scroll-unlock at 320ms.
  await page.waitForTimeout(700);

  return page.evaluate(() => {
    const d = document.getElementById('site-reader') as HTMLDialogElement;
    const w = window as unknown as { __exit: { swapped: boolean; slid: boolean; node: Element } };
    return {
      swapped: w.__exit.swapped,
      slid: w.__exit.slid,
      sameNode: w.__exit.node === d && document.contains(d),
      open: d.open,
      hash: location.hash,
      htmlClass: document.documentElement.className,
    };
  });
}

for (const how of ['button', 'escape', 'backdrop'] as const) {
  test(`the reader slides out when closed by ${how}, without swapping the page`, async ({ page }) => {
    await page.goto('/blog');
    await openReader(page);

    const exit = await closeReader(page, how);

    expect(exit.swapped, 'the document was swapped mid-close — the reader opened its hash outside the router').toBe(
      false,
    );
    expect(exit.slid, 'the slide-out never finished on the live node — the sheet vanished instead of leaving').toBe(
      true,
    );
    expect(exit.sameNode).toBe(true);
    expect(exit.open).toBe(false);
    expect(exit.hash).toBe('');
    // The lock is held THROUGH the slide and dropped after: released early and
    // the feed reflows sideways behind a still-moving drawer.
    expect(exit.htmlClass).not.toContain('reader-open');
  });
}

test('the quotes view closes the same way', async ({ page }) => {
  await page.goto('/blog?view=quotes');
  await openReader(page);

  const exit = await closeReader(page, 'button');

  expect(exit.swapped).toBe(false);
  expect(exit.slid).toBe(true);
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
