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

test.describe('§3 — the vocabulary is groomed in the room that uses it', () => {
  /*
    ⚠ THIS MOVED OUT OF THE LIBRARY ON 2026-09-18 and the tests moved with it.
    Shelves shipped there first, beside subjects, authors and works — Michael:
    *"its not really intuitive to go into library. ideally we have a way to
    manage while we are in notes anyway."* A shelf is the only vocabulary in the
    building scoped to ONE room, so the Library was buying a trip it exists to
    save. `notes.astro` carries the full argument.
  */
  test('⚠ the pencil on the filter strip opens the manager', async ({ page }) => {
    await gotoPile(page);
    const pencil = page.locator('[data-shelf-manage]');
    test.skip((await pencil.count()) === 0, 'no shelves in this database');
    await expect(pencil).toBeVisible();

    await pencil.click();
    await expect(page.locator('#shelf-manage')).toBeVisible();

    const rows = page.locator('#shelf-manage [data-shelf-item]');
    expect(await rows.count()).toBe(await page.locator('[data-shelf-link]').count());
    await expect(rows.first().locator('[data-shelf-rename]')).toBeVisible();
    await expect(rows.first().locator('[data-shelf-remove]')).toBeVisible();
    // Creating is here too — the chooser files as it creates, this one does not.
    await expect(page.locator('[data-shelf-create] input')).toBeVisible();
  });

  test('⚠ the Library no longer carries shelves — one home, and it is this one', async ({ page }) => {
    await page.goto('/admin/library');
    await hideDevToolbar(page);
    await expect(page.locator('.lib-row[data-entity="shelf"]')).toHaveCount(0);
    // …and the other three are untouched, so this was a move and not a deletion.
    await expect(page.locator('.lib-row[data-entity="subject"]').first()).toBeVisible();
  });

  test('the count on a row is a door to those notes', async ({ page }) => {
    await gotoPile(page);
    test.skip((await page.locator('[data-shelf-manage]').count()) === 0, 'no shelves');
    await page.locator('[data-shelf-manage]').click();
    const link = page.locator('#shelf-manage [data-shelf-item]').first().locator('.shelfman__n');
    // The one thing in this dialog you might want to LOOK at before deciding.
    await expect(link).toHaveAttribute('href', /\/admin\/notes\?shelf=/);
  });
});

test.describe('§3b — the drawer says where the open note lives', () => {
  /*
    ⚠ REPORTED MISSING 2026-09-18: *"in the main dedicated notes editor sheet,
    theres no way to categorize stuff."* The card could file a note and the
    drawer — the one surface you actually sit and read one in — could neither
    say where it lived nor move it. It was the only shelf surface in the building
    blank in BOTH directions.
  */
  const openDrawer = async (page: Page) => {
    await gotoPile(page);
    const card = page.locator('.dump').first();
    test.skip((await card.count()) === 0, 'the pile is empty');
    await card.locator('[data-edit]').click();
    await expect(page.locator('#nsheet')).toBeVisible();
    await expect(page.locator('#ns-editor .ProseMirror')).toBeVisible({ timeout: 10_000 });
  };

  test('⚠ every shelf is offered in the head, beside the stamp', async ({ page }) => {
    await openDrawer(page);
    const chips = page.locator('#ns-shelves .lchip');
    test.skip((await page.locator('[data-shelf-link]').count()) === 0, 'no shelves in this database');

    // The vocabulary is read from the chooser, so the two can never disagree.
    expect(await chips.count()).toBe(await page.locator('#dump-file [data-shelf]').count());

    /*
      ⚠ IN THE HEAD, NOT THE FOOT, and the assertion is structural rather than
      cosmetic. All five rows in the foot CONSUME the note; a shelf is how a
      thought stays. Mixed in among them it would be the one control that does
      not do what its neighbours do.
    */
    await expect(page.locator('.nsheet__head #ns-shelves')).toHaveCount(1);
    await expect(page.locator('.nsheet__foot #ns-shelves')).toHaveCount(0);
  });

  test('⚠ a chip files the note, and the card agrees — the card is still the state', async ({ page }) => {
    await stubActions(page, { 'shelves.set': () => ({ ok: true, count: 1 }) });
    await openDrawer(page);
    const chip = page.locator('#ns-shelves .lchip').first();
    test.skip((await chip.count()) === 0, 'no shelves in this database');

    const name = (await chip.textContent())!.trim();
    const was = await chip.getAttribute('aria-pressed');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true');

    // The drawer writes nothing of its own: it dispatches into the same
    // `setShelves` the card chooser calls, so the card foot must follow.
    const foot = page.locator('.dump').first().locator('[data-shelf-id]');
    if (was !== 'true') await expect(foot.filter({ hasText: name })).toHaveCount(1);
  });

  test('⚠ filing from the drawer does NOT eject the card from under you', async ({ page }) => {
    await stubActions(page, { 'shelves.set': () => ({ ok: true, count: 1 }) });
    await openDrawer(page);
    const chip = page.locator('#ns-shelves .lchip:not(.lchip--on)').first();
    test.skip((await chip.count()) === 0, 'nothing left to file this note onto');

    await chip.click();
    await page.waitForTimeout(400);
    /*
      In the pile, filing IS the card going away — that is the feedback, and the
      undo strip is its way back. In the drawer it is not triage: you are reading
      the thing, and the pile is the rail beside you. Letting the leave run here
      would drop the row out of the rail, offer to undo something still on
      screen, and eventually `remove()` the card the drawer is open on.
    */
    await expect(page.locator('.dump').first()).toBeVisible();
    await expect(page.locator('#notes-undo.is-visible')).toHaveCount(0);
    await expect(page.locator('#nsheet')).toBeVisible();
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
