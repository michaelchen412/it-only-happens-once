// Drift — the notice, the marker, and Today's People zone (12 · Piece 4).
//
// READ-ONLY BY CONSTRUCTION. These run against the LIVE project, so every spec
// that presses a dismissal stubs `/_actions/**`: what they prove is that the
// CLIENT behaves given a correct response, never that the action sends one.
// That gap is closed by the live drive recorded in the plans. They DISCOVER
// rather than seed, and skip with a reason when there is nothing to look at.
//
// ⚠ WHAT THESE MOSTLY GUARD IS A TONE, not a function, and tone is exactly what
// a typecheck cannot see. 10-hq.md §3 is a design constraint with stakes:
//
//   "A surface that greets him with forty-seven overdue items at 7am on a
//    morning he already cannot function is actively harmful."
//
// So the assertions below are as much about what must NOT be on the page — a
// badge, a count, a red, a fourth row — as about what must.
import { test, expect, type Page } from '@playwright/test';
import { stubActions } from './fixtures';

const panel = (page: Page) => page.locator('[data-been-a-while]');

async function roster(page: Page): Promise<void> {
  await page.goto('/admin/people');
  test.skip((await page.locator('[data-person]').count()) === 0, 'no people in the roster');
}

test.describe('the "Been a while" notice', () => {
  test.beforeEach(async ({ page }) => await roster(page));

  test('is a warm panel, not a card, and never announces a count', async ({ page }) => {
    test.skip((await panel(page).count()) === 0, 'nobody is drifting');

    // §3: not card-shaped, so it can never read as a second section of the
    // directory. The distinguishing mark is the left rule.
    const left = await panel(page).evaluate((el) => getComputedStyle(el).borderLeftWidth);
    expect(parseFloat(left)).toBeGreaterThan(2);
    await expect(panel(page)).not.toHaveClass(/\bpc\b|\bpgrid\b/);

    // No badge, no count, no "overdue", no red anywhere on the page.
    await expect(page.getByText('overdue', { exact: false })).toHaveCount(0);
    await expect(page.locator('.u-now')).toHaveCount(0);
    await expect(panel(page).locator('.chip')).toHaveCount(0);
  });

  test('reads as a duration and keeps the exact date one tap away', async ({ page }) => {
    test.skip((await panel(page).count()) === 0, 'nobody is drifting');
    const stamp = panel(page).locator('.stamp').first();
    // "over a year ago" answers the question; "7/20 Sat" does not, and carries
    // no year — which is how the lab's two-year-old contact read as last month.
    await expect(stamp).toHaveText(/ago$/);
    await expect(stamp).toHaveAttribute('title', /\d{4}/);
  });

  test('carries both dismissals ON the row', async ({ page }) => {
    test.skip((await panel(page).count()) === 0, 'nobody is drifting');
    const row = panel(page).locator('[data-drift]').first();
    // A notice you cannot clear from where you are reading it is a notice you
    // learn to scroll past.
    await expect(row.locator('[data-reached-out]')).toBeVisible();
    await expect(row.locator('[data-mute]')).toBeVisible();
  });

  test('a dismissal disables BOTH buttons while it is in flight', async ({ page }) => {
    test.skip((await panel(page).count()) === 0, 'nobody is drifting');
    // A deferred, so the in-flight state is observable rather than raced.
    // (TypeScript narrows a `let x: T | null = null` assigned only inside a
    // closure back to `never` at the call site — hence the object.)
    const held: { release?: () => void } = {};
    await stubActions(page, {
      'drift.mute': () => ({ until: '2027-08-03', mutes: 1 }),
      'drift.reachedOut': () => ({ id: 'x', occurredOn: '2026-08-03' }),
    });
    await page.route('**/_actions/drift.reachedOut/**', async (route) => {
      await new Promise<void>((r) => (held.release = r));
      await route.abort('failed');
    });

    const row = panel(page).locator('[data-drift]').first();
    await row.locator('[data-reached-out]').click();
    // They are OPPOSITE answers to one question: leaving the other live means a
    // double-tap can log contact AND mute the same person.
    await expect(row.locator('[data-mute]')).toBeDisabled();
    await expect(row.locator('[data-reached-out]')).toBeDisabled();
    held.release?.();
  });

  test('a failed dismissal says so and gives both buttons back', async ({ page }) => {
    test.skip((await panel(page).count()) === 0, 'nobody is drifting');
    // No handler → aborted, which is what a dead network looks like.
    await stubActions(page, {});
    const row = panel(page).locator('[data-drift]').first();
    await row.locator('[data-mute]').click();

    await expect(panel(page).locator('[data-drift-error]')).toBeVisible();
    await expect(row.locator('[data-mute]')).toBeEnabled();
    await expect(row.locator('[data-reached-out]')).toBeEnabled();
    // And the row stays — a failure must not look like a success.
    await expect(row).toBeVisible();
  });

  test('a dismissal removes the row, and the panel with the last one', async ({ page }) => {
    test.skip((await panel(page).count()) === 0, 'nobody is drifting');
    await stubActions(page, { 'drift.mute': () => ({ until: '2027-08-03', mutes: 1 }) });

    const before = await panel(page).locator('[data-drift]').count();
    await panel(page).locator('[data-drift]').first().locator('[data-mute]').click();

    if (before === 1) {
      // An empty warm box is furniture.
      await expect(panel(page)).toHaveCount(0);
    } else {
      await expect(panel(page).locator('[data-drift]')).toHaveCount(before - 1);
    }
  });

  test('goes while a search is running, rather than sitting there unfiltered', async ({ page }) => {
    test.skip((await panel(page).count()) === 0, 'nobody is drifting');
    test.skip((await page.locator('#people-search').count()) === 0, 'needs more than six people for the search box');
    await page.locator('#people-search').fill('zzzz');
    // Left up, it would look like the answer to the name you just typed.
    await expect(panel(page)).toBeHidden();
    await page.locator('#people-search').fill('');
    await expect(panel(page)).toBeVisible();
  });
});

test.describe('the quiet card marker', () => {
  test('shifts weight on the last-contact line and changes nothing else', async ({ page }) => {
    await roster(page);
    const marked = page.locator('[data-person] .pc__meta.is-drifting');
    test.skip((await marked.count()) === 0, 'nobody on the roster is drifting');

    const plain = page.locator('[data-person] .pc__meta:not(.is-drifting)');
    test.skip((await plain.count()) === 0, 'everybody is drifting — nothing to compare against');

    const [a, b] = await Promise.all([
      marked.first().evaluate((el) => getComputedStyle(el).fontWeight),
      plain.first().evaluate((el) => getComputedStyle(el).fontWeight),
    ]);
    expect(Number(a)).toBeGreaterThan(Number(b));

    // NOTHING ELSE. The card must not grow a badge, and the person is already
    // named once in the panel above — the marker exists so scanning a section
    // still tells you, not so drift is announced twice.
    const card = page.locator('[data-person]').filter({ has: page.locator('.is-drifting') }).first();
    await expect(card.locator('.chip')).toHaveCount(0);
    await expect(card.getByText('overdue', { exact: false })).toHaveCount(0);
  });
});

test.describe('People, on Today', () => {
  test('renders only when it has something to say', async ({ page }) => {
    await page.goto('/admin');
    const zone = page.locator('[data-people-zone]');
    if ((await zone.count()) === 0) {
      // A domain with nothing to say renders QUIET — never an empty skeleton
      // and never a "no data" box (10-hq.md §10b).
      await expect(page.getByText('No birthdays')).toHaveCount(0);
      await expect(page.getByText('Nobody is drifting')).toHaveCount(0);
    } else {
      await expect(zone.locator('.zone__title')).toHaveText('People');
    }
  });

  test('caps drift at three and offers a door instead of a fourth row', async ({ page }) => {
    await page.goto('/admin');
    test.skip((await panel(page).count()) === 0, 'nobody is drifting');
    // §8: "the roster is where the full list lives; Today is a nudge, not an
    // inbox." Three is small enough that it can never become a wall.
    expect(await panel(page).locator('[data-drift]').count()).toBeLessThanOrEqual(3);

    const more = page.locator('[data-people-zone] a[href="/admin/people"]');
    if ((await more.count()) > 0) await expect(more).toContainText(/more in People/);
  });

  test('⚠ disappears entirely on any other date', async ({ page }) => {
    await page.goto('/admin?date=2026-03-01');
    // Drift is a statement about NOW, the same way Past due is (§10f).
    // Rendering it on a day last March would be the page asserting something
    // untrue — and its dismissals would write an entry dated today from a page
    // that is not about today.
    await expect(page.locator('[data-people-zone]')).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
  });
});
