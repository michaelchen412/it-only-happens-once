// `<FilterField>` — the one filter pass (plan 42 · §4.B.2).
//
// ⚠ THIS SPEC EXISTS FOR THE HALF THAT `verify` CANNOT SEE. The component is a
// DOM pass, so a unit test would be testing jsdom (and this repo's vitest
// environment is `node` anyway); what is at risk is the behaviour on a real
// page across a real navigation — which is where the finding lives.
//
// ⚠ READ-ONLY BY CONSTRUCTION (ADR 0028). Filtering is entirely client-side and
// the reload below is a GET, so nothing here needs `/_actions/**`. It drives the
// real pages against the live corpus and writes nothing.
//
// ⚠ IT TAKES ITS QUERY OFF A ROW THE PAGE RENDERED rather than hard-coding a
// term. A fixed word would go red the day that author is renamed, and a spec
// that goes red for a reason nobody caused is a spec people learn to ignore.
//
// ⚠ AND IT TAKES `data-name`, NOT THE FIRST WORD OF `data-search`. The first
// draft did the latter and went red on the picker: `data-search` is the name
// PLUS the description, so its first word can be "the" — a query that matches
// all fourteen rows and narrows nothing. A whole name is the one string on the
// row that is meant to identify it.
import type { Page } from '@playwright/test';
import { test, expect, hideDevToolbar } from './fixtures';

/** The Library's field, and the rows it filters. */
const libraryField = (page: Page) => page.getByLabel('Find a subject, author or work');

test.describe('the filter field', () => {
  test('narrows to a row, hides the empty headings, and says why', async ({ page }) => {
    await page.goto('/admin/library');

    const rows = page.locator('.lib-row');
    const total = await rows.count();
    expect(total, 'the Library needs rows for this to mean anything').toBeGreaterThan(1);

    const field = libraryField(page);
    await expect(field).toBeVisible();

    const term = (await rows.first().getAttribute('data-name'))!;
    await field.fill(term);

    const visible = page.locator('.lib-row:not([hidden])');
    await expect(visible.first()).toBeVisible();
    expect(await visible.count(), 'a filter that hides nothing is not filtering').toBeLessThan(total);

    // The no-match line is about a QUERY, and only about a query.
    const none = page.locator('.ff__none');
    await expect(none).toBeHidden();

    await field.fill('zzzzz-nothing-is-called-this');
    await expect(none).toBeVisible();
    await expect(page.locator('.lib-row:not([hidden])')).toHaveCount(0);

    // ⚠ AND NO HEADING IS LEFT STANDING OVER AN EMPTY TABLE — the roster's rule
    // in its own words: "a heading over an empty grid reads as a rendering bug."
    // Three `<h2>`s and a scrollbar over nothing is what this replaces.
    await expect(page.locator('[data-vocab]:not([hidden])')).toHaveCount(0);

    await field.fill('');
    await expect(none).toBeHidden();
    await expect(page.locator('.lib-row:not([hidden])')).toHaveCount(total);
    await expect(page.locator('[data-vocab]:not([hidden])')).toHaveCount(3);
  });

  // ⚠⚠ WHAT THIS TEST MEASURED, AND IT CONTRADICTS THE PREMISE THE FIX WAS
  // WRITTEN FROM. Plan 42 · §4.B.2 says — from an outside review — that browsers
  // restore form state across a reload, so a filter box would come back FILLED
  // over an UNFILTERED list. Chromium under Playwright does **not** restore it:
  // measured 2026-08-18, the field comes back empty.
  //
  // So the fix (`if (input.value) apply()` in `filter-field.ts`) is a no-op in
  // this browser, and the defect the review described is narrower than claimed.
  // It is kept because the failure it prevents is silent and the guard is one
  // line — but the honest assertion is the INVARIANT, not the restoration:
  // whatever the browser chooses to do with the value, the value and the rows
  // must agree. Filled-box-over-unfiltered-list is the one outcome forbidden.
  //
  // ⚠ Stated plainly so nobody over-reads this: it therefore does NOT catch
  // deletion of the re-apply line in a browser that does not restore. Proving
  // that half needs a browser that does, and the invariant is what holds in all
  // of them.
  test('never leaves a query in the box that the rows disagree with', async ({ page }) => {
    await page.goto('/admin/library');

    const total = await page.locator('.lib-row').count();
    const term = (await page.locator('.lib-row').first().getAttribute('data-name'))!;

    const field = libraryField(page);
    await field.fill(term);
    const narrowed = await page.locator('.lib-row:not([hidden])').count();
    expect(narrowed).toBeLessThan(total);

    // The navigation every per-row Save on this page ends in (`reloadUnless`),
    // here as a bare GET so the spec stays read-only.
    await page.reload();

    const restored = await field.inputValue();
    const showing = await page.locator('.lib-row:not([hidden])').count();
    expect(
      restored ? showing : total,
      restored
        ? 'the query came back, so the rows must be filtered to match it'
        : 'the query did not come back, so every row must be showing',
    ).toBe(restored ? narrowed : total);
  });

  test('a picker inside a sheet gets the same box and the same sentence', async ({ page }) => {
    await page.goto('/admin/fragments');
    await hideDevToolbar(page);
    await page.locator('#add-btn').click();
    await page.locator('[data-new="quote"]').click();
    await expect(page.locator('#sheet')).toBeVisible();
    await page.locator('#sheet [data-tab="constellations"]').click();

    const picker = page.locator('#sheet-panel-cn .cn-picker');
    await expect(picker).toBeVisible();

    const field = picker.getByLabel('Filter constellations');
    // Below the threshold the field is deliberately hidden — that is the rule,
    // not a failure, so the spec says which case it is rather than going red.
    if (!(await field.isVisible())) {
      test.skip(true, 'the sky is below FILTER_THRESHOLD, so the field is correctly hidden');
    }

    const rows = picker.locator('.cn-row');
    const total = await rows.count();
    const term = (await rows.first().getAttribute('data-name'))!;

    await field.fill(term);
    // The row the query came from survives it, and at least one other does not.
    await expect(picker.locator(`.cn-row[data-name="${term}"]`)).toBeVisible();
    expect(await picker.locator('.cn-row:not([hidden])').count()).toBeLessThan(total);

    // ⚠ THE SENTENCE THIS PICKER ALREADY HAD, now on all four. Its three
    // siblings — SharedByField, EventSheet, TagSheet — filtered to an empty box
    // and said nothing at all until this component.
    await field.fill('zzzzz-no-constellation-is-called-this');
    await expect(picker.locator('.ff__none')).toBeVisible();
    await expect(picker.locator('.cn-row:not([hidden])')).toHaveCount(0);
  });
});
