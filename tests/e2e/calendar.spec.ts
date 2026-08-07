// The calendar (13 · Piece 4) — in a real browser, at /admin/agenda.
//
// READ-ONLY BY CONSTRUCTION. These run against the LIVE project, so anything
// that presses a control which writes stubs `/_actions/**`. The 35 live checks
// recorded in the plans close that gap — including the drift guard, which is
// the one thing here a browser spec genuinely cannot judge.
//
// ⚠ WHAT THIS FILE IS ACTUALLY FOR: §5's claim that authority can be carried by
// SHAPE rather than by a label. "Rendering must make the read-only ones visibly
// read-only, or he will try to drag one and be confused about why the change
// vanished." That is a claim about computed styles, which is exactly what a
// screenshot review passes and a spec can check.
import { test, expect, type Page } from '@playwright/test';
import { stubActions } from './fixtures';

const calendar = (page: Page, query = '') => page.goto(`/admin/agenda${query}`);
const visibleText = async (page: Page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

test.describe('the month grid', () => {
  test('⚠ is always six rows, so the page never jumps between months', async ({ page }) => {
    await calendar(page);
    await expect(page.locator('.month__grid .cell')).toHaveCount(42);
    // And it is still 42 in a month that starts on a Sunday, and in February.
    await calendar(page, '?date=2027-02-01');
    await expect(page.locator('.month__grid .cell')).toHaveCount(42);
    await calendar(page, '?date=2026-11-01');
    await expect(page.locator('.month__grid .cell')).toHaveCount(42);
  });

  test('marks today exactly once, and only in the month it is in', async ({ page }) => {
    await calendar(page);
    await expect(page.locator('.cell--today')).toHaveCount(1);
    await calendar(page, '?date=2027-05-04');
    await expect(page.locator('.cell--today')).toHaveCount(0);
    // Being on another month must never be ambiguous. Matched by its full
    // accessible name: a bare /Today/ also catches the sidebar's own Today.
    await expect(page.getByRole('link', { name: '↩ Today' })).toBeVisible();
  });

  test('steps months without JavaScript — every control is a real link', async ({ page }) => {
    await calendar(page, '?date=2026-08-01');
    await expect(page.getByRole('heading', { name: 'August 2026' })).toBeVisible();
    await page.getByRole('link', { name: 'Next month' }).click();
    await expect(page.getByRole('heading', { name: 'September 2026' })).toBeVisible();
    await page.getByRole('link', { name: 'Previous month' }).click();
    await expect(page.getByRole('heading', { name: 'August 2026' })).toBeVisible();
  });

  test('⚠ FILL MEANS WRITABLE — and it is the loudest distinction on the grid', async ({ page }) => {
    await calendar(page);
    const items = page.locator('.month__grid .ev');
    test.skip((await items.count()) === 0, 'nothing on the calendar this month');

    const fill = async (sel: string) => {
      const el = page.locator(sel).first();
      if ((await el.count()) === 0) return null;
      return el.evaluate((e) => getComputedStyle(e).backgroundColor);
    };
    const transparent = (c: string | null) => c === null || c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

    // The first draft gave tasks an outline ring, which put them in the same
    // visual class as the Google rows — so the grid's loudest distinction
    // became "event vs everything else" rather than "yours vs not yours".
    const event = await fill('.ev--event');
    const task = await fill('.ev--task');
    if (event) expect(transparent(event)).toBe(false);
    if (task) expect(transparent(task)).toBe(false);
    expect(transparent(await fill('.ev--mirror'))).toBe(true);
    expect(transparent(await fill('.ev--birthday'))).toBe(true);
  });

  test('a read-only row carries a lock; a writable one does not', async ({ page }) => {
    await calendar(page);
    const ro = page.locator('.month__grid .ev--ro');
    test.skip((await ro.count()) === 0, 'nothing read-only on the grid — no mirror yet, and no birthdays');
    await expect(ro.first().locator('.ev__lock')).toBeAttached();
    await expect(page.locator('.month__grid .ev--event .ev__lock')).toHaveCount(0);
    await expect(page.locator('.month__grid .ev--task .ev__lock')).toHaveCount(0);
  });

  test('⚠ the legend never keys a source with nothing in it', async ({ page }) => {
    await calendar(page);
    const text = await visibleText(page);
    // Until the Google mirror lands there is nothing mirrored, so nothing says
    // there is (10-hq.md §10b).
    expect(text).not.toContain('Mirrored');
    // And a one-source month gets no key at all: a legend over one thing is
    // the repeated label §5 cut, wearing a different hat.
    const kinds = await page
      .locator('.month__grid .ev')
      .evaluateAll(
        (els) =>
          [...new Set(els.map((e) => [...e.classList].find((c) => c.startsWith('ev--') && c !== 'ev--ro')))].length,
      );
    if (kinds <= 1) await expect(page.locator('.legend')).toHaveCount(0);
  });
});

test.describe('the day panel', () => {
  const openADay = async (page: Page) => {
    await calendar(page);
    const item = page.locator('.month__grid .ev').first();
    if ((await item.count()) === 0) return false;
    await item.click();
    await expect(page.locator('[data-day]')).toBeVisible();
    return true;
  };

  test('is server-rendered from ?day=, so it survives a reload and a back button', async ({ page }) => {
    test.skip(!(await openADay(page)), 'nothing on the calendar to open');
    await expect(page).toHaveURL(/day=\d{4}-\d{2}-\d{2}/);
    await page.reload();
    await expect(page.locator('[data-day]')).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-day]')).toHaveCount(0);
  });

  test('⚠ THE AFFORDANCE IS THE EXPLANATION — and there is no prose anywhere', async ({ page }) => {
    test.skip(!(await openADay(page)), 'nothing on the calendar to open');
    const panel = page.locator('[data-day]');

    // A writable row offers the verb; a derived one offers nothing at all,
    // because there is no row to open.
    for (const row of await panel.locator('.drow').all()) {
      const kind = await row.getAttribute('data-kind');
      if (kind === 'event') await expect(row.locator('[data-edit-event]')).toBeVisible();
      if (kind === 'birthday') await expect(row.getByRole('button')).toHaveCount(0);
    }

    // §10i: no footer, no per-row note, no summary line — all three were
    // drafted and cut, and the summary earned its removal twice.
    await expect(panel.locator('.day__foot')).toHaveCount(0);
    const text = await visibleText(page);
    expect(text).not.toMatch(/read-only|not yours to change|mirrored from|cannot be edited here/i);
  });

  test('a task in the panel ticks off in place, and says so if it fails', async ({ page }) => {
    test.skip(!(await openADay(page)), 'nothing on the calendar to open');
    const row = page.locator('[data-day] .drow[data-kind="task"]').first();
    test.skip((await row.count()) === 0, 'no task on this day');
    await stubActions(page, {});
    await row.locator('[data-dispose]').click();
    await expect(page.locator('[data-task-error]')).toBeVisible();
    await expect(row).not.toHaveClass(/task--done/);
  });
});

test.describe('the event sheet', () => {
  const openSheet = async (page: Page) => {
    await calendar(page);
    await page.getByRole('button', { name: 'New event' }).click();
    await expect(page.locator('#event-sheet')).toBeVisible();
  };

  test('⚠ "all day" is the absence of a time, not a checkbox beside one', async ({ page }) => {
    await openSheet(page);
    // A boolean would be a second thing that can disagree with the times.
    await expect(page.locator('#event-form input[type="checkbox"][name*="allDay" i]')).toHaveCount(0);
    await expect(page.locator('[data-all-day]')).toBeVisible();

    await page.locator('[data-starts-at]').fill('19:00');
    await page.locator('[data-starts-at]').dispatchEvent('input');
    await expect(page.locator('[data-all-day]')).toBeHidden();
  });

  test('an end time does not exist until there is a beginning', async ({ page }) => {
    await openSheet(page);
    await expect(page.locator('[data-ends-at]')).toBeDisabled();
    await page.locator('[data-starts-at]').fill('19:00');
    await page.locator('[data-starts-at]').dispatchEvent('input');
    await expect(page.locator('[data-ends-at]')).toBeEnabled();
  });

  test('opens on the day you are looking at, not on today', async ({ page }) => {
    await calendar(page, '?date=2027-03-15');
    await page.getByRole('button', { name: 'New event' }).click();
    // Pressing New while reading March means an event in March.
    await expect(page.locator('[data-starts-on]')).toHaveValue(/^2027-03/);
  });

  test('the guest list is collapsed, and its summary reads before you open it', async ({ page }) => {
    await openSheet(page);
    const who = page.locator('[data-event-people]');
    test.skip((await who.count()) === 0, 'no roster to tag anybody from');
    await expect(who).not.toHaveAttribute('open', '');
    await expect(page.locator('[data-who]')).toHaveText('nobody');

    await who.locator('summary').click();
    await who.locator('.ep-check').first().check();
    // The name rides on the input, not the row — a row's textContent also
    // carries the monogram, which is how the fragment editor once rendered
    // "MMarisol Quint".
    const name = await who.locator('.ep-check').first().getAttribute('data-name');
    await expect(page.locator('[data-who]')).toHaveText(name!);
  });

  test('a failed save says so and gives the button back', async ({ page }) => {
    await openSheet(page);
    await stubActions(page, {});
    await page.locator('#event-form input[name="title"]').fill('Not going anywhere');
    // ⚠ SCOPED TO THE FORM. `/admin/agenda` mounts EventSheet AND TagSheet, and
    // both carry a `[data-submit]`, so the bare selector is a strict-mode
    // violation rather than a click — it resolved to "Add event" and TagSheet's
    // "Save" together. Every other spec that presses one of these already
    // scopes it (`#goal-form`, `#task-sheet`); this one was the exception.
    await page.locator('#event-form [data-submit]').click();
    await expect(page.locator('#event-sheet-error')).toBeVisible();
    await expect(page.locator('#event-form [data-submit]')).toBeEnabled();
    await expect(page.locator('#event-sheet')).toBeVisible();
  });
});

test.describe('the Agenda room', () => {
  test('gathers its three surfaces, and the sidebar names the room', async ({ page }) => {
    await calendar(page);
    // §9 named the room Agenda before there was an agenda to put in it.
    await expect(page.locator('nav[aria-label="Agenda"] a')).toHaveCount(3);
    await expect(page.locator('.atabs__t[aria-current="page"]')).toHaveText(/Calendar/);

    await page.getByRole('link', { name: 'Tasks', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/agenda\/tasks$/);
    await expect(page.locator('.atabs__t[aria-current="page"]')).toHaveText(/Tasks/);

    await page.getByRole('link', { name: 'Goals', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/agenda\/goals$/);
  });

  test('the routes that moved still resolve', async ({ page }) => {
    // They existed for half a day, which is long enough for a bookmark.
    await page.goto('/admin/tasks');
    await expect(page).toHaveURL(/\/admin\/agenda\/tasks$/);
  });

  test('week is the same union, not a second data model', async ({ page }) => {
    await calendar(page, '?view=week');
    await expect(page.locator('.wkcol')).toHaveCount(7);
    await expect(page.locator('.month__grid')).toHaveCount(0);
  });
});
