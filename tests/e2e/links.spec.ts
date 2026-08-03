// The Shared shelf, the link sheet, and "Shared by" (12 · Piece 3).
//
// READ-ONLY BY CONSTRUCTION, like the rest of the harness. These specs run
// against the LIVE project, so nothing here may create a link: every spec that
// drives a write stubs `/_actions/**`, which means what they prove is that the
// CLIENT behaves given a correct response — never that the action sends one.
// That gap is closed by the live action drive recorded in the plans, not here.
// They DISCOVER rather than seed, and skip with a reason when there is nothing
// suitable in the database.
//
// WHAT IS WORTH A SPEC HERE, and why each one is a bug that already happened
// or a rule the interface would otherwise break silently:
//
//  · THE SELECTION NOT SURVIVING A MODE SWITCH. A work id and a fragment id are
//    both uuids, so a stale selection carried across the toggle would link the
//    wrong KIND of thing — accepted by the action, wrong on the shelf, and with
//    nothing anywhere reporting it.
//  · TRAP 6, on a NEW instance. `:hover` beats the selected state at equal
//    specificity, so the row you just picked goes pale under the cursor and
//    reads as disabled. It was found in the tasks lab and it recurs per
//    component, not per codebase.
//  · SAVE NAMING WHAT IT WILL DO. "Link Piranesi" is the only confirmation this
//    action gets — there is no dialog between picking and writing.
//  · A FAILED LINK GIVING THE BUTTON BACK. `astro:actions` THROWS on a dead
//    network rather than returning `{ error }`. The expensive lesson twice
//    over: a stuck "Thinking…" and a swallowed save.
//  · UNLINK BEING GUARDED, and living inside the fold. A <button> inside a
//    <summary> is activated by the same click that toggles the <details>, so
//    an unlink control on the summary row would open or close it every time.
import { test, expect, type Page } from '@playwright/test';
import { stubActions } from './fixtures';

/** Every profile URL on the roster. These specs adapt rather than seed. */
async function profiles(page: Page): Promise<string[]> {
  await page.goto('/admin/people');
  const hrefs = await page.locator('[data-person]').evaluateAll((els) =>
    els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!),
  );
  test.skip(hrefs.length === 0, 'no people in the roster to open');
  return hrefs;
}

/** Open the first profile, or skip. */
async function openProfile(page: Page): Promise<void> {
  await page.goto((await profiles(page))[0]);
  await expect(page.locator('[data-shared]')).toBeVisible();
}

/**
 * Open the first profile that actually has something on its shelf.
 *
 * ⚠ NOT `[data-person]` first. The roster is grouped by circle and then sorted
 * by last contact, so "the first card" is whoever happens to lead the Family
 * section — which made two shelf specs skip silently on a database that DID
 * have links in it. A skip that looks like a pass is the failure mode this
 * harness exists to avoid.
 */
async function openProfileWithLinks(page: Page): Promise<void> {
  for (const href of await profiles(page)) {
    await page.goto(href);
    if ((await page.locator('[data-shared] .shelf__row').count()) > 0) return;
  }
  test.skip(true, 'nothing linked on any profile');
}

const openSheet = async (page: Page) => {
  await page.locator('[data-open-link-sheet]').click();
  await expect(page.locator('#link-sheet')).toBeVisible();
};

test.describe('the Shared zone', () => {
  test.beforeEach(async ({ page }) => await openProfile(page));

  test('sits in the rail with one control, and says the shelf is empty rather than showing a skeleton', async ({ page }) => {
    await expect(page.locator('[data-shared] .zone__title')).toHaveText('Shared');
    await expect(page.locator('[data-open-link-sheet]')).toBeVisible();

    const rows = await page.locator('[data-shared] .shelf__row').count();
    if (rows === 0) {
      await expect(page.getByText('Nothing linked yet.')).toBeVisible();
    } else {
      await expect(page.locator('[data-shared] .shelf__row').first()).toBeVisible();
    }
  });

  test('carries no pronoun in any label it authors', async ({ page }) => {
    // §4, and it is cheap to hold and expensive to retrofit: a pronoun column
    // exists to serve labels that should never have needed one. Michael's own
    // prose is exempt, so strip the parts he wrote before looking.
    const authored = await page.locator('[data-shared]').evaluate((el) => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.shelf__q, .shelf__note').forEach((n) => n.remove());
      return clone.textContent ?? '';
    });
    expect(authored).not.toMatch(/\b(he|him|his|she|her|hers)\b/gi);
  });
});

test.describe('the link sheet', () => {
  test.beforeEach(async ({ page }) => await openProfile(page));

  test('opens on ＋, focuses the search, and closes on Escape', async ({ page }) => {
    await openSheet(page);
    await expect(page.locator('[data-link-search]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#link-sheet')).toBeHidden();
  });

  test('starts on works and switches lists without leaving the other one on screen', async ({ page }) => {
    await openSheet(page);
    await expect(page.locator('[data-mode="work"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-list="work"]')).toBeVisible();
    await expect(page.locator('[data-list="fragment"]')).toBeHidden();

    await page.locator('[data-mode="fragment"]').click();
    await expect(page.locator('[data-list="fragment"]')).toBeVisible();
    await expect(page.locator('[data-list="work"]')).toBeHidden();
  });

  test('a selection does NOT survive a mode switch', async ({ page }) => {
    await openSheet(page);
    const rows = page.locator('[data-list="work"] [data-pick]');
    test.skip((await rows.count()) === 0, 'no works in the corpus to pick');

    await rows.first().click();
    await expect(page.locator('[data-link-save]')).toBeEnabled();

    await page.locator('[data-mode="fragment"]').click();
    // Both ids are uuids, so a carried-over selection would be ACCEPTED by the
    // other action and link the wrong kind of thing.
    await expect(page.locator('[data-link-save]')).toBeDisabled();
    await expect(page.locator('.picker__row.is-on')).toHaveCount(0);
  });

  test('the save button names what it is about to do, and clicking the row again clears it', async ({ page }) => {
    await openSheet(page);
    const rows = page.locator('[data-list="work"] [data-pick]');
    test.skip((await rows.count()) === 0, 'no works in the corpus to pick');

    const save = page.locator('[data-link-save]');
    await expect(save).toHaveText('Link');
    await rows.first().click();
    await expect(save).not.toHaveText('Link');
    await expect(save).toContainText('Link ');

    await rows.first().click();
    await expect(save).toHaveText('Link');
    await expect(save).toBeDisabled();
  });

  // TRAP 6, asserted on the computed style rather than on a class name: the
  // bug is that `:hover` wins at equal specificity, so the only honest check is
  // whether the chosen row still looks chosen with a cursor on it.
  test('the chosen row does not go pale under the cursor', async ({ page }) => {
    await openSheet(page);
    const rows = page.locator('[data-list="work"] [data-pick]');
    test.skip((await rows.count()) < 2, 'needs two works to compare against');

    const chosen = rows.first();
    await chosen.click();
    const picked = await chosen.evaluate((el) => getComputedStyle(el).backgroundColor);
    await chosen.hover();
    const hovered = await chosen.evaluate((el) => getComputedStyle(el).backgroundColor);
    const plain = await rows.nth(1).evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(picked).not.toBe(plain);
    expect(hovered).not.toBe(plain);
  });

  test('filters the rows already on the page and says when nothing matches', async ({ page }) => {
    await openSheet(page);
    const rows = page.locator('[data-list="work"] [data-pick]');
    test.skip((await rows.count()) === 0, 'no works in the corpus to filter');

    await page.locator('[data-link-search]').fill('zzzz-nothing-zzzz');
    await expect(page.locator('[data-list="work"] [data-none]')).toBeVisible();
    await expect(rows.first()).toBeHidden();

    await page.locator('[data-link-search]').fill('');
    await expect(rows.first()).toBeVisible();
    await expect(page.locator('[data-list="work"] [data-none]')).toBeHidden();
  });

  test('offers "add a quote" only in the fragment mode, and points at the fragments room', async ({ page }) => {
    await openSheet(page);
    // A work is created from a quote's own Work field, so offering it beside
    // the work list would point at the wrong door.
    await expect(page.locator('[data-add-quote]')).toBeHidden();

    await page.locator('[data-mode="fragment"]').click();
    await expect(page.locator('[data-add-quote]')).toBeVisible();
    await expect(page.locator('[data-add-quote] a')).toHaveAttribute('href', /\/admin\/fragments\?person=.+&new=quote/);
  });

  test('a failed link says so and gives the button back', async ({ page }) => {
    await openProfile(page);
    // No handler → aborted, which is what a dead network looks like.
    await stubActions(page, {});
    await openSheet(page);
    const rows = page.locator('[data-list="work"] [data-pick]');
    test.skip((await rows.count()) === 0, 'no works in the corpus to pick');

    await rows.first().click();
    const save = page.locator('[data-link-save]');
    await save.click();

    await expect(page.locator('#link-error')).toBeVisible();
    await expect(save).toBeEnabled();
    await expect(save).not.toHaveText('Linking…');
    // And the sheet stays open, holding the choice.
    await expect(page.locator('#link-sheet')).toBeVisible();
    await expect(page.locator('.picker__row.is-on')).toHaveCount(1);
  });
});

test.describe('unlinking', () => {
  test('lives inside the fold, is guarded, and does not toggle the row it sits in', async ({ page }) => {
    await openProfileWithLinks(page);
    const works = page.locator('[data-shared] [data-work]');
    test.skip((await works.count()) === 0, 'no WORK linked on that profile');

    const first = works.first();
    // Closed to start: an unlink control has no business under the cursor
    // while you are only reading the shelf.
    await expect(first).not.toHaveAttribute('open', '');
    await expect(first.locator('[data-unlink]')).toBeHidden();

    await first.locator('summary').click();
    await expect(first).toHaveAttribute('open', '');
    const unlink = first.locator('[data-unlink]');
    await expect(unlink).toBeVisible();

    await stubActions(page, {});
    await unlink.click();
    // Guarded — the attribution is the part you cannot reconstruct.
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.keyboard.press('Escape');
    // Cancelling leaves the row exactly as it was, still open.
    await expect(first).toHaveAttribute('open', '');
  });
});

test.describe('"Shared by", on the fragment editor', () => {
  test('is collapsed, answers the question closed, and queues on a new quote', async ({ page }) => {
    await page.goto('/admin/fragments');
    const field = page.locator('[data-sby="quote"]');
    test.skip((await field.count()) === 0, 'no people in the roster, so the field renders nothing');

    await page.locator('#add-btn').click();
    await page.locator('[data-new="quote"]').click();
    await expect(page.locator('#sheet')).toBeVisible();

    // Closed, because it is empty on almost every fragment — and the summary
    // still carries the answer, so the closed state is not a question.
    await expect(field).not.toHaveAttribute('open', '');
    await expect(field.locator('[data-sby-who]')).toHaveText('nobody');

    await field.locator('summary').click();
    const box = field.locator('.sby-check').first();
    await box.check();

    // A relationship applies immediately — EXCEPT on a fragment with no id yet.
    await expect(field.locator('.sby-status')).toHaveText('Will be linked when you save');
    await expect(field.locator('[data-sby-who]')).not.toHaveText('nobody');
  });

  test('arriving from a profile opens the quote sheet with that person already ticked', async ({ page }) => {
    await page.goto('/admin/people');
    test.skip((await page.locator('[data-person]').count()) === 0, 'no people in the roster');
    const href = (await page.locator('[data-person]').first().getAttribute('href'))!;
    const slug = href.split('/').pop()!;
    const name = (await page.locator('[data-person] .pc__name').first().textContent())!.trim();

    await page.goto(`/admin/fragments?person=${slug}&new=quote`);

    // The whole flow §5 asked for: the quote enters the corpus AND attaches.
    await expect(page.locator('#sheet')).toBeVisible();
    await expect(page.locator('#sheet-title')).toHaveText('New quote');
    await expect(page.locator('[data-sby="quote"] [data-sby-who]')).toHaveText(name);
    await expect(page.locator('[data-sby="quote"]')).toHaveAttribute('open', '');

    // The link brought you here once; it is not a property of the room, so a
    // refresh must not reopen a sheet you deliberately closed.
    await expect(page).toHaveURL(/\/admin\/fragments$/);
  });
});
