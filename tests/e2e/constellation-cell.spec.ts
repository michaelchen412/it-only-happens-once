// The Constellations column as a CONTROL (docs/admin.md §2, "the column is also
// the door"). Filing a fragment used to cost a detour — open the row, find the
// tab, find your place in the list again. The chips you were already reading
// are the door now, and these specs pin the four claims that makes:
//
//   1. it opens the editor already on the Constellations tab,
//   2. the SAME door for every row type, writing included,
//   3. looking is not filing — the gesture writes nothing,
//   4. nothing reflows under the pointer.
//
// Read-only by construction, and more strictly than most specs here: the only
// action allowed through is `fragments.get` (the workshop cannot open a piece
// without it). Everything else is refused AND recorded, which is how claim 3 is
// tested rather than assumed.
import { expect, test, type Page } from '@playwright/test';
import { fixtures, hideDevToolbar, stubActions } from './fixtures';

/** Let reads through, refuse every write, and remember what was refused. */
async function readsOnly(page: Page): Promise<() => string[]> {
  const blocked: string[] = [];
  await page.route('**/_actions/**', async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname)
      .replace(/^.*\/_actions\//, '')
      .replace(/\/$/, '');
    if (name === 'fragments.get') return void (await route.continue());
    blocked.push(name);
    await route.abort('failed');
  });
  return () => blocked;
}

/**
 * ⚠ WAIT FOR THE JS, NOT FOR THE MARKUP. Rows are server-rendered, so a row is
 * visible well before anything listens for a click on it — and under `astro
 * dev` the module graph is unbundled, so on a cold compile that gap is long
 * enough to lose a click in. This spec caught it as a "the sheet never opened"
 * failure that passed on every re-run, which is the shape of a race worth
 * spelling out rather than sleeping through.
 *
 * Two signals, because a click here crosses two modules: the panel delegates it
 * (`data-wired`, set by wireFragmentPanel) and a sheet listens for what the
 * panel dispatches (the quote editor's ProseMirror node is that module's own
 * proof of life).
 */
async function openManager(page: Page) {
  await page.goto('/admin/fragments');
  await hideDevToolbar(page);
  await expect(page.locator('tr.fragment-row').first()).toBeVisible();
  await expect(page.locator('.fpanel[data-wired]')).toBeAttached();
  await expect(page.locator('#quote-editor .ProseMirror')).toBeAttached();
}

test.describe('the membership cell', () => {
  test('opens a quote or song already on its Constellations tab', async ({ page }) => {
    const blocked = await readsOnly(page);
    await openManager(page);

    const row = page.locator('tr.fragment-row[data-fragment]').first();
    test.skip((await row.count()) === 0, 'needs a quote or song row');
    await row.locator('.cn-cell').click();

    await expect(page.locator('#sheet')).toBeVisible();
    // The claim is the TAB, not the sheet — opening on the fields tab would be
    // the old two-step with extra confidence.
    await expect(page.locator('#sheet [data-tab="constellations"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#sheet-panel-cn')).toBeVisible();
    await expect(page.locator('#sheet-panel-cn .cn-picker')).toBeVisible();

    // Claim 3: reading the column must never file anything. A picker that
    // applied a tick on open would be indistinguishable from this, until it
    // wasn't.
    expect(blocked(), 'opening the membership tab tried to write').toEqual([]);
  });

  test('the same door on a writing row — the workshop, on the same tab', async ({ page }) => {
    // Deliberately NOT a lighter surface for writing: you should not have to
    // know a row's type to predict what a click does, and a badge that behaved
    // differently here would make the `none` chip beside it a dead label.
    await readsOnly(page);
    await openManager(page);

    const row = page.locator('tr.fragment-row[data-writing]').first();
    test.skip((await row.count()) === 0, 'needs a writing row');
    await row.locator('.cn-cell').click();

    await expect(page.locator('#wsheet')).toBeVisible();
    await expect(page.locator('#wsheet [data-tab="constellations"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#ws-panel-cn')).toBeVisible();
  });

  test('the plain row click still opens the content tab', async ({ page }) => {
    // The other half of the same claim: the cell is a DIFFERENT door, so the
    // door beside it must not have moved.
    await readsOnly(page);
    await openManager(page);

    const row = page.locator('tr.fragment-row[data-fragment]').first();
    test.skip((await row.count()) === 0, 'needs a quote or song row');
    await row.locator('.row-open').click();

    await expect(page.locator('#sheet')).toBeVisible();
    await expect(page.locator('#sheet [data-tab="fields"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('it is a real button, and the keyboard opens it', async ({ page }) => {
    await readsOnly(page);
    await openManager(page);
    const cell = page.locator('tr.fragment-row[data-fragment] .cn-cell').first();
    test.skip((await cell.count()) === 0, 'needs a quote or song row');

    // Not a clickable <td> with a handler: focusable, and Enter activates it.
    await cell.focus();
    await expect(cell).toBeFocused();
    await cell.press('Enter');
    await expect(page.locator('#sheet [data-tab="constellations"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('its name says the state and then the verb', async ({ page }) => {
    await readsOnly(page);
    await openManager(page);

    // `title` is not an accessible name, which is why the label exists at all.
    const orphan = page.locator('tr.fragment-row[data-constellations=""] .cn-cell').first();
    if (await orphan.count()) {
      await expect(orphan).toHaveAttribute('aria-label', 'In no constellations — assign one');
      await expect(orphan.locator('.admin-chip--none')).toBeVisible();
    }
    const filed = page.locator('tr.fragment-row:not([data-constellations=""]) .cn-cell').first();
    if (await filed.count()) await expect(filed).toHaveAttribute('aria-label', /^In .+ — change constellations$/);
  });

  test('nothing moves when the pointer arrives', async ({ page }) => {
    await readsOnly(page);
    await openManager(page);
    const cell = page.locator('.cn-cell').first();
    test.skip((await cell.count()) === 0, 'needs a row with the column visible');
    const chips = cell.locator('.cn-cell__chips');

    // The ＋ has a RESERVED slot rather than being appended on hover: inserting
    // a glyph beside wrapped chips reflows the cell, and a dense table cannot
    // twitch under the cursor. Same box hovered as at rest, to the pixel.
    const before = await chips.boundingBox();
    await cell.hover();
    await expect(cell.locator('.cn-cell__mark')).toBeVisible();
    const after = await chips.boundingBox();
    expect(after).toEqual(before);
  });

  test('placing from the drawer files the chip into the cell, name and all', async ({ page }) => {
    // ⚠ STUBBED — `constellations.place` writes a real row.
    //
    // The drawer patches this cell by hand after a ＋ rather than refetching,
    // and the cell becoming a button moved every landmark that patch aimed at
    // (it used to find the column by `td.lg\:table-cell` and build the chip
    // list if it was missing). Nothing else in the suite touches that code, so
    // without this it would rot silently — the chips would simply stop
    // appearing until you closed the drawer.
    await stubActions(page, { 'constellations.place': () => ({ ok: true }) });
    const { constellationId } = fixtures();
    test.skip(!constellationId, 'no constellation to compose into');

    await page.goto(`/admin/constellations/${constellationId}`);
    await hideDevToolbar(page);
    await page.locator('[data-browse]').first().click();
    const panel = page.locator('#fbrowser .fpanel');
    await expect(panel).toHaveAttribute('data-wired', '');

    // ⚠ PIN THE ROW BY ID BEFORE PRESSING ＋. `markPlaced` sets `data-placed`,
    // so a locator written as `:not([data-placed])` stops matching the row it
    // just placed and quietly re-resolves to the NEXT one — which reads as "the
    // chip never appeared" when it appeared exactly where it should have.
    const id = await panel.locator('tr.fragment-row:not([data-placed])').first().getAttribute('data-id');
    const row = panel.locator(`tr.fragment-row[data-id="${id}"]`);
    const cell = row.locator('.cn-cell');
    const before = await cell.locator('.admin-chip--in').count();
    await row.locator('[data-act="place"]').click();

    await expect(cell.locator('.admin-chip--in')).toHaveCount(before + 1);
    await expect(cell.locator('.admin-chip--none')).toHaveCount(0);
    // The label is an `aria-label`, so it does NOT follow the chips on its own
    // — and one still saying "in no constellations" over a filled chip is worse
    // than no label at all.
    await expect(cell).toHaveAttribute('aria-label', /^In .+ — change constellations$/);
  });

  test('the ＋ is visible at rest, because hover is not a signal every input has', async ({ page }) => {
    await readsOnly(page);
    await openManager(page);
    const mark = page.locator('.cn-cell__mark').first();
    test.skip((await mark.count()) === 0, 'needs a row with the column visible');
    // Touch has no hover and the keyboard has none either. A control only a
    // mouse can discover is a control half the ways into this room can't find.
    const opacity = await mark.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
    expect(opacity).toBeGreaterThan(0);
  });
});
