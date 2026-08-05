// The composer's suite — docs/plans/15, Pieces 1, 5 and 6.
//
// ⚠ STUBBED, AND IT HAS TO BE. `constellations.unplace` is a real DELETE against
// a real row, and this harness runs against the LIVE project: an unstubbed run
// of this file would quietly dismantle one of Michael's compositions. Every
// action these specs can reach is answered here, and a name with no handler is
// aborted rather than passed through, so the file cannot grow a call to the
// database by accident.
//
// The page itself is server-rendered from live data, which is fine (a read), and
// it means the suite's SIZE is whatever happens to be there. So the assertions
// are written against INVARIANTS — "the placed count went down by one", "the
// subject badge equals the union of what remains" — rather than against numbers
// that would need a seeded corpus to be true.
import { expect, test, type Page } from '@playwright/test';
import { fixtures, hideDevToolbar, stubActions } from './fixtures';

/** Every action the composer can fire, answered locally. Anything not named
 *  here is aborted rather than passed through — that is what keeps the live
 *  corpus safe from a spec that grows a new call later. */
const stubComposer = (page: Page) =>
  stubActions(page, {
    'constellations.unplace': () => ({ ok: true }),
    'constellations.reorderPlacements': () => ({ ok: true }),
    'constellations.place': () => ({ ok: true }),
  });

/** Stamp a sentinel we can look for afterwards: if the page navigated, it's gone. */
async function markNoNavigation(page: Page) {
  await page.evaluate(() => ((window as unknown as { __stayed?: number }).__stayed = 1));
}
const stayed = (page: Page) => page.evaluate(() => (window as unknown as { __stayed?: number }).__stayed === 1);

async function openComposer(page: Page) {
  const { composedConstellationId } = fixtures();
  test.skip(!composedConstellationId, 'no constellation with a suite to compose');
  await page.goto(`/admin/constellations/${composedConstellationId}`);
  await expect(page.locator('#suite-rows')).toBeVisible();
  await hideDevToolbar(page);
  await markNoNavigation(page);
}

const rows = (page: Page) => page.locator('#suite-rows li[data-fid]');
const statN = (page: Page, id: string) => page.locator(`#${id} .admin-stat__n`);

test.describe('the ✕ unplaces without reloading', () => {
  test('the row goes, and the page does not', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);

    const before = await rows(page).count();
    const firstId = await rows(page).first().getAttribute('data-fid');

    await rows(page).first().locator('[data-unplace]').click();

    await expect(rows(page)).toHaveCount(before - 1);
    // The one assertion the whole piece is about: no navigation happened.
    expect(await stayed(page), 'the page reloaded — the ✕ is still navigating').toBe(true);
    // …and it left with its stanza in the Read view, not just its Compose row.
    await expect(page.locator(`#suite-read-list [data-fid="${firstId}"]`)).toHaveCount(0);
  });

  test('the badges are recomputed, not left behind', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);

    const before = await rows(page).count();
    const doomed = rows(page).first();
    const type = await doomed.getAttribute('data-type');
    const typeBefore = Number(await page.locator(`[data-type-count="${type}"] .admin-stat__n`).textContent());

    await doomed.locator('[data-unplace]').click();
    await expect(rows(page)).toHaveCount(before - 1);

    await expect(statN(page, 'suite-placed')).toHaveText(String(before - 1));
    await expect(page.locator(`[data-type-count="${type}"] .admin-stat__n`)).toHaveText(String(typeBefore - 1));

    // The subject spread is the UNION of what remains — the one number a stale
    // badge would get wrong in a way nobody notices.
    const expected = await page.evaluate(() => {
      const set = new Set<string>();
      document.querySelectorAll<HTMLElement>('#suite-rows li[data-fid]').forEach((li) => {
        (li.dataset.subjects ?? '')
          .split('|')
          .filter(Boolean)
          .forEach((s) => set.add(s));
      });
      return set.size;
    });
    await expect(statN(page, 'suite-spread')).toHaveText(String(expected));
  });

  test('the mass-noun rule survives the trip to the client', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);
    // "writing" never pluralises whatever the count; quote/song do. The rule is
    // the server's, and after an unplace it has to be the client's too.
    await rows(page).first().locator('[data-unplace]').click();
    await expect(page.locator('[data-type-count="writing"] .admin-stat__label')).toHaveText('writing');
    for (const t of ['quote', 'song']) {
      const n = Number(await page.locator(`[data-type-count="${t}"] .admin-stat__n`).textContent());
      await expect(page.locator(`[data-type-count="${t}"] .admin-stat__label`)).toHaveText(n === 1 ? t : `${t}s`);
    }
  });

  test('the thin-suite hint appears as the suite drops below five', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);

    // At least one removal, so the CLIENT-side path runs even on a suite the
    // server already rendered as thin — then down to four, the threshold
    // suiteHints() draws.
    do {
      const n = await rows(page).count();
      await rows(page).first().locator('[data-unplace]').click();
      await expect(rows(page)).toHaveCount(n - 1);
    } while ((await rows(page).count()) > 4);
    await expect(page.locator('#suite-hints')).toBeVisible();
    await expect(page.locator('#suite-hints')).toContainText('thin');
    expect(await stayed(page)).toBe(true);
  });

  test('removing the last one shows the empty state and hides the view toggle', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);

    while ((await rows(page).count()) > 0) {
      const n = await rows(page).count();
      await rows(page).first().locator('[data-unplace]').click();
      await expect(rows(page)).toHaveCount(n - 1);
    }

    // Markup the page would not have had at all before Piece 1 rendered the
    // suite chrome unconditionally.
    await expect(page.locator('#suite-empty')).toBeVisible();
    await expect(page.locator('#suite-viewseg')).toBeHidden();
    await expect(page.locator('#suite-rows')).toBeHidden();
    await expect(page.locator('#suite-read')).toBeHidden();
    await expect(statN(page, 'suite-placed')).toHaveText('0');
    await expect(page.locator('#suite-hints')).toBeHidden(); // an empty suite isn't "thin"
    expect(await stayed(page)).toBe(true);
  });

  test('focus lands somewhere usable, not on <body>', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);

    await rows(page).first().locator('[data-unplace]').click();
    await expect(rows(page).first()).toBeVisible();
    // The next row's ✕ — so removing a run of rows doesn't strand the keyboard.
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { tag: el?.tagName, unplace: el?.hasAttribute('data-unplace') ?? false };
    });
    expect(focused.tag, 'focus fell to the document — the keyboard is stranded').not.toBe('BODY');
    expect(focused.unplace).toBe(true);
  });

  test('a refused unplace keeps the row and speaks', async ({ page }) => {
    // Everything aborts → the action errors → the row must NOT disappear.
    await page.route('**/_actions/**', (route) => route.abort('failed'));
    await openComposer(page);

    const before = await rows(page).count();
    await rows(page).first().locator('[data-unplace]').click();

    await expect(page.locator('#cc-error')).toBeVisible();
    await expect(rows(page)).toHaveCount(before);
    expect(await stayed(page)).toBe(true);
  });
});

test.describe('reordering survives a refresh', () => {
  test('drag listeners still fire after the suite is swapped', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);
    test.skip((await rows(page).count()) < 2, 'needs two rows to reorder');

    const idsBefore = await rows(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.fid));

    // The element-identity trap, turned into an assertion: fire the refresh the
    // sheets fire, then check the delegated keydown handler on #suite-rows is
    // still bound. Replacing the <ol> instead of its innerHTML kills it.
    await page.evaluate(
      () =>
        void document.dispatchEvent(
          new CustomEvent('fragments:changed', { cancelable: true, detail: { settled: Promise.resolve() } }),
        ),
    );
    await expect(rows(page)).toHaveCount(idsBefore.length);

    await rows(page).first().locator('[data-unplace]').focus();
    await page.keyboard.press('Alt+ArrowDown');

    const idsAfter = await rows(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.fid));
    expect(idsAfter[0], 'Alt+↓ did nothing — the swap replaced the element and took its listeners').toBe(idsBefore[1]);
    expect(idsAfter[1]).toBe(idsBefore[0]);
  });
});
