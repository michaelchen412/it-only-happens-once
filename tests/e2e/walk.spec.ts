// Walking the building — every room still works after you ARRIVE in it
// (plan 24 · §9, the `<ClientRouter />` migration).
//
// ⚠⚠ THIS IS THE ONLY SPEC IN THE SUITE THAT NAVIGATES THE WAY A PERSON DOES,
// and until it existed the other 352 navigations were all `page.goto` — a full
// document load, which re-runs every script from scratch. That is exactly the
// path a client-side router does NOT take.
//
// Astro's own docs state the rule this guards:
//
//   "Bundled module scripts, which are the default scripts in Astro, are only
//    ever executed once. After initial execution they will be ignored, even if
//    the script exists on the new page after a transition."
//
// So under `<ClientRouter />` the body is swapped and no module re-runs: every
// listener bound to a page element is bound to an element that has been thrown
// away. **A room reached by clicking looks perfect and does nothing.** There is
// no error, nothing in the console, and `verify` is green — the failure is a
// button that has stopped being a button.
//
// ⚠ AND THE WHOLE SUITE WOULD MISS IT. `page.goto` re-executes everything, so
// all 70 spec files would stay green with every listener in the building dead.
// That is why this file was written BEFORE the migration rather than after: it
// is the instrument, not the report.
//
// ⚠ WHAT "STILL WORKS" MEANS HERE, deliberately narrow: each room is asked to
// do ONE thing that cannot happen without JavaScript bound to a live element —
// open a dialog, toggle a popover, filter a list. It is not a second copy of
// each room's own spec. A room whose one control responds has had its module
// re-bound; a room whose control is inert has not, and that is the single bit
// this file exists to report.
//
// READ-ONLY: nothing below writes. Opening a dialog is not a save.
import type { Page } from '@playwright/test';
import { test, expect, hideDevToolbar } from './fixtures';

/**
 * Click a sidebar row and wait for the room to arrive.
 *
 * ⚠ CLICKING, NEVER `page.goto` — that is the entire point of the file. Under a
 * full-page load this is merely a slower `goto`; under `<ClientRouter />` it is
 * a swap, and only then does anything below mean anything.
 */
async function walkTo(page: Page, key: string) {
  await page.locator(`nav [data-nav-row][href$="${key}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`${key.replace(/\//g, '\\/')}$`));
  await page.waitForLoadState('networkidle');
}

/**
 * Arrive in a room, leave, and arrive again.
 *
 * ⚠⚠ THE SECOND ARRIVAL IS THE ONE THAT MATTERS, and this is the single most
 * surprising thing about the router. Astro executes scripts that are NEW to the
 * page (step 7 of its navigation process), so the FIRST time you walk into a
 * room its module runs and everything works. Walk out and back and it does not
 * run again — it has already executed once in this document — so the room is
 * inert on every visit after the first.
 *
 * A harness that only ever arrives once would therefore go green across the
 * whole building and prove almost nothing. Measured 2026-09-18 with the router
 * on: the single-visit probes passed for the pile, the Library and the manager,
 * and the same controls were dead on the second visit.
 */
async function roundTrip(page: Page, key: string) {
  await walkTo(page, key);
  await walkTo(page, key === '/admin/people' ? '/admin/library' : '/admin/people');
  await walkTo(page, key);
}

/**
 * One control per room that is INERT without a live listener.
 *
 * ⚠ EACH IS A DIALOG OR A POPOVER, chosen because the assertion is unambiguous:
 * the element either entered the top layer or it did not. A class toggle could
 * be a CSS `:hover` or a server-rendered state and would let a dead listener
 * pass.
 */
const ROOMS: { key: string; name: string; open: string; shows: string }[] = [
  { key: '/admin/notes', name: 'the pile', open: '#cap-open', shows: '#cap-dialog' },
  { key: '/admin/agenda', name: 'the calendar', open: '#cap-open', shows: '#cap-dialog' },
  { key: '/admin/people', name: 'People', open: '#cap-open', shows: '#cap-dialog' },
  { key: '/admin/fragments', name: 'the manager', open: '#cap-open', shows: '#cap-dialog' },
  { key: '/admin/library', name: 'the Library', open: '#cap-open', shows: '#cap-dialog' },
];

test.describe('the ✚ survives the walk — it belongs to the building', () => {
  /*
    ⚠ THE ✚ FIRST, AND ON EVERY ROOM, because it is the one control mounted by
    `AdminLayout` rather than by a page — so it is the single widest blast
    radius in the Observatory. If `capture.ts` does not re-bind, the ✚ is dead
    in every room you did not land on directly, which is most of them.
  */
  for (const room of ROOMS) {
    test(`${room.name}: the ✚ opens after walking there`, async ({ page }) => {
      await page.goto('/admin');
      await hideDevToolbar(page);
      await walkTo(page, room.key);

      await page.locator(room.open).click();
      await expect(
        page.locator(room.shows),
        `the ✚ is inert in ${room.name} after a client-side arrival — capture.ts did not re-bind`,
      ).toBeVisible();
      await page.keyboard.press('Escape');
    });
  }
});

test.describe('a room’s own controls survive the walk', () => {
  test('the pile: the → chooser still opens on a card', async ({ page }) => {
    await page.goto('/admin');
    await hideDevToolbar(page);
    await roundTrip(page, '/admin/notes');

    const card = page.locator('.dump').first();
    test.skip((await card.count()) === 0, 'the pile is empty');
    await card.locator('[data-file]').click();
    await expect(
      page.locator('#dump-file'),
      'the chooser is inert after a client-side arrival — notes.ts did not re-bind',
    ).toBeVisible();
  });

  test('the pile: the pencil still opens the drawer', async ({ page }) => {
    await page.goto('/admin');
    await hideDevToolbar(page);
    await roundTrip(page, '/admin/notes');

    const card = page.locator('.dump').first();
    test.skip((await card.count()) === 0, 'the pile is empty');
    await card.locator('[data-edit]').click();
    await expect(page.locator('#nsheet')).toBeVisible();
    // …and the EDITOR inside it, which is the lazily-imported half: a warm-up
    // that only ran on first document load would leave this drawer empty.
    await expect(
      page.locator('#ns-editor .ProseMirror'),
      'the drawer opened with no editor in it — the lazy import did not re-warm',
    ).toBeVisible({ timeout: 10_000 });
  });

  test('the Library: a row’s Delete still asks before it acts', async ({ page }) => {
    await page.goto('/admin');
    await hideDevToolbar(page);
    await roundTrip(page, '/admin/library');

    const row = page.locator('.lib-row').first();
    test.skip((await row.count()) === 0, 'no vocabulary rows');
    await row.locator('.lib-delete').click();
    /*
      ⚠ A CONFIRM IS THE RIGHT ASSERTION FOR A DESTRUCTIVE CONTROL. If
      `library.ts` has not re-bound, this button does nothing — and "nothing" is
      indistinguishable from "safe" by eye, which is the worst shape a dead
      listener can take on a delete.
    */
    await expect(
      page.locator('dialog[open]'),
      'Delete is inert after a client-side arrival — library.ts did not re-bind',
    ).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('the manager: a row still opens its editor sheet', async ({ page }) => {
    await page.goto('/admin');
    await hideDevToolbar(page);
    await roundTrip(page, '/admin/fragments');

    /*
      ⚠ NOT THE SEARCH BOX, WHICH LOOKS LIKE THE OBVIOUS PROBE AND IS USELESS
      HERE: the manager's `q` field is a SERVER-SIDE form (`name="q"`), so it
      narrows the list by navigating. It would pass this spec with every script
      in the building dead, which is the one thing a harness must never do.

      Opening a row is the real listener: `open-editor.ts` catches the click and
      dispatches `writing:edit` / `fragment:edit`, and a sheet the size of the
      screen either arrives or does not.
    */
    const row = page.locator('tr.fragment-row[data-writing], tr.fragment-row[data-fragment]').first();
    test.skip((await row.count()) === 0, 'no fragments to open');

    await row.click();
    await expect(
      page.locator('dialog[open]').first(),
      'a row is inert after a client-side arrival — open-editor.ts or its sheet did not re-bind',
    ).toBeVisible();
  });
});

test.describe('the walk does not leave duplicates behind', () => {
  /*
    ⚠ THE OTHER HALF OF THE MIGRATION, AND THE ONE A HUMAN WOULD NOT SPOT.
    Element-bound listeners DIE on a swap; `document`-bound ones ACCUMULATE,
    because `document` survives it. A module that re-registers its document
    listeners on every arrival ends up with N copies after N navigations — so
    one press files a note twice, or opens two dialogs, or sends two writes.
    Nothing looks wrong until the second one lands.

    Walking away and back is the cheapest way to force N=2.
  */
  test('⚠ the ✚ opens ONE dialog after walking away and back', async ({ page }) => {
    await page.goto('/admin/notes');
    await hideDevToolbar(page);
    await walkTo(page, '/admin/people');
    await walkTo(page, '/admin/notes');

    await page.locator('#cap-open').click();
    await expect(page.locator('#cap-dialog')).toBeVisible();
    expect(
      await page.locator('dialog[open]').count(),
      'more than one dialog opened — a listener was registered twice',
    ).toBe(1);
  });

  test('⚠ a card’s → opens ONE chooser after walking away and back', async ({ page }) => {
    await page.goto('/admin/notes');
    await hideDevToolbar(page);
    const card = page.locator('.dump').first();
    test.skip((await card.count()) === 0, 'the pile is empty');

    await walkTo(page, '/admin/library');
    await walkTo(page, '/admin/notes');

    await page.locator('.dump').first().locator('[data-file]').click();
    await expect(page.locator('#dump-file')).toBeVisible();
    // A popover registered twice toggles twice on one press and lands closed.
    await expect(
      page.locator('#dump-file'),
      'the chooser closed itself — its toggle ran twice, so the handler is bound twice',
    ).toBeVisible();
  });
});
