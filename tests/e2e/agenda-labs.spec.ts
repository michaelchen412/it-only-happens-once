// Paired with src/pages/admin/tasks-lab.astro and calendar-lab.astro — delete
// each with the piece it informs (docs/plans/13-agenda.md, Pieces 1/2 and 4).
//
// These two labs carry more live logic than the others: a lead date computed
// from two enums, a recurrence preview, and a four-source grid where the whole
// point is which rows are writable. Arithmetic and authority are exactly what a
// screenshot cannot check, so that is what is asserted here.
//
// Static pages, no actions — nothing here can touch the corpus.
import { test, expect } from '@playwright/test';

const TASKS = '/admin/tasks-lab';
const CAL = '/admin/calendar-lab';

test.describe('tasks lab', () => {
  test('the list orders by time, and arrears come first here', async ({ page }) => {
    await page.goto(TASKS);

    // Past due is FIRST in this room and LAST on Today. Both order by time;
    // arrears are chronologically first, and this room is where triage happens.
    const groups = await page.locator('[data-group]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.group));
    expect(groups).toEqual(['past', 'today', 'week', 'later', 'none']);

    // A past-due row offers the CHOICE, not a circle. A tick beside "Did it"
    // is two paths to one outcome and says nothing about the other.
    const late = page.locator('[data-group="past"] .task').first();
    await expect(late.locator('.tick')).toHaveCount(0);
    await expect(late.getByRole('button', { name: 'Did it' })).toBeVisible();
    await expect(late.getByRole('button', { name: 'Skipping it' })).toBeVisible();

    // Days are pluralised. "1 days late" is the kind of thing that ships.
    await expect(page.locator('.task__late', { hasText: /^1 day late$/ })).toBeVisible();
    await expect(page.getByText(/\b1 days\b/)).toHaveCount(0);
  });

  test('disposition carries icons, and effort reads as a magnitude', async ({ page }) => {
    await page.goto(TASKS);
    const late = page.locator('[data-group="past"] .task').first();
    await expect(late.getByRole('button', { name: 'Did it' }).locator('svg')).toBeVisible();
    await expect(late.getByRole('button', { name: 'Skipping it' }).locator('svg')).toBeVisible();

    // Effort is ORDINAL, so it is drawn as a magnitude: four rising bars, filled
    // to the step, plus the word. Four identical grey pills threw the ordering
    // away and made the field unscannable (Michael 2026-08-01).
    for (const [key, step] of [['quick', 1], ['sitting', 2], ['block', 3], ['project', 4]] as const) {
      const pill = page.locator(`.eff--${key}`).first();
      await expect(pill.locator('.eff__m i.on')).toHaveCount(step);
    }

    // And the ramp is ONE hue at four densities, not four colours — so no new
    // colour meaning enters the system (10-hq.md §10a). Distinct, and ordered.
    const alphas = await page.evaluate(() =>
      ['quick', 'sitting', 'block', 'project'].map((k) => {
        const el = document.querySelector(`.eff--${k}`)!;
        const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)!.map(Number);
        return { rgb: m.slice(0, 3).join(','), a: m[3] ?? 1 };
      }),
    );
    expect(new Set(alphas.map((x) => x.rgb)).size).toBe(1); // one hue
    for (let i = 1; i < alphas.length; i++) expect(alphas[i].a).toBeGreaterThan(alphas[i - 1].a);
  });

  test('"anytime" appears only where a missing time changes anything', async ({ page }) => {
    await page.goto(TASKS);

    // In Today the list is time-ordered, so a missing time moves the row.
    await expect(page.locator('[data-group="today"] .task__any')).toHaveCount(1);
    // Elsewhere the date already carries it, and printing it on most rows is noise.
    await expect(page.locator('[data-group="week"] .task__any')).toHaveCount(0);
    await expect(page.locator('[data-group="later"] .task__any')).toHaveCount(0);
  });

  test('a task ticks off in place, stays visible, and undoes', async ({ page }) => {
    await page.goto(TASKS);
    const row = page.locator('.task', { hasText: 'Draft the Sky essay' }).first();

    await row.locator('[data-tick]').click();
    await expect(row).toHaveClass(/task--done/);
    await expect(row).toBeVisible();
    await row.locator('[data-tick]').click();
    await expect(row).not.toHaveClass(/task--done/);
  });

  test('effort sets the lead, priority bumps it one bucket and never shortens it', async ({ page }) => {
    await page.goto(TASKS);
    await page.getByRole('button', { name: 'New task' }).click();
    const line = page.locator('[data-lead-line]');

    // quick=1 · sitting=3 · block=7 · project=21 (13-agenda.md §3a)
    for (const [effort, days] of [['quick', 1], ['sitting', 3], ['block', 7], ['project', 21]] as const) {
      await page.locator(`[data-effort="${effort}"]`).click();
      await expect(line).toContainText(`${days} day${days === 1 ? '' : 's'} ahead`);
    }

    // Low never reduces the lead — hiding a warning is not a kindness.
    await page.locator('[data-effort="sitting"]').click();
    await page.locator('[data-prio="low"]').click();
    await expect(line).toContainText('3 days ahead');

    // High bumps ONE bucket: sitting(3) → block(7), not to some new number.
    await page.locator('[data-prio="high"]').click();
    await expect(line).toContainText('7 days ahead');

    // And the override wins over both.
    await page.locator('[data-override-on]').check();
    await page.locator('[data-override-n]').fill('2');
    await expect(line).toContainText('2 days ahead');

    // ONE line. The paragraph explaining which rule fired was teaching, not
    // interface (Michael 2026-08-01: "too much backend logic shoehorned in").
    await expect(page.locator('[data-lead-why]')).toHaveCount(0);
  });

  test('a lead reaching past today says so instead of naming a date that has gone', async ({ page }) => {
    await page.goto(TASKS);
    await page.getByRole('button', { name: 'New task' }).click();
    // The sheet opens on a date 6 days out; a project's 21-day lead started
    // two weeks ago. Naming that date would read as a bug.
    await page.locator('[data-effort="project"]').click();
    await expect(page.locator('[data-lead-line]')).toContainText('Already on Today');
  });

  test('a schedule shows the dates it produces; after-completion admits it cannot', async ({ page }) => {
    await page.goto(TASKS);
    await page.getByRole('button', { name: 'New task' }).click();

    await page.locator('[data-rep="fixed"]').click();
    // You cannot verify FREQ=MONTHLY;BYDAY=3MO by reading it, so the next three
    // occurrences are the check — and they must be three real, ascending dates.
    await page.locator('[data-rrule]').selectOption('monthly-nth');
    // The RRULE string is storage, not interface: it rides the provenance toggle.
    await expect(page.locator('[data-rrule-str]')).toBeHidden();
    const prev = (await page.locator('[data-prev]').textContent())!;
    const dates = prev.replace('Next: ', '').split('·').map((s) => Date.parse(`${s.trim()} 2026`.replace(/(\d+)(st|nd|rd|th)/, '$1')));
    expect(dates).toHaveLength(3);
    for (const d of dates) expect(Number.isNaN(d)).toBe(false);
    // Every one is a Monday, and they ascend.
    for (const d of dates) expect(new Date(d).getDay()).toBe(1);
    expect(dates[1]).toBeGreaterThan(dates[0]);
    expect(dates[2]).toBeGreaterThan(dates[1]);

    // The honest asymmetry: this mode has no schedule, so it previews nothing
    // rather than inventing dates.
    await page.locator('[data-rep="after"]').click();
    await expect(page.locator('.prev--none')).toHaveText('Counted from the day you tick it.');
  });

  test('a selected segment stays selected under the cursor', async ({ page }) => {
    // `.seg__b:hover` and `.seg__b--on` have equal specificity, so source order
    // decided it — and the button you just clicked went pale, which reads as
    // disabled. Caught in a screenshot only because the mouse happened to rest.
    await page.goto(TASKS);
    await page.getByRole('button', { name: 'New task' }).click();
    const block = page.locator('[data-effort="block"]');
    await block.click();
    await block.hover();
    const [bg, plain] = await block.evaluate((el) => {
      const s = getComputedStyle(el);
      const off = getComputedStyle(document.querySelector('[data-effort="quick"]')!);
      return [s.backgroundColor, off.backgroundColor];
    });
    expect(bg).not.toBe(plain);
  });

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
