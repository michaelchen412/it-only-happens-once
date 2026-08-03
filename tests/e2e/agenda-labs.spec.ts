// Paired with src/pages/admin/tasks-lab.astro and calendar-lab.astro — delete
// each with the piece it informs (docs/plans/13-agenda.md, Pieces 2 and 4).
//
// ⚠ THE TASKS HALF OF THIS FILE IS GONE, with the lab surfaces it drove:
// 13 · Piece 1 shipped on 2026-08-03, and the rule is that a piece deletes its
// lab's specs in the same commit. The assertions did not vanish, they moved to
// where the real thing lives — `tests/e2e/tasks.spec.ts` and
// `tests/e2e/tasks.mobile.spec.ts` for the list, the editor, the lead sentence,
// the recurrence preview and trap 6; `src/tests/hq-tasks.test.ts` and
// `hq-recurrence.test.ts` for the arithmetic under them.
//
// What is left drives the two surfaces still unbuilt: GOALS (Piece 2) and the
// calendar (Piece 4). Both carry live logic a screenshot cannot check — a
// four-source grid whose whole point is which rows are writable, and a goals
// room whose whole point is what it refuses to display.
//
// Static pages, no actions — nothing here can touch the corpus.
import { test, expect } from '@playwright/test';

const TASKS = '/admin/tasks-lab';
const CAL = '/admin/calendar-lab';

test.describe('goals lab', () => {
  test('goals are intentions: capped, observed, and never scored', async ({ page }) => {
    await page.goto(TASKS);
    await page.getByRole('button', { name: 'Goals', exact: true }).click();
    // Scoped to the surface: the lab's own explanatory copy talks ABOUT
    // percentages, and an unscoped search matches the argument for not having
    // one as though it were one.
    const goals = page.locator('[data-surface="goals"]');

    await expect(goals.getByText('3 of 5 active')).toBeVisible();
    // No progress bar, no percent, no "n of m" completion anywhere.
    await expect(goals.locator('progress, [role="progressbar"]')).toHaveCount(0);
    await expect(goals.getByText(/\d+%/)).toHaveCount(0);
    // And no paragraph arguing for their absence, either.
    await expect(goals.getByText(/cap|deleted|cascade/i)).toHaveCount(0);

    // A cold goal is an observation, not a verdict — quieter, never red.
    const cold = goals.locator('.gcard__o--cold');
    await expect(cold).toHaveText('nothing in 6 weeks');
    const colour = await cold.evaluate((el) => getComputedStyle(el).color);
    expect(colour).not.toMatch(/rgb\(2[0-9]{2}, [0-9]{1,2}, [0-9]{1,2}\)/);

    // Letting go is a status beside the others, not a delete.
    await expect(goals.getByText('Let go · March')).toBeVisible();
  });

  test('the goal page separates scheduled from unscheduled, and says why', async ({ page }) => {
    await page.goto(TASKS);
    await page.getByRole('button', { name: 'One goal' }).click();
    const goal = page.locator('[data-surface="goal"]');

    await expect(goal.getByRole('heading', { name: 'Finish the Sky' })).toBeVisible();
    await expect(goal.locator('.ghead__o')).toHaveText('4 tasks done in the last 30 days');
    await expect(goal.locator('progress, [role="progressbar"]')).toHaveCount(0);
    await expect(goal.getByText(/never appear on Today|No bar and no percentage/)).toHaveCount(0);
    // The status set includes letting go, with dignity, beside the others.
    for (const s of ['Active', 'Paused', 'Achieved', 'Let go']) {
      await expect(goal.getByRole('button', { name: s, exact: true })).toBeVisible();
    }
  });
});

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
