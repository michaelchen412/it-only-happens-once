// The citation reveal — "where did this come from?" (plan 17a; chosen from
// /reveal-lab, 2026-08-05).
//
// Signed out ON PURPOSE. This is the one piece of plan 17 a reader ever touches,
// and `anon` runs with no storageState, so these assertions are made by a
// genuinely strange browser rather than by Michael's own session. It also proves
// the RLS side incidentally: `authors` and `works` reach the public site for the
// first time here, and if a policy ever closed them the reveal would empty and
// these specs would say so.
//
// ⚠ Read-only by construction. Nothing here writes, and the reveal is a GET
// surface, so there is no action to stub — unlike the admin specs.
import { test, expect, type Page } from '@playwright/test';

const TRIGGER = '.qr__trigger';
const POP = '.qr__pop';
const openCount = (page: Page) => page.locator(`${POP}:popover-open`).count();

test.beforeEach(async ({ page }) => {
  await page.goto('/blog?view=quotes');
  await expect(page.locator('figure blockquote').first()).toBeVisible();
});

test.describe('the attribution is the control', () => {
  // Candidate B won because it adds NOTHING to the line — no glyph, no icon, no
  // numeral. If a future change reintroduces one, the trigger's text stops
  // equalling the attribution and this is where that shows up.
  test('adds nothing to the line it sits on', async ({ page }) => {
    const t = page.locator(TRIGGER).first();
    await expect(t).toBeVisible();
    const shown = ((await t.textContent()) ?? '').trim();
    expect(shown, 'the control is the name itself, with nothing appended').toMatch(/^[^＋+⌄▾°]+$/);
    // The em-dash is punctuation and belongs OUTSIDE the control — underlining
    // it on hover reads as a typo.
    expect(shown.startsWith('—'), 'the em-dash must not be inside the button').toBe(false);
  });

  test('is a real button, labelled with what it opens', async ({ page }) => {
    const t = page.locator(TRIGGER).first();
    await expect(t).toHaveJSProperty('tagName', 'BUTTON');
    const reveal = ((await page.locator(POP).first().textContent()) ?? '').trim();
    await expect(t).toHaveAttribute('aria-label', `Where this came from: ${reveal}`);
    await expect(t).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('opening and closing', () => {
  // ⚠ THE BUG MICHAEL FOUND IN THE LAB, pinned so it cannot come back. An `auto`
  // popover light-dismisses on any outside pointerdown — so a hand-rolled
  // `showPopover()` on click CLOSED it and then immediately REOPENED it, and the
  // control could be opened but never shut from the same spot. The fix is to
  // hand the pairing to the browser via `popoverTargetElement`; the spec is the
  // same gesture a person makes.
  test('the same click that opens it closes it', async ({ page }) => {
    const t = page.locator(TRIGGER).first();
    await t.click();
    expect(await openCount(page), 'first click opens').toBe(1);
    await t.click();
    expect(await openCount(page), 'clicking the SAME spot closes').toBe(0);
    await t.click();
    expect(await openCount(page), 'and opens again').toBe(1);
  });

  test('a click anywhere else dismisses it', async ({ page }) => {
    await page.locator(TRIGGER).first().click();
    expect(await openCount(page)).toBe(1);
    await page.locator('figure blockquote').first().click();
    expect(await openCount(page)).toBe(0);
  });

  // Hover is never the only way in: this control is INVISIBLE until interacted
  // with, which makes the keyboard the only path some readers will ever have.
  // Plan 19 found four a11y failures that all began as hover-only affordances.
  test('opens on Enter and closes on Escape, with aria-expanded tracking', async ({ page }) => {
    const t = page.locator(TRIGGER).first();
    await t.focus();
    await page.keyboard.press('Enter');
    expect(await openCount(page)).toBe(1);
    await expect(t).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    expect(await openCount(page)).toBe(0);
    await expect(t).toHaveAttribute('aria-expanded', 'false');
  });
});

// ⚠ A correction, not a default. Preferring "above when there's room" is the
// usual tooltip habit, and /reveal-lab showed why it is wrong here: the
// attribution sits directly beneath the quote, so above covers the words being
// read. This is the assertion that keeps it that way.
test('opens BELOW the line, so it never covers the quote', async ({ page }) => {
  const t = page.locator(TRIGGER).first();
  await t.scrollIntoViewIfNeeded();
  await t.click();
  const trig = await t.boundingBox();
  const pop = await page.locator(`${POP}:popover-open`).boundingBox();
  expect(trig && pop).toBeTruthy();
  expect(pop!.y, 'the citation opens into the gap below, not over the words').toBeGreaterThanOrEqual(
    trig!.y + trig!.height,
  );
});

// A control that opens onto an empty box teaches you to stop pressing it. Most
// of the corpus is a person quoted plainly, with no work and no locator — those
// keep their attribution and get no control at all.
test('a quote with nothing behind it has no control', async ({ page }) => {
  const withControl = await page.locator(`figcaption ${TRIGGER}`).count();
  const withLine = await page.locator('figcaption').filter({ hasText: '—' }).count();
  expect(withLine, 'the page should have attributed quotes at all').toBeGreaterThan(0);
  expect(withControl, 'and not every one of them should be interactive').toBeLessThan(withLine);
});

// The same component, the other public surface. A constellation is typeset to
// be read straight through, which is exactly why B was the candidate that could
// go here: it adds no marks down the side of the suite.
test('works the same inside a constellation suite', async ({ page }) => {
  await page.goto('/to-be-like-the-rock-that-the-waves-keep-crashing-over');
  const t = page.locator(TRIGGER).first();
  await t.scrollIntoViewIfNeeded();
  await expect(t).toBeVisible();
  await t.click();
  expect(await openCount(page)).toBe(1);
  await t.click();
  expect(await openCount(page)).toBe(0);
});
