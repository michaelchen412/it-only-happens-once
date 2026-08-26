// The citation reveal — "where did this come from?" (plan 17a; chosen from
// the reveal-lab bench, 2026-08-05).
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
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// ⚠ `.rv__*`, not `.qr__*`. QuoteReveal's mechanism moved into Reveal.astro on
// 2026-08-10 (plan 32 · §4) so the quote page's strip could use the same control
// with markup behind it instead of one string. QuoteReveal is now a thin wrapper
// that supplies a citation and the rule that an empty one renders nothing.
//
// ⚠ THIS SPEC WENT RED ON A PURE RENAME AND `npm run verify` DID NOT NOTICE,
// because verify runs vitest and not playwright. That is the gap this comment
// exists to mark: a refactor that touches a class name has to grep `tests/`.
const TRIGGER = '.rv__trigger';
const POP = '.rv__pop';
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
    await expect(t).toHaveAttribute('aria-expanded', 'false');

    // ⚠ THE LABEL IS NO LONGER THE LITERAL "Where this came from: …", and the
    // change is the behaviour rather than the test. This control used to open
    // onto exactly one thing — a citation — so naming the citation named the
    // control. Since plan 32 · §5 it can also carry "N more lines from …", and
    // on a quote with no citation at all that door is the ONLY thing behind it.
    // A name promising provenance would then describe a control that offers a
    // filter.
    //
    // So this asserts the property that has to hold on every surface: the
    // trigger has a name of its own, and it is NOT merely its visible text —
    // which is the whole reason a label is set here, the words being an
    // attribution that says nothing about being pressable.
    const label = (await t.getAttribute('aria-label')) ?? '';
    expect(label.length, 'the trigger has no accessible name').toBeGreaterThan(0);
    expect(label).not.toBe(((await t.textContent()) ?? '').trim());
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
// usual tooltip habit, and the reveal-lab bench showed why it is wrong here: the
// attribution sits directly beneath the quote, so above covers the words being
// read. This is the assertion that keeps it that way.
//
// ⚠ THE TRIGGER IS CENTRED, NOT `scrollIntoViewIfNeeded`, AND THAT IS THE WHOLE
// FIX (2026-08-26). `scrollIntoViewIfNeeded` scrolls the MINIMUM, so at 390×844
// it left the first attribution's bottom at 844.375 — a third of a pixel PAST
// the floor. `place()` then correctly took its documented escape hatch (`below`
// is false when `roomBelow < roomAbove` near the viewport floor, because below
// would render off-screen entirely) and this spec read the escape hatch as a
// regression in the default. It was red for weeks on a product that was right.
//
// Centring asks the question the test name asks: given room, does it open down?
// The floor case is a separate assertion below, so weakening one does not
// silently delete the other.
//
// ⚠ `behavior: 'instant'` IS LOAD-BEARING, and leaving it out cost a second
// diagnosis. `app.css:172` sets `scroll-behavior: smooth` site-wide, so a bare
// `scrollIntoView` returns having scrolled NOTHING — measured here at 390px:
// `scrollY` was still 0 on the next line and only reached 429 about half a
// second later. The click therefore landed on a trigger still sitting at the
// floor, and the spec went on failing in exactly the way it had before, which
// is the worst possible outcome for a fix. Playwright's own
// `scrollIntoViewIfNeeded` waits for stability; the raw DOM call does not.
test('opens BELOW the line, so it never covers the quote', async ({ page }) => {
  const t = page.locator(TRIGGER).first();
  await t.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await t.click();
  const trig = await t.boundingBox();
  const pop = await page.locator(`${POP}:popover-open`).boundingBox();
  expect(trig && pop).toBeTruthy();
  expect(pop!.y, 'the citation opens into the gap below, not over the words').toBeGreaterThanOrEqual(
    trig!.y + trig!.height,
  );
});

// ⚠ THE ONE CASE THAT MAY GO ABOVE, PINNED SO IT STAYS A DELIBERATE EXCEPTION.
// `reveal.ts` says it in writing: *"Above survives only for a trigger genuinely
// at the viewport floor, where below would show nothing at all."* Between a
// cramped box and a covered line the line wins — but between a covered line and
// a box the reader cannot see at all, the box wins, because an invisible
// popover is a control that did nothing.
//
// So what is actually guaranteed everywhere is the weaker, truer thing: the box
// is ON SCREEN and adjacent to its trigger. Assert that, and the flip is
// recorded as a decision rather than rediscovered as a bug.
test('at the very floor it may flip above — but it stays on screen and stays attached', async ({ page }) => {
  const t = page.locator(TRIGGER).first();
  await t.scrollIntoViewIfNeeded(); // the minimum scroll — lands it at the floor
  await t.click();
  const trig = (await t.boundingBox())!;
  const pop = (await page.locator(`${POP}:popover-open`).boundingBox())!;
  const vh = page.viewportSize()!.height;

  expect(pop.y, 'the citation opened off the top of the screen').toBeGreaterThanOrEqual(0);
  expect(pop.y + pop.height, 'the citation opened off the bottom of the screen').toBeLessThanOrEqual(vh + 1);
  // Adjacency in whichever direction it took, with the 8px GAP plus slack.
  const gap = Math.min(Math.abs(pop.y - (trig.y + trig.height)), Math.abs(trig.y - (pop.y + pop.height)));
  expect(gap, 'the citation detached from the words it belongs to').toBeLessThan(24);
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
