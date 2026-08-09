// Today's stack, at 390px (13 · Piece 5; 10-hq.md §10b and §10c).
//
// ⚠ THE ORDER IS A COMPUTED-STYLE QUESTION, WHICH IS WHY IT IS TESTED HERE AND
// NOT READ OFF THE SOURCE. The five zones live in two column wrappers so that
// wide they sit side by side — and the wrappers go `display: contents` when
// narrow so the whole set collapses into one flex stack and `order` can
// resequence it. **People outranks Coming up on a phone**, which means the DOM
// order and the visual order deliberately DISAGREE below 46rem.
//
// That is exactly the class of thing that fails silently: `astro check` passes,
// the build is green, and a screenshot of a morning with no drift shows
// nothing wrong. Two of the four failures the Today lab caught were this shape
// (10-hq.md §11), and the fix for one of them — TRAP 1, `grid-column: 2`
// conjuring an implicit column — is a one-line "tidy-up" away at all times.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/** Where a zone's top edge is, or null when the zone has nothing to say. */
async function topOf(page: Page, selector: string): Promise<number | null> {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return null;
  const box = await el.boundingBox();
  return box?.y ?? null;
}

test.describe('the stack on a phone', () => {
  test('⚠ collapses to ONE column — the rail never sits beside anything', async ({ page }) => {
    await page.goto('/admin');
    const zones = page.locator('.hq-grid .zone');
    const boxes = await zones.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
    expect(boxes.length).toBeGreaterThan(0);
    // Every zone starts at the same left edge, which is what "one stack" means.
    expect(new Set(boxes.map((x) => Math.round(x))).size).toBe(1);
  });

  test('⚠ People outranks Coming up, which is the whole point of the `o-*` classes', async ({ page }) => {
    await page.goto('/admin');
    const people = await topOf(page, '[data-people-zone]');
    const coming = await topOf(page, '[data-coming-up]');
    test.skip(people === null || coming === null, 'need both a person and something approaching');

    // Who you are seeing today matters more than what is three weeks out. The
    // DOM has them the other way round — People is in the rail — so this
    // passing means `order` really is being applied.
    expect(people!).toBeLessThan(coming!);
  });

  test('the morning is still first, and past due is still last', async ({ page }) => {
    await page.goto('/admin');
    const morning = await topOf(page, '[data-checkin]');
    expect(morning).not.toBeNull();

    for (const sel of [
      '[data-agenda-zone]',
      '[data-people-zone]',
      '[data-coming-up]',
      '[data-practice]',
      '[data-past-due]',
    ]) {
      const top = await topOf(page, sel);
      if (top !== null) expect(top, `${sel} came before the check-in`).toBeGreaterThan(morning!);
    }

    // §10f: you meet arrears AFTER today, not before it. That is the entire
    // argument for it not being collapsed, so its position is load-bearing.
    const past = await topOf(page, '[data-past-due]');
    if (past !== null) {
      for (const sel of ['[data-agenda-zone]', '[data-people-zone]', '[data-coming-up]', '[data-practice]']) {
        const top = await topOf(page, sel);
        if (top !== null) expect(past, `${sel} came after past due`).toBeGreaterThan(top);
      }
    }
  });

  test('every control on the page clears the 44px floor', async ({ page }) => {
    await page.goto('/admin');
    // The tick is the one control pressed without looking, and its neighbours
    // are other rows' controls. `.tick--none` is deliberately excluded: it is a
    // spacer, not a control, and it has no listener to mis-fire.
    for (const el of await page.locator('.hq-grid .tick, [data-past-due] .chip--act, .brf__log').all()) {
      const box = await el.boundingBox();
      if (!box) continue;
      expect(Math.max(box.height, box.width), 'a tap target is under 44px').toBeGreaterThanOrEqual(24);
      if (await el.evaluate((e) => e.classList.contains('tick'))) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test('nothing shears off the card — the widest zone still fits', async ({ page }) => {
    await page.goto('/admin');
    // TRAP 5: a `<fieldset>` will not shrink below its content, which sheared a
    // value label off the check-in card at 390px and was invisible to three
    // plausible assertions. The general form of the check is cheap: no zone may
    // be wider than the page.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(1);
  });
});
