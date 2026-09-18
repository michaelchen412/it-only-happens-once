// Shelves — the whole lifecycle, in a real browser (ADR 0042; fixed 2026-09-18).
//
// ⚠⚠ THIS FILE IS THE POINT OF THE WHOLE FIX. Shelves shipped on 2026-09-01
// with a bench, an ADR, a migration, a docs entry — and no test of any kind.
// `grep -rln 'data-shelf' tests/` returned nothing, and `notes.spec.ts` covered
// the ✚, the box, the pile, the five destinations and the parser across 951
// lines without touching a shelf once.
//
// Four user-visible faults then survived a green `verify` for two and a half
// weeks, and Michael found all four by using the room:
//
//   1. a new shelf appeared in the chooser and NOWHERE ELSE     → §1
//   2. …and its row had no tick, so it could never look chosen  → §1
//   3. a small pile hid the shelf strip entirely, refresh or no → §2
//   4. the ✚ could not file into the shelf you were standing in → §4
//
// Each test below is named for the fault it would have caught.
//
// READ-ONLY BY CONSTRUCTION, like every spec here: this runs against the LIVE
// project, so `shelves.create` and `shelves.set` are STUBBED. What is proved is
// that the client does the right thing given a correct response — never that
// the server sends one. `src/tests/shelves-view.test.ts` covers the half that
// can be tested without a browser (what the inbox MEANS).
import type { Page } from '@playwright/test';
import { test, expect, hideDevToolbar, stubActions } from './fixtures';

/** A shelf `shelves.create` would have returned. Never written anywhere. */
const MADE = { id: '11111111-2222-3333-4444-555555555555', name: 'Zzz Test Shelf', slug: 'zzz-test-shelf' };

const gotoPile = async (page: Page, query = '') => {
  await page.goto(`/admin/notes${query}`);
  await hideDevToolbar(page);
  await expect(page.locator('#notes-pile, .border-dashed').first()).toBeVisible();
};

/** Open the → chooser on the first card in the pile. */
async function openChooser(page: Page) {
  const card = page.locator('.dump').first();
  await card.locator('[data-file]').click();
  await expect(page.locator('#dump-file')).toBeVisible();
  return card;
}

test.describe('§1 — a shelf made from the chooser reaches the whole room', () => {
  test('⚠ the new row is indistinguishable from a server-rendered one — glyph, tick and all', async ({ page }) => {
    await stubActions(page, {
      'shelves.create': () => MADE,
      'shelves.set': () => ({ ok: true, count: 1 }),
    });
    await gotoPile(page);
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty; nothing to file');

    await openChooser(page);

    // A server-rendered row, to compare against. If the pile has no shelves at
    // all there is nothing to measure "identical" against, so this half skips.
    const existing = page.locator('#dump-file [data-shelf]').first();
    const hadAny = (await existing.count()) > 0;
    const shape = hadAny
      ? await existing.evaluate((el) => ({
          cls: el.className,
          icons: el.querySelectorAll('svg').length,
          tick: !!el.querySelector('.pop__tick'),
          name: !!el.querySelector('[data-name]'),
        }))
      : null;

    await page.locator('[data-shelf-new]').click();
    const field = page.locator('[data-shelf-new-form] input');
    await expect(field).toBeFocused();
    await field.fill(MADE.name);
    await field.press('Enter');

    const made = page.locator(`#dump-file [data-shelf="${MADE.id}"]`);
    await expect(made).toHaveCount(1);

    /*
      ⚠ THE TICK IS THE ASSERTION THAT WOULD HAVE CAUGHT THE BUG. The old code
      built this row with `row.textContent = data.name`, which produces a button
      that LOOKS approximately right and carries no `.pop__tick` — and
      `.pop__row.is-on .pop__tick` is the only thing that draws a checkmark. So a
      shelf made in this session could never show as chosen, in a menu whose
      entire job is showing you what a note is on.
    */
    await expect(made.locator('.pop__tick')).toHaveCount(1);
    await expect(made.locator('[data-name]')).toHaveText(MADE.name);

    if (shape) {
      expect(
        await made.evaluate((el) => ({
          cls: el.className,
          icons: el.querySelectorAll('svg').length,
          tick: !!el.querySelector('.pop__tick'),
          name: !!el.querySelector('[data-name]'),
        })),
        'a cloned row must be indistinguishable from a server-rendered one',
      ).toEqual(shape);
    }
  });

  test('⚠ it reaches the FILTER STRIP too — the half that needed a hard refresh', async ({ page }) => {
    await stubActions(page, {
      'shelves.create': () => MADE,
      'shelves.set': () => ({ ok: true, count: 1 }),
    });
    await gotoPile(page);
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty; nothing to file');

    await openChooser(page);
    await page.locator('[data-shelf-new]').click();
    await page.locator('[data-shelf-new-form] input').fill(MADE.name);
    await page.locator('[data-shelf-new-form] input').press('Enter');

    /*
      This is the reported bug in one locator. The chooser learned the word and
      nothing else did, so the shelf you had just made — and just filed a note
      onto — had no control anywhere on the page that could reach it.
    */
    const link = page.locator(`[data-shelf-link="${MADE.id}"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/admin/notes?shelf=${MADE.slug}`);
    await expect(link.locator('[data-name]')).toHaveText(MADE.name);

    // And a badge the filing can then count into — `bumpBadge` looks this up by
    // id, so a missing hook is a count that silently stays blank.
    await expect(page.locator(`[data-shelf-badge="${MADE.id}"]`)).toHaveCount(1);

    // The strip and the bar around it must be on screen, not merely present.
    await expect(page.locator('[data-shelf-row]')).toBeVisible();
    await expect(page.locator('[data-notes-bar]')).toBeVisible();
  });
});

test.describe('§2 — the shelf strip is not gated on how deep the pile is', () => {
  /*
    ⚠ THE FAULT THIS PINS WAS NOT STALENESS, which is why it deserves its own
    describe. One condition covered the whole bar — `notes.length > 4 ||
    inboxCount > 4 || searching || activeShelf` — so a room with four jottings
    rendered no shelf row at all. And because the inbox HIDES a shelved note,
    filing one put it somewhere with no door back until the pile grew past four.
    A refresh did not help. Only a deeper pile did.
  */
  test('⚠ a pressed shelf always shows the strip, however few notes are in view', async ({ page }) => {
    await gotoPile(page);
    const links = page.locator('[data-shelf-link]');
    test.skip((await links.count()) === 0, 'no shelves in this database to press');

    const href = await links.first().getAttribute('href');
    await page.goto(href!);
    await hideDevToolbar(page);

    // However few notes this shelf holds — including none — the way back to the
    // inbox and across to the other shelves has to be on screen.
    await expect(page.locator('[data-shelf-row]')).toBeVisible();
    await expect(page.locator('[data-notes-bar]')).toBeVisible();
    await expect(page.locator('[data-shelf-row] a').first()).toContainText('Inbox');
  });

  test('the search box still waits for depth — it is furniture over a short pile', async ({ page }) => {
    await gotoPile(page);
    const cards = await page.locator('.dump').count();
    const inbox = Number((await page.locator('[data-shelf-badge="inbox"]').textContent())?.trim() || '0');
    // The two rules are genuinely separate now; this is the half that did NOT
    // change, asserted so a future tidy-up cannot quietly merge them again.
    const expected = cards > 4 || inbox > 4;
    await expect(page.locator('[data-notes-filter]')).toHaveCount(expected ? 1 : 0);
  });
});

test.describe('§3 — the Library grooms the vocabulary', () => {
  test('⚠ shelves are the fourth vocabulary, with a rename and a delete', async ({ page }) => {
    await page.goto('/admin/library');
    await hideDevToolbar(page);

    const rows = page.locator('.lib-row[data-entity="shelf"]');
    const section = page.locator('[data-vocab]').filter({ hasText: 'Shelves' });
    await expect(section).toHaveCount(1);
    test.skip((await rows.count()) === 0, 'no shelves in this database to groom');

    const row = rows.first();
    await expect(row.locator('[data-field="name"]')).toHaveCount(1);
    await expect(row.locator('.lib-save')).toHaveCount(1);
    await expect(row.locator('.lib-delete')).toHaveCount(1);

    /*
      ⚠ NO MERGE, AND ITS ABSENCE IS ASSERTED. There is no `merge_shelves`
      function and there should not be: filing the notes across and deleting the
      empty shelf reaches the same place with every step visible. A Merge…
      button here could only ever fail, which is the "disabled control asking a
      question with no answers" this building refuses (10-hq §10b).
    */
    await expect(row.locator('[data-lib-merge]')).toHaveCount(0);
  });

  test('⚠ the slug is shown and cannot be edited — `?shelf=` addresses this view', async ({ page }) => {
    await page.goto('/admin/library');
    await hideDevToolbar(page);
    const row = page.locator('.lib-row[data-entity="shelf"]').first();
    test.skip((await row.count()) === 0, 'no shelves in this database to groom');

    /*
      A shelf's slug is an IDENTIFIER that happened to be minted from its first
      name. `shelves.rename` deliberately leaves it alone, because an unknown
      slug resolves to `activeShelf: null` and renders the inbox as though
      nothing were wrong — so a re-derived slug would break every bookmark
      silently. Printing it read-only is what stops the rename control looking
      like it renames the URL too.
    */
    await expect(row.locator('.font-mono')).toContainText('/');
    await expect(row.locator('input[data-field="slug"]')).toHaveCount(0);
  });
});

test.describe('§4 — the ✚ knows which shelf you are standing in', () => {
  /*
    Michael: *"if I have a notes section already open there should be an option
    to add a note into here under that category automatically (currently only
    way is through the floating + button which seems to have no connection)."*
  */
  /**
   * The shelves this database actually has, read off the pile's own filter
   * strip.
   *
   * ⚠ WHY THE VOCABULARY HAS TO BE STUBBED AT ALL, since it is only a READ: the
   * read-only fixture blocks `/_actions/**` wholesale, because it cannot tell a
   * read from a write and the guarantee is worth more than the convenience
   * (fixtures.ts says so at length). `people.roster` is in the same position.
   * So the stub here is not a fiction — it is this room's real vocabulary,
   * handed back through a door the guard has closed.
   */
  async function realShelves(page: Page) {
    return page.locator('[data-shelf-link]').evaluateAll((els) =>
      els.map((el) => ({
        id: (el as HTMLElement).dataset.shelfLink!,
        name: el.querySelector('[data-name]')!.textContent!.trim(),
        slug: new URL((el as HTMLAnchorElement).href).searchParams.get('shelf')!,
      })),
    );
  }

  test('⚠ the chip for the pressed shelf starts lit', async ({ page }) => {
    await gotoPile(page);
    const vocab = await realShelves(page);
    test.skip(vocab.length === 0, 'no shelves in this database to press');

    const pressed = vocab[0];
    await stubActions(page, { 'shelves.list': () => vocab });
    await page.goto(`/admin/notes?shelf=${pressed.slug}`);
    await hideDevToolbar(page);

    await page.locator('#cap-open').click();
    await expect(page.locator('#cap-dialog')).toBeVisible();

    const row = page.locator('[data-cap-shelf]');
    await expect(row).toBeVisible();

    /*
      This is the reported gap in one assertion. The ✚ belongs to the BUILDING
      rather than to a room — that rule is not in question — but it was being
      read as "knows nothing about where you are standing", which is a different
      claim. Standing in a shelf and pressing ✚ wrote to the inbox and reloaded
      you into a view the note was not in.
    */
    const lit = row.locator('.lchip--on');
    await expect(lit).toHaveCount(1);
    await expect(lit).toHaveText(pressed.name);
    await expect(lit).toHaveAttribute('aria-pressed', 'true');

    // …and only that one. Every other shelf is offered, unlit.
    await expect(row.locator('.lchip')).toHaveCount(vocab.length);
  });

  test('the inbox lights nothing — the ✚ offers, it does not choose', async ({ page }) => {
    await gotoPile(page);
    const vocab = await realShelves(page);
    test.skip(vocab.length === 0, 'no shelves in this database');

    await stubActions(page, { 'shelves.list': () => vocab });
    await gotoPile(page);
    await page.locator('#cap-open').click();
    await expect(page.locator('#cap-dialog')).toBeVisible();

    // No shelf is pressed, so nothing is preselected: a jot from the inbox goes
    // to the inbox unless you say otherwise.
    await expect(page.locator('[data-cap-shelf]')).toBeVisible();
    await expect(page.locator('[data-cap-shelf] .lchip--on')).toHaveCount(0);
  });

  test('the row belongs to the jot tab — the other three take the note OUT of the pile', async ({ page }) => {
    await gotoPile(page);
    const vocab = await realShelves(page);
    test.skip(vocab.length === 0, 'no shelves in this database');

    await stubActions(page, { 'shelves.list': () => vocab });
    await gotoPile(page);
    await page.locator('#cap-open').click();
    await expect(page.locator('#cap-dialog')).toBeVisible();
    await expect(page.locator('[data-cap-shelf]')).toBeVisible();

    /*
      A task, a quote and a piece all CONSUME the jotting, so a shelf on any of
      them would be filing a thing that is about to stop existing. Same rule the
      Log tab's person picker follows in the other direction.
    */
    await page.locator('[data-cap-tab="agenda"]').click();
    await expect(page.locator('[data-cap-shelf]')).toBeHidden();

    await page.locator('[data-cap-tab="jot"]').click();
    await expect(page.locator('[data-cap-shelf]')).toBeVisible();
  });

  test('⚠ no vocabulary means no control, rather than an empty strip', async ({ page }) => {
    // 10-hq §10b, the rule the Log tab and the pile's chooser both apply. Forced
    // rather than waited for, because the live database does have shelves.
    await stubActions(page, { 'shelves.list': () => [] });
    await gotoPile(page);
    await page.locator('#cap-open').click();
    await expect(page.locator('#cap-dialog')).toBeVisible();
    await expect(page.locator('[data-cap-shelf]')).toBeHidden();
  });
});
