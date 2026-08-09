// Plan 16 · Piece 2 — the entity combo's cap, and what it says about itself.
//
// The reported symptom: "the combo box sometimes seems limited, meaning it
// might just stop at a certain number of results". It did — at 50, silently,
// against 70 authors, so a third of them were unreachable by scrolling and
// nothing on screen said so. A cap is defensible; a cap that doesn't admit it
// teaches you the list is complete when it isn't.
//
// The options are driven through `setOptions()`, which is the component's own
// public API and is already how the Work combo gets re-scoped when the Author
// changes. That keeps these specs off the live vocabulary — and it is the only
// way to exercise a list longer than the corpus currently is.
import type { Page } from '@playwright/test';
import { test, expect, blockWrites } from './fixtures';

const COMBO = '#quote-author';

async function openQuoteSheet(page: Page) {
  await blockWrites(page); // nothing here saves; refuse it at the door anyway
  await page.goto('/admin/fragments');
  await page.locator('#add-btn').click(); // the quote sheet lives behind Add ▾
  await page.locator('#add-menu [data-new="quote"]').click();
  await expect(page.locator(COMBO)).toBeVisible();
}

/** Replace the combo's vocabulary and open its menu. */
async function load(page: Page, names: string[]) {
  await page.evaluate(
    ([sel, list]) => {
      const el = document.querySelector(sel as string) as HTMLElement & { setOptions(o: unknown[]): void };
      el.setOptions((list as string[]).map((name, i) => ({ id: `id-${i}`, name })));
    },
    [COMBO, names] as const,
  );
  await page.locator(`${COMBO} input[role="combobox"]`).click();
}

const rows = (page: Page) => page.locator(`${COMBO} .entity-combo__opt:not(.entity-combo__opt--create)`);
const more = (page: Page) => page.locator(`${COMBO} .entity-combo__more`);

test.describe('a cap that admits itself', () => {
  test('70 authors all render — the reported symptom, gone', async ({ page }) => {
    await openQuoteSheet(page);
    await load(
      page,
      Array.from({ length: 70 }, (_, i) => `Author ${String(i).padStart(2, '0')}`),
    );
    // The number that mattered: 50 rows and silence about the other 20.
    await expect(rows(page)).toHaveCount(70);
    await expect(more(page)).toHaveCount(0);
    await expect(page.locator(`${COMBO} .entity-combo__opt`).last()).toContainText('Author 69');
  });

  test('past the cap it says how many more there are, rather than just ending', async ({ page }) => {
    await openQuoteSheet(page);
    await load(
      page,
      Array.from({ length: 250 }, (_, i) => `Author ${String(i).padStart(3, '0')}`),
    );
    await expect(rows(page)).toHaveCount(200);
    await expect(more(page)).toHaveText('50 more — keep typing to narrow this down');
  });

  test('the notice is not selectable — Enter can never land on it', async ({ page }) => {
    await openQuoteSheet(page);
    await load(
      page,
      Array.from({ length: 250 }, (_, i) => `Author ${String(i).padStart(3, '0')}`),
    );
    await expect(more(page)).toHaveAttribute('aria-disabled', 'true');
    // The active descendant is always a real row, never the notice.
    const active = await page.locator(`${COMBO} input[role="combobox"]`).getAttribute('aria-activedescendant');
    expect(await page.locator(`#${active}`).getAttribute('class')).toContain('entity-combo__opt');
  });
});

test.describe('finding the name you actually typed', () => {
  test('names that START with the query come before names that merely contain it', async ({ page }) => {
    await openQuoteSheet(page);
    await load(page, ['Amartya Sen', 'Cormac McCarthy', 'Marcus Aurelius', 'Marilynne Robinson']);
    await page.locator(`${COMBO} input[role="combobox"]`).fill('mar');
    // "Amartya" contains "mar" and used to be able to outrank both real prefix
    // matches, which mattered because the top row is what Enter takes.
    await expect(rows(page).nth(0)).toHaveText('Marcus Aurelius');
    await expect(rows(page).nth(1)).toHaveText('Marilynne Robinson');
    await expect(rows(page).nth(2)).toHaveText('Amartya Sen');
    // Cormac McCarthy is in the list and matches nothing — so this is also the
    // assertion that the filter is still filtering.
    await expect(rows(page)).toHaveCount(3);
  });

  test('accents fold, so "marquez" finds "Márquez"', async ({ page }) => {
    await openQuoteSheet(page);
    await load(page, ['Gabriel García Márquez', 'Marcus Aurelius']);
    await page.locator(`${COMBO} input[role="combobox"]`).fill('marquez');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveText('Gabriel García Márquez');
  });

  // ⚠ The one spec in this file that is green against the OLD source too, and
  // deliberately so: it guards a change that was considered and NOT made.
  // Folding could have been applied to identity as well as to search, which
  // would have made "Marquez" un-creatable next to "Márquez". It wasn't, and
  // this is what notices if a later session decides to tidy that up.
  test('folding is for finding, not for identity — the create row still offers the exact text', async ({ page }) => {
    await openQuoteSheet(page);
    await load(page, ['Gabriel García Márquez']);
    await page.locator(`${COMBO} input[role="combobox"]`).fill('marquez');
    // The real one is findable AND creating the unaccented spelling is still
    // possible: this component's contract is that you either pick something
    // that exists or explicitly choose to add one.
    await expect(page.locator(`${COMBO} .entity-combo__opt--create`)).toBeVisible();
  });
});

test('“＋ Add” stays on screen on a long list instead of sitting below the fold', async ({ page }) => {
  await openQuoteSheet(page);
  await load(
    page,
    Array.from({ length: 120 }, (_, i) => `Marion ${String(i).padStart(3, '0')}`),
  );
  await page.locator(`${COMBO} input[role="combobox"]`).fill('Marion');
  const create = page.locator(`${COMBO} .entity-combo__opt--create`);
  await expect(create).toBeVisible();

  // Not merely "in the DOM": inside the menu's own scroll box, without anyone
  // scrolling it. It used to be appended after up to 50 rows, which on a long
  // list put the only way to create something out of sight.
  const inView = await create.evaluate((el) => {
    const menu = el.parentElement as HTMLElement;
    const m = menu.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    return c.bottom <= m.bottom + 1 && c.top >= m.top - 1;
  });
  expect(inView).toBe(true);
});
