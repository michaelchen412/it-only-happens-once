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
import type { Page } from '@playwright/test';
import { test, expect, stubActions } from './fixtures';

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

/* Holidays (2026-08-21). `hq-holidays.test.ts` already pins the DATES — sixteen
   known Easters, fifty years of invariants — and pins them far harder than a
   browser could. So this file deliberately does not re-check arithmetic. It
   checks the one thing a unit test cannot: that the computed date actually
   REACHES THE PAGE, on the right cell, wearing the read-only shape §5 is about.

   The failure this guards is specific and silent. `holidaysBetween` is called
   with the grid's `from`/`to`, and a grid is 42 days spanning two years at both
   ends of December — so a wiring bug drops holidays off exactly the views most
   likely to be looking for them, while every unit test stays green. */
test.describe('holidays on the grid', () => {
  test('⚠ the computed date lands on the right cell, not merely in the month', async ({ page }) => {
    await calendar(page, '?date=2026-12-01');
    await expect(page.locator('.month__grid .ev[href*="day=2026-12-25"]')).toContainText('Christmas');

    // The nth-weekday rules are where a plausible implementation is a week out,
    // so one of them is checked through the page rather than only in isolation.
    // The third Sunday of June 2026 is the 21st.
    await calendar(page, '?date=2026-06-01');
    await expect(page.locator('.month__grid .ev[href*="day=2026-06-21"]')).toContainText('Father');
  });

  test('⚠ crosses the year the six-week grid actually spans', async ({ page }) => {
    // December 2026's grid runs to 2 January 2027, so New Year's Day is on it —
    // and it comes from a year the page was never asked about.
    await calendar(page, '?date=2026-12-01');
    await expect(page.locator('.month__grid .ev[href*="day=2027-01-01"]')).toContainText('New Year');
  });

  test('is read-only in shape, like a birthday and unlike an event', async ({ page }) => {
    await calendar(page, '?date=2026-12-01');
    const christmas = page.locator('.month__grid .ev--holiday').first();
    await expect(christmas).toHaveClass(/ev--ro/);
    // FILL MEANS WRITABLE, and this is the least writable thing on the grid —
    // it is not even a row. So it has none.
    const fill = await christmas.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(fill);
  });

  test('the day panel offers it no verb, because there is nothing to open', async ({ page }) => {
    await calendar(page, '?date=2026-12-01&day=2026-12-25');
    const row = page.locator('.drow.ev--holiday').first();
    await expect(row).toContainText('Christmas');
    // No link, no button, no tick — the same nothing a birthday gets.
    await expect(row.locator('a, button')).toHaveCount(0);
  });

  test('the legend keys it once it is on the grid', async ({ page }) => {
    await calendar(page, '?date=2026-12-01');
    await expect(page.locator('.legend')).toContainText('Holiday');
  });
});

/* The period control — ‹ September 2026 › ↩ Today (2026-08-21).

   ⚠ EVERY ASSERTION HERE IS A GEOMETRY ONE, because the two defects it was
   built to fix were both invisible to the kind of test this file was already
   full of. The arrows moved on every step and every existing spec still passed,
   since they all matched on `aria-label` and never on position. And the arrows
   carried `class="navb"` — referenced in one file, DEFINED IN NONE — so they
   had no size, no hit area and no hover, which no assertion about a link can
   see. A phantom class renders perfectly and fails nothing. */
test.describe('the period control', () => {
  const arrows = async (page: Page) => ({
    prev: (await page.locator('[aria-label="Previous month"]').boundingBox())!,
    next: (await page.locator('[aria-label="Next month"]').boundingBox())!,
  });

  test('⚠ the arrows do not move when the month name changes length', async ({ page }) => {
    // May is the shortest title this calendar can show and September the
    // longest — if any pair moves, these two do.
    await calendar(page, '?date=2026-05-01');
    const may = await arrows(page);
    await calendar(page, '?date=2026-09-01');
    const sep = await arrows(page);
    await calendar(page, '?date=2027-02-01');
    const feb = await arrows(page);

    expect(sep.prev.x).toBe(may.prev.x);
    expect(sep.next.x).toBe(may.next.x);
    expect(feb.prev.x).toBe(may.prev.x);
    expect(feb.next.x).toBe(may.next.x);
  });

  test('⚠ and they do not move when the way back appears or disappears', async ({ page }) => {
    // On the current month there is nothing to go back to, so the chip is held
    // rather than removed. This is the assertion that catches it being removed.
    await calendar(page);
    const onToday = await arrows(page);
    await calendar(page, '?date=2027-02-01');
    const elsewhere = await arrows(page);
    expect(elsewhere.prev.x).toBe(onToday.prev.x);
    expect(elsewhere.next.x).toBe(onToday.next.x);
  });

  test('the arrows are real targets, not bare glyphs in the text flow', async ({ page }) => {
    await calendar(page);
    const box = (await page.locator('[aria-label="Previous month"]').boundingBox())!;
    // `.navb` gave them zero of both. 1.75rem is what `.datebar__step` sets.
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  });

  test('the held way back is invisible to both eye and screen reader', async ({ page }) => {
    await calendar(page);
    const held = page.locator('.per__back--held');
    await expect(held).toHaveCount(1);
    await expect(held).toBeHidden();
    // A <span>, so there is nothing to tab to and nothing to announce.
    await expect(page.locator('a.per__back')).toHaveCount(0);
  });

  test('⚠ the view toggle centres its label inside its 44px tap target', async ({ page }) => {
    await calendar(page);
    const gaps = await page
      .locator('.pseg--fit .pseg__b')
      .first()
      .evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const t = r.getBoundingClientRect();
        const e = el.getBoundingClientRect();
        return { height: e.height, above: t.top - e.top, below: e.bottom - t.bottom };
      });
    // The 44px floor is the point of the min-height and must survive the fix.
    expect(gaps.height).toBeGreaterThanOrEqual(44);
    // It read 10 above / 18 below before — the dead space Michael reported.
    expect(Math.abs(gaps.above - gaps.below)).toBeLessThanOrEqual(1);
  });

  test('⚠ neither view makes the page scroll sideways on a phone', async ({ page }) => {
    // The ghosts that hold the width are dropped under 40rem precisely because
    // reserving the widest week range pushed a 390px document to 450px.
    await page.setViewportSize({ width: 390, height: 700 });
    for (const q of ['?date=2026-09-01', '?date=2026-09-01&view=week']) {
      await calendar(page, q);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over).toBeLessThanOrEqual(0);
    }
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
