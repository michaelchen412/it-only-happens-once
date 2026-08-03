// Paired with src/pages/admin/calendar-lab.astro — delete it with the piece it
// informs (docs/plans/13-agenda.md, Piece 4).
//
// ⚠ THE TASKS LAB IS GONE ENTIRELY. Its tasks and editor surfaces went with
// 13 · Piece 1 and its goals surfaces with Piece 2, both on 2026-08-03, per the
// rule that a piece deletes its lab and that lab's specs in the same commit.
// The assertions did not vanish, they moved to where the real things live:
// `tests/e2e/tasks.spec.ts`, `tests/e2e/tasks.mobile.spec.ts` and
// `tests/e2e/goals.spec.ts`, with the arithmetic under them in
// `src/tests/hq-tasks.test.ts`, `hq-recurrence.test.ts` and `hq-goals.test.ts`.
//
// What is left drives the one agenda surface still unbuilt: the calendar
// (Piece 4), whose live logic a screenshot cannot check — a four-source grid
// where the whole point is which rows are writable.
//
// A static page, no actions — nothing here can touch the corpus.
import { test, expect } from '@playwright/test';

const CAL = '/admin/calendar-lab';

test.describe('calendar lab', () => {
  test('six week rows always, so the page never jumps between months', async ({ page }) => {
    await page.goto(CAL);
    await expect(page.locator('.cal__grid .cell')).toHaveCount(42);
    await expect(page.locator('.cell--today')).toHaveCount(1);
  });

  test('fill means writable — tasks read as yours, not as a mirror', async ({ page }) => {
    await page.goto(CAL);
    const bg = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const transparent = (c: string) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

    // The first draft gave tasks an outline, putting them in the same visual
    // class as Google's rows — so the loudest distinction on the grid was
    // "event vs everything" rather than "yours vs not yours" (§5).
    expect(transparent(await bg('.ev--event'))).toBe(false);
    expect(transparent(await bg('.ev--task'))).toBe(false);
    expect(transparent(await bg('.ev--mirror'))).toBe(true);
    expect(transparent(await bg('.ev--birthday'))).toBe(true);
  });

  test('a read-only row carries a lock; a writable one does not', async ({ page }) => {
    await page.goto(CAL);
    // Scoped to the grid: the day panel expresses the same fact in words and
    // affordances instead, which is checked separately below.
    const grid = page.locator('.cal__grid');
    expect(await grid.locator('.ev--ro').count()).toBeGreaterThan(5);
    await expect(grid.locator('.ev--mirror:not(.ev--ro)')).toHaveCount(0);
    await expect(grid.locator('.ev--birthday:not(.ev--ro)')).toHaveCount(0);
    await expect(grid.locator('.ev--event.ev--ro')).toHaveCount(0);
    await expect(grid.locator('.ev--task.ev--ro')).toHaveCount(0);
    await expect(grid.locator('.ev--mirror .ev__lock').first()).toBeAttached();
    await expect(grid.locator('.ev--event .ev__lock')).toHaveCount(0);
  });

  test('the day panel is where read-only is explained, and it matches the day', async ({ page }) => {
    await page.goto(CAL);
    await page.locator('.cell', { hasText: 'Offsite plann' }).locator('.ev').first().click();
    const day = page.locator('[data-day]');
    await expect(day).toBeVisible();

    // All four sources on one day — the only place the story is testable.
    await expect(day.getByRole('heading')).toContainText('August 19th');
    await expect(day.locator('.drow')).toHaveCount(5);

    // THE AFFORDANCE IS THE EXPLANATION. A writable row offers the verb, a
    // mirrored one offers only the annotation HQ can make, a derived one offers
    // nothing. No prose anywhere restating any of that.
    await expect(day.locator('.drow.ev--event').getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(day.locator('.drow.ev--task').getByRole('button', { name: 'Did it' })).toBeVisible();
    await expect(day.locator('.drow.ev--mirror').first().getByRole('button', { name: 'Tag someone' })).toBeVisible();
    await expect(day.locator('.drow.ev--birthday').getByRole('button')).toHaveCount(0);

    await expect(day.locator('.day__foot')).toHaveCount(0);
    await expect(day.locator('.drow__n')).toHaveCount(0);
    await expect(day.getByText(/Mirrored from|not yours to change|nothing here to edit/i)).toHaveCount(0);
  });

  test('week is the same union, not a second data model', async ({ page }) => {
    await page.goto(CAL);
    await page.getByRole('button', { name: 'Week' }).click();
    await expect(page.locator('.wkcol')).toHaveCount(7);
    for (const k of ['event', 'task', 'mirror', 'birthday']) {
      await expect(page.locator(`.wev.ev--${k}`).first()).toBeVisible();
    }
    await expect(page.locator('.wev.ev--mirror.ev--ro').first()).toBeVisible();
  });

  test('every element on the grid names its table', async ({ page }) => {
    await page.goto(CAL);
    await page.getByRole('button', { name: 'Show provenance' }).click();
    for (const src of ['events', 'tasks.due_on', 'external_events', 'derived, not a row']) {
      await expect(page.locator(`[data-src*="${src}"]`).first()).toBeVisible();
    }
  });
});
