// The roster and the add sheet (12 · Piece 1).
//
// READ-ONLY BY CONSTRUCTION, like the rest of the harness. These specs run
// against the LIVE project, so nothing here may create a person: every spec
// that drives the sheet stubs `/_actions/**`, which means what they prove is
// that the CLIENT behaves given a correct response — never that the action
// sends one. That gap is real and is closed by the live action drive recorded
// in the plans, not here.
//
// WHAT IS WORTH A SPEC HERE, and why:
//
//  · THE SEGMENTED CONTROL. Trap 6 (10-hq.md §10h): `:hover` beats the selected
//    state at equal specificity, so the segment you just tapped goes pale under
//    the cursor and reads as disabled. It was found in the tasks lab, it is a
//    CSS ordering bug, and typecheck and build both pass with it present.
//  · THE DAY OPTIONS TRIMMING TO THE MONTH. "31 April" is refused by the table,
//    by the action, and — the only one you can see — by the picker.
//  · A FAILED SAVE GIVING THE BUTTON BACK. The expensive lesson twice over:
//    a stuck "Thinking…" (subject-suggest) and a swallowed save (the check-in,
//    caught by its own spec on first run). `astro:actions` THROWS on a dead
//    network rather than returning `{ error }`.
//  · THE PHOTO NOT UPLOADING UNTIL SAVE. Backing out of the sheet must leave no
//    orphan object in the private bucket.
import type { Page } from '@playwright/test';
import { test, expect, stubActions } from './fixtures';

/** Is anybody in the roster? These specs adapt rather than seed. */
async function rosterSize(page: Page): Promise<number> {
  return page.locator('[data-person]').count();
}

test.describe('the roster', () => {
  test('is a room in the Observatory, reachable from the sidebar', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('link', { name: 'People', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/people$/);
    await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
  });

  // ⚠ REWRITTEN TWICE, and the history is the point. It first asserted that no
  // card carried a last-contact line (Piece 2 gave that a source), then that
  // drift appeared nowhere (Piece 4 gave THAT a source). What survives both
  // rewrites is the half that was never about a table: however drift is shown,
  // it is never ANNOUNCED. A spec that encodes "not built yet" has an expiry
  // date; this one no longer does.
  test('never announces drift, however it shows it', async ({ page }) => {
    await page.goto('/admin/people');
    // No badge, no count, no "overdue", no red. Drift is a weight shift on a
    // line you were already reading, and one warm panel — never a score.
    await expect(page.getByText('overdue', { exact: false })).toHaveCount(0);
    await expect(page.locator('.u-now')).toHaveCount(0);
    await expect(page.locator('[data-person] .chip')).toHaveCount(0);
    // The notice, when there is one, is NOT card-shaped — it is an observation
    // about the roster, not a second section of it (§3).
    await expect(page.locator('[data-been-a-while].pc, [data-been-a-while] .pgrid')).toHaveCount(0);
  });

  test('shows one line and one button when nobody is here, or cards when they are', async ({ page }) => {
    await page.goto('/admin/people');
    const count = await rosterSize(page);

    if (count === 0) {
      await expect(page.getByText('Nobody here yet.')).toBeVisible();
      await expect(page.getByRole('button', { name: /Add the first/ })).toBeVisible();
      // No grid of skeletons, no "0 people", no setup checklist.
      await expect(page.locator('.pgrid')).toHaveCount(0);
    } else {
      await expect(page.getByText('Nobody here yet.')).toHaveCount(0);
      await expect(page.locator('[data-person]').first()).toBeVisible();
    }
  });

  test('search appears only above six people', async ({ page }) => {
    await page.goto('/admin/people');
    const count = await rosterSize(page);
    await expect(page.locator('#people-search')).toHaveCount(count > 6 ? 1 : 0);
  });

  test('filters the cards already on the page, and hides a section it empties', async ({ page }) => {
    await page.goto('/admin/people');
    test.skip((await rosterSize(page)) <= 6, 'needs more than six people for the search box to exist');

    const first = page.locator('[data-person]').first();
    const name = (await first.locator('.pc__name').textContent())!.trim();

    await page.locator('#people-search').fill(name);
    await expect(first).toBeVisible();
    // A section whose every member was filtered out hides its heading too — a
    // heading over an empty grid reads as a rendering bug.
    const visibleSections = page.locator('[data-section]:not([hidden])');
    for (const section of await visibleSections.all()) {
      expect(await section.locator('[data-person]:not([hidden])').count()).toBeGreaterThan(0);
    }

    await page.locator('#people-search').fill('zzzz-nobody-zzzz');
    await expect(page.locator('#people-no-match')).toBeVisible();
  });
});

test.describe('the add sheet', () => {
  test('opens on Add, focuses the name, and closes on Escape', async ({ page }) => {
    await page.goto('/admin/people');
    await page.getByRole('button', { name: /^Add/ }).first().click();

    const sheet = page.locator('#person-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.locator('input[name="displayName"]')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('explains the absent phone and email rather than leaving a gap', async ({ page }) => {
    await page.goto('/admin/people');
    await page.getByRole('button', { name: /^Add/ }).first().click();
    // Product copy stating a deliberate absence stays (10-hq.md §10i); the half
    // that argued WHY ("a second copy only goes stale") was my reasoning and
    // belongs in the plan.
    await expect(page.getByText('No phone or email — those live on your phone.')).toBeVisible();
    await expect(page.locator('input[name="phone"]')).toHaveCount(0);
    await expect(page.locator('input[name="email"]')).toHaveCount(0);
  });

  test('the circle control is single-select and drives the submitted value', async ({ page }) => {
    await page.goto('/admin/people');
    await page.getByRole('button', { name: /^Add/ }).first().click();

    const family = page.locator('[data-circle="family"]');
    const friends = page.locator('[data-circle="friends"]');
    const hidden = page.locator('[data-circle-value]');

    await expect(friends).toHaveAttribute('aria-pressed', 'true');
    await expect(hidden).toHaveValue('friends');

    await family.click();
    await expect(family).toHaveAttribute('aria-pressed', 'true');
    await expect(friends).toHaveAttribute('aria-pressed', 'false');
    await expect(hidden).toHaveValue('family');
  });

  // TRAP 6, asserted on the computed style rather than on a class name: the bug
  // is that `:hover` wins at equal specificity, so the only honest check is
  // whether the selected segment still looks selected with a cursor on it.
  test('the selected segment does not go pale under the cursor', async ({ page }) => {
    await page.goto('/admin/people');
    await page.getByRole('button', { name: /^Add/ }).first().click();

    const family = page.locator('[data-circle="family"]');
    await family.click();
    const selected = await family.evaluate((el) => getComputedStyle(el).backgroundColor);
    await family.hover();
    const hovered = await family.evaluate((el) => getComputedStyle(el).backgroundColor);

    const unselected = await page
      .locator('[data-circle="professional"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(hovered).not.toBe(unselected);
    expect(selected).not.toBe(unselected);
  });

  test('offers only days the chosen month actually has', async ({ page }) => {
    await page.goto('/admin/people');
    await page.getByRole('button', { name: /^Add/ }).first().click();

    const days = page.locator('[data-birth-day] option');
    const enabled = async () =>
      (
        await days.evaluateAll((opts) =>
          opts.filter((o) => !(o as HTMLOptionElement).disabled).map((o) => (o as HTMLOptionElement).value),
        )
      ).filter(Boolean);

    await page.locator('[data-birth-month]').selectOption('4'); // April
    expect(await enabled()).not.toContain('31');
    expect(await enabled()).toContain('30');

    // February keeps 29 — a leap-day birthday is real, and `nextOccurrence`
    // falls it back to 1 March in common years rather than dropping it.
    await page.locator('[data-birth-month]').selectOption('2');
    expect(await enabled()).toContain('29');
    expect(await enabled()).not.toContain('30');
  });

  test('a chosen day is cleared rather than silently kept when the month shrinks', async ({ page }) => {
    await page.goto('/admin/people');
    await page.getByRole('button', { name: /^Add/ }).first().click();

    await page.locator('[data-birth-month]').selectOption('1');
    await page.locator('[data-birth-day]').selectOption('31');
    await page.locator('[data-birth-month]').selectOption('2');
    await expect(page.locator('[data-birth-day]')).toHaveValue('');
  });

  test('sends cadence in MONTHS and the fields it says it sends', async ({ page }) => {
    await page.goto('/admin/people');
    let payload: Record<string, unknown> | null = null;
    await stubActions(page, {
      'people.save': (req) => {
        payload = req.postDataJSON();
        return { id: '00000000-0000-4000-8000-000000000000', slug: 'nobody' };
      },
    });

    await page.getByRole('button', { name: /^Add/ }).first().click();
    await page.locator('input[name="displayName"]').fill('Nobody Real');
    await page.locator('[data-circle="professional"]').click();
    await page.locator('input[name="epithet"]').fill('an invented person');
    await page.locator('input[name="cadenceMonths"]').fill('6');
    await page.locator('button[data-submit]').click();

    await expect.poll(() => payload).not.toBeNull();
    expect(payload).toMatchObject({
      displayName: 'Nobody Real',
      circle: 'professional',
      epithet: 'an invented person',
      cadenceMonths: '6',
    });
    // Nothing about a phone or an email may appear on the wire.
    expect(Object.keys(payload!)).not.toContain('phone');
    expect(Object.keys(payload!)).not.toContain('email');
  });

  test('a failed save says so and gives the button back', async ({ page }) => {
    await page.goto('/admin/people');
    // No handler for `people.save` → aborted, which is what a dead network
    // looks like. `astro:actions` THROWS there rather than returning `{ error }`.
    await stubActions(page, {});

    await page.getByRole('button', { name: /^Add/ }).first().click();
    await page.locator('input[name="displayName"]').fill('Nobody Real');
    const submit = page.locator('button[data-submit]');
    await submit.click();

    await expect(page.locator('#person-error')).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveText('Add');
    // And the sheet stays open, holding what was typed.
    await expect(page.locator('input[name="displayName"]')).toHaveValue('Nobody Real');
  });

  test('a name is required before anything is sent', async ({ page }) => {
    await page.goto('/admin/people');
    const seen = await stubActions(page, { 'people.save': () => ({ id: 'x', slug: 'x' }) });

    await page.getByRole('button', { name: /^Add/ }).first().click();
    await page.locator('button[data-submit]').click();

    // Native `required` stops the submit; nothing reaches the server.
    expect(seen()).toEqual([]);
    await expect(page.locator('#person-sheet')).toBeVisible();
  });
});
