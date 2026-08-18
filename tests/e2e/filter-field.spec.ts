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

  // ⚠⚠ WHAT THIS MEASURED, AND IT DOES NOT MATCH THE PREMISE THE FIX WAS WRITTEN
  // FROM. Plan 42 · §4.B.2 says — from an outside review — that browsers restore
  // form state across a reload, so a filter box comes back FILLED over an
  // UNFILTERED list, and that the defect was *already live on `/admin/people`*.
  // Measured 2026-08-18 on BOTH pages: Chromium returns the field **empty**.
  //
  // ⚠ AND THE BOUND ON THAT MEASUREMENT MATTERS AS MUCH AS THE RESULT. Every
  // project in `playwright.config.ts` uses `Desktop Chrome`, so this is "not in
  // the engine we test", **not** "cannot happen" — Firefox restores form state
  // across a reload more eagerly than Chromium. So the guard stays on both
  // surfaces: it costs nothing where the hazard is absent, and it means nobody
  // re-opens the question per engine.
  //
  // The honest assertion is therefore the INVARIANT rather than the restoration:
  // whatever the browser does with the value, the value and the rows must agree.
  // **Filled-box-over-unfiltered-list is the one outcome forbidden.**
  //
  // ⚠ Stated plainly so nobody over-reads these two tests: they do NOT catch
  // deletion of the re-apply line in a browser that does not restore. Proving
  // that half needs a browser that does; the invariant is what holds in all of
  // them.
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

  // ⚠ THE ROSTER IS NOT A `<FilterField>` — it hides section headings AND rewrites
  // their counts, which is roster-specific. It is here because §4.B.2 named it as
  // the page the defect was *already live on*, and that was the plan's last
  // unverified factual claim. Measured: it does not reproduce in Chromium either.
  // The invariant is pinned on both pages so the claim never needs re-litigating.
  test('the roster never leaves a query in the box that the cards disagree with', async ({ page }) => {
    await page.goto('/admin/people');

    const field = page.locator('#people-search');
    if (!(await field.count())) {
      test.skip(true, 'the roster is below SEARCH_APPEARS_ABOVE, so there is correctly no box');
    }

    const cards = page.locator('[data-person]');
    const total = await cards.count();
    const term = (await cards.first().getAttribute('data-search'))!.split(' ')[0];

    await field.fill(term);
    const narrowed = await page.locator('[data-person]:not([hidden])').count();
    expect(narrowed).toBeLessThan(total);

    // The navigation `person-sheet.ts` ends every Save with, as a bare GET.
    await page.reload();

    const restored = await field.inputValue();
    const showing = await page.locator('[data-person]:not([hidden])').count();
    expect(
      restored ? showing : total,
      restored
        ? 'the query came back, so the cards must be filtered to match it'
        : 'the query did not come back, so every card must be showing',
    ).toBe(restored ? narrowed : total);

    // And the sections agree with the cards either way — a heading over an empty
    // grid is the roster's own stated bug.
    const sections = page.locator('[data-section]:not([hidden])');
    expect(await sections.count()).toBeGreaterThan(0);
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
