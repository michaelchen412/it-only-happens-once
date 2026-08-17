// Choosing a set's epigraph from the FragmentBrowser's third mode
// (plan 42 · §4.D.4).
//
// ⚠ THIS IS THE HALF GREEN CHECKS CANNOT COVER, and it is the same class
// `song-pairing.spec.ts` names: stacked dialogs, a fetched partial, and an admin
// session. The unit tests pin what the query ASKS for; nothing below the type
// checker knows whether the drawer opens, whether it offers rows `sets.save`
// would refuse, or whether a pick reaches the field that gets saved.
//
// REAL READS, NO WRITES. `/admin/fragments-panel?mode=epigraph` is a GET, so the
// published-quotes-only narrowing is verified against the ACTUAL corpus rather
// than against a fixture that would agree with whatever the query happened to
// do. Nothing here presses Save — the epigraph is held on the form until then,
// which is itself one of the things being checked — so no action stubs are
// needed and `fixtures.ts` blocks `/_actions/**` anyway.
import { expect, test, hideDevToolbar } from './fixtures';

/** Open /admin/sets and get the New-set sheet up. */
async function openSheet(page: import('@playwright/test').Page) {
  await page.goto('/admin/sets');
  await hideDevToolbar(page);
  await page.locator('[data-open-set-sheet]').first().click();
  const sheet = page.locator('#set-sheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe('the epigraph picker', () => {
  test('opens on top of the sheet and offers PUBLISHED QUOTES only', async ({ page }) => {
    const sheet = await openSheet(page);
    await sheet.locator('[data-quote-pick]').click();

    const drawer = page.locator('#epigraph-browser');
    await expect(drawer).toBeVisible();
    // The sheet stays open underneath — the pick is held on its form, so losing
    // the sheet would lose the half-made set the quote is being chosen for.
    await expect(sheet).toBeVisible();
    await expect(drawer).toContainText('Quote for');

    const rows = drawer.locator('tr.fragment-row');
    await expect(rows.first()).toBeVisible();

    // Against the real corpus, both pins: `quotable` narrows type AND status,
    // because a set's epigraph is the first thing a reader meets on the music
    // page and a draft quote's words are not public.
    const types = await rows.evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.type))]);
    expect(types).toEqual(['quote']);
    const statuses = await rows.evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.status))]);
    expect(statuses).toEqual(['published']);
  });

  test('has no cart, no Add ▾ and no create bar — one scalar column is not a multi-select', async ({ page }) => {
    const sheet = await openSheet(page);
    await sheet.locator('[data-quote-pick]').click();
    const drawer = page.locator('#epigraph-browser');
    await expect(drawer.locator('tr.fragment-row').first()).toBeVisible();

    await expect(drawer.locator('.row-check')).toHaveCount(0);
    await expect(drawer.locator('.select-all')).toHaveCount(0);
    await expect(drawer.locator('.fb-bulkbar')).toHaveCount(0);
    await expect(drawer.locator('.fb-add-btn')).toHaveCount(0);
    // ⚠ AND NOT THE PAIR MODE'S CREATE BAR EITHER. That one starts a DRAFT ESSAY
    // and pairs a song to it, which is a sentence this picker cannot finish — it
    // was `!pick` until a third mode made that wrong rather than merely loose.
    await expect(drawer.locator('.fb-createbar')).toHaveCount(0);
  });

  test('the type segments are gone — every one of them would report the same number', async ({ page }) => {
    const sheet = await openSheet(page);
    await sheet.locator('[data-quote-pick]').click();
    const drawer = page.locator('#epigraph-browser');
    await expect(drawer.locator('tr.fragment-row').first()).toBeVisible();
    await expect(drawer.getByRole('radiogroup', { name: 'Filter by type' })).toHaveCount(0);
  });

  test('author and work SURVIVE here, where the pair picker withholds them', async ({ page }) => {
    // ⚠ THE ONE PLACE THE TWO SINGLE-SELECT PICKERS GENUINELY DIFFER, and the
    // reason is the corpus rather than the picker: those two selects are dead in
    // a writing-only list because a piece of Michael's own writing has neither
    // facet. A quotes-only list is exactly what they describe — "the Marcus
    // Aurelius one", "the one from Meditations" is how you find a half-remembered
    // line. Pinned so a later tidy-up cannot fold them into one rule.
    const sheet = await openSheet(page);
    await sheet.locator('[data-quote-pick]').click();
    const drawer = page.locator('#epigraph-browser');
    await expect(drawer.locator('tr.fragment-row').first()).toBeVisible();
    await expect(drawer.getByLabel('Filter by author')).toBeVisible();
    await expect(drawer.getByLabel('Filter by work')).toBeVisible();
  });

  test('a pick lands in the field that gets saved, and the sheet shows the words', async ({ page }) => {
    const sheet = await openSheet(page);
    await expect(sheet.locator('[data-quote-none]')).toBeVisible();
    await sheet.locator('[data-quote-pick]').click();

    const drawer = page.locator('#epigraph-browser');
    const first = drawer.locator('tr.fragment-row').first();
    await expect(first).toBeVisible();
    const chosen = await first.evaluate((el) => {
      const q = JSON.parse((el as HTMLElement).dataset.fragment ?? '{}') as { id: string; body: string };
      return { id: q.id, body: (q.body ?? '').replace(/\s+/g, ' ').trim() };
    });

    await first.getByRole('button', { name: 'Use' }).click();

    // The drawer goes — the decision is made, and there is only one to make.
    await expect(drawer).toBeHidden();
    // ⚠ THE HIDDEN INPUT IS THE POINT. It is what `new FormData(form)` sends as
    // `quote_fragment_id`; the blockquote beside it is only the summary. A spec
    // asserting the visible text alone would pass on a picker that showed the
    // right quote and saved nothing.
    await expect(sheet.locator('[data-quote-id]')).toHaveValue(chosen.id);
    await expect(sheet.locator('[data-quote-text]')).toBeVisible();
    await expect(sheet.locator('[data-quote-text]')).toHaveText(chosen.body);
    await expect(sheet.locator('[data-quote-none]')).toBeHidden();

    // Clear puts it back to nothing, in one press, without touching the server.
    await sheet.locator('[data-quote-clear]').click();
    await expect(sheet.locator('[data-quote-id]')).toHaveValue('');
    await expect(sheet.locator('[data-quote-none]')).toBeVisible();
  });
});
