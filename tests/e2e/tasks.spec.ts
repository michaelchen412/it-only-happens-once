// Tasks (13 · Piece 1) — the room and the editor, in a real browser.
//
// READ-ONLY BY CONSTRUCTION. These run against the LIVE project, so every spec
// that presses a control which writes stubs `/_actions/**`: what they prove is
// that the CLIENT behaves given a correct response, never that the action sends
// one. That gap is closed by the live drive recorded in the plans — 45 checks
// through the real endpoints, every row deleted after.
//
// ⚠ MOST OF WHAT MATTERS HERE NEEDS NO ROWS AT ALL, which is the happy accident
// of this piece: the two mechanics that decided it — effort→lead and the
// recurrence preview — live in the editor and compute from what is on the form.
// So they are driven properly below. The list specs DISCOVER rather than seed,
// and skip with a reason while the table is empty; they start doing real work
// the day there are real tasks.
import { test, expect, type Page } from '@playwright/test';
import { stubActions } from './fixtures';

const openEditor = async (page: Page) => {
  await page.goto('/admin/agenda/tasks');
  // `.first()`, not a role query: the empty room carries BOTH "New" and "Add
  // the first", and a strict-mode match would pass only while there are tasks.
  await page.locator('[data-open-task-sheet]').first().click();
  await expect(page.locator('#task-sheet')).toBeVisible();
};

/** The sheet's two live sections only exist once there is a date to hang them on. */
const withDate = async (page: Page, ymd: string) => {
  await page.locator('[data-due]').fill(ymd);
  await page.locator('[data-due]').dispatchEvent('input');
};

test.describe('the editor — where the two invisible rules become checkable', () => {
  test('⚠ effort sets the lead, high bumps ONE bucket, low never shortens it', async ({ page }) => {
    await openEditor(page);
    await withDate(page, '2026-12-01');
    const line = page.locator('[data-lead-line]');

    // quick 1 · sitting 3 · block 7 · project 21 (§3a).
    for (const [effort, days] of [
      ['quick', 1],
      ['sitting', 3],
      ['block', 7],
    ] as const) {
      await page.locator(`[data-effort="${effort}"]`).click();
      await expect(line).toContainText(`${days} day${days === 1 ? '' : 's'} ahead`);
    }

    await page.locator('[data-effort="sitting"]').click();
    await page.locator('[data-prio="low"]').click();
    // Hiding a warning is not a kindness.
    await expect(line).toContainText('3 days ahead');

    await page.locator('[data-prio="high"]').click();
    // sitting(3) → block(7), not to some new number.
    await expect(line).toContainText('7 days ahead');

    await page.locator('[data-override-on]').check();
    await page.locator('[data-override-n]').fill('2');
    await expect(line).toContainText('2 days ahead');
  });

  test('⚠ the lead names a real DATE, and says so when it reaches back past today', async ({ page }) => {
    await openEditor(page);
    // A date 7 days out with a project's 21-day lead: the lead started two
    // weeks ago, and naming a date that has gone by reads as a bug. This is the
    // COMMON case for a project, not an edge one.
    const soon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    await withDate(page, soon);
    await page.locator('[data-effort="project"]').click();
    await expect(page.locator('[data-lead-line]')).toContainText('Already on Today');

    await page.locator('[data-effort="quick"]').click();
    // A weekday and an ordinal — a date you can judge, not "1 day".
    await expect(page.locator('[data-lead-line]')).toContainText(/[A-Z][a-z]{2}, [A-Z][a-z]{2} \d+(st|nd|rd|th)/);

    // ONE line. The second line naming which rule fired taught the mechanic
    // instead of stating the result (10-hq.md §10i).
    await expect(page.locator('[data-lead-why]')).toHaveCount(0);
  });

  test('⚠ a schedule shows the dates it produces; after-completion admits it cannot', async ({ page }) => {
    await openEditor(page);
    await withDate(page, '2026-12-07'); // a Monday
    await page.locator('[data-rep="fixed"]').click();

    // You cannot verify a rule by reading it, so the next three occurrences are
    // the check — and for "every Monday" every one of them is a Monday.
    await page.locator('[data-preset]').selectOption('weekly');
    await expect(page.locator('[data-prev]')).toHaveText('Next: Mon, Dec 14th  ·  Mon, Dec 21st  ·  Mon, Dec 28th');

    // Fortnightly keeps its phase rather than landing on "some Monday".
    await page.locator('[data-preset]').selectOption('biweekly');
    await expect(page.locator('[data-prev]')).toHaveText('Next: Mon, Dec 21st  ·  Mon, Jan 4th  ·  Mon, Jan 18th');

    // The honest asymmetry: this mode has no schedule, so it previews nothing
    // rather than inventing three dates.
    await page.locator('[data-rep="after"]').click();
    await expect(page.locator('.prev--none')).toHaveText('Counted from the day you tick it.');
    await expect(page.locator('[data-prev]')).toBeHidden();
  });

  test('⚠ the schedule names the actual day, and follows the date when it moves', async ({ page }) => {
    await openEditor(page);
    await withDate(page, '2026-12-07'); // Monday
    await page.locator('[data-rep="fixed"]').click();
    await expect(page.locator('[data-preset] option[value="weekly"]')).toHaveText('Every Monday');
    await expect(page.locator('[data-preset] option[value="monthly-nth"]')).toHaveText('Monthly, on the 1st Monday');

    // A stale label is a rule you would pick wrongly: "every Monday" is only
    // true while the date is a Monday.
    await withDate(page, '2026-12-10'); // Thursday
    await expect(page.locator('[data-preset] option[value="weekly"]')).toHaveText('Every Thursday');
    await expect(page.locator('[data-preset] option[value="monthly-date"]')).toHaveText('Monthly, on the 10th');
  });

  test('⚠ no RRULE string appears anywhere — that is storage, not interface', async ({ page }) => {
    await openEditor(page);
    await withDate(page, '2026-12-07');
    await page.locator('[data-rep="fixed"]').click();
    await page.locator('[data-preset]').selectOption('monthly-nth');
    await expect(page.locator('[data-prev]')).toContainText('Next:');
    // Column names and rule mechanics are not interface (10-hq.md §10i), and
    // this one cannot be read by a human anyway.
    //
    // ⚠ SCOPED TO <body> SINCE 2026-08-07, and the reason must be read before
    // anyone widens it back to `page.content()`. That form also searched <head>
    // — where `astro dev` inlines stylesheets UNMINIFIED — and `hq.css:2281`
    // carries the literal `FREQ=MONTHLY;BYDAY=3MO` inside a comment, as the
    // example of the very unreadability this test defends. It passed for months
    // only because hq.css reached the page through `app.css`, whose Lightning
    // CSS pass strips comments; when 24 · Piece 9 moved hq.css onto
    // `AdminLayout` so readers stop downloading it, the comment started
    // arriving intact IN DEV ONLY.
    //
    // Checked before narrowing rather than assumed: the production build emits
    // **zero** occurrences of `FREQ=` and zero comments of any kind, so nothing
    // reaches a real browser. And a string inside a stylesheet was never what
    // this test meant — its own sentence says *interface*, and <head> is not it.
    const body = await page.locator('body').innerHTML();
    expect(body).not.toContain('FREQ=');
  });

  test('a lead and a recurrence are functions of a date, so neither exists without one', async ({ page }) => {
    await openEditor(page);
    // No date: no lead box, no repeat control. Not a disabled control beside a
    // sentence explaining why it is disabled.
    await expect(page.locator('.lead')).toBeHidden();
    await expect(page.locator('[data-rep="fixed"]')).toBeHidden();
    await expect(page.locator('[data-anytime]')).toBeHidden();

    await withDate(page, '2026-12-07');
    await expect(page.locator('.lead')).toBeVisible();
    await expect(page.locator('[data-rep="fixed"]')).toBeVisible();
    // `anytime` beside the empty time field — one word, in place (§10i).
    await expect(page.locator('[data-anytime]')).toBeVisible();
    await page.locator('[data-time]').fill('16:30');
    await page.locator('[data-time]').dispatchEvent('input');
    await expect(page.locator('[data-anytime]')).toBeHidden();
  });

  test('⚠ TRAP 6: the segment you just clicked stays selected under the cursor', async ({ page }) => {
    // `:hover` and the selected state have equal specificity, so source order
    // decides — and the control you were using went pale, which reads as
    // disabled. It has now bitten three labs.
    await openEditor(page);
    const block = page.locator('[data-effort="block"]');
    await block.click();
    await block.hover();
    const [on, off] = await block.evaluate((el) => [
      getComputedStyle(el).backgroundColor,
      getComputedStyle(document.querySelector('[data-effort="quick"]')!).backgroundColor,
    ]);
    expect(on).not.toBe(off);
  });

  test('a failed save gives the button back instead of sticking on "Saving…"', async ({ page }) => {
    // No handler → aborted, which is what a dead network looks like. The
    // swallowed-save shape has been paid for twice in this repo.
    await openEditor(page);
    await stubActions(page, {});
    await page.locator('input[name="title"]').fill('Not going anywhere');
    await page.locator('[data-submit]').click();

    await expect(page.locator('#task-error')).toBeVisible();
    await expect(page.locator('[data-submit]')).toBeEnabled();
    await expect(page.locator('[data-submit]')).toHaveText('Add task');
    await expect(page.locator('#task-sheet')).toBeVisible();
  });
});

test.describe('the room', () => {
  test('renders the groups in triage order — arrears FIRST here', async ({ page }) => {
    await page.goto('/admin/agenda/tasks');
    const groups = await page
      .locator('[data-group]')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.group));
    test.skip(groups.length === 0, 'no tasks yet');
    // Both rooms order by time; arrears are chronologically first, and this is
    // the room where triage happens (10-hq.md §10f).
    expect(groups).toEqual(['past', 'today', 'week', 'later', 'none'].filter((k) => groups.includes(k)));
  });

  test('⚠ never counts what is owed, anywhere on the page', async ({ page }) => {
    await page.goto('/admin/agenda/tasks');
    // The counts beside the headings say how big a list is. "6 overdue" would
    // be a verdict about a person, and 10-hq.md §3 is a design constraint with
    // stakes: this page can be opened at 7am on a bad morning.
    await expect(page.getByText(/\d+\s+overdue/i)).toHaveCount(0);
    await expect(page.getByText(/you missed|days in a row|streak/i)).toHaveCount(0);
    await expect(page.locator('progress, [role="progressbar"]')).toHaveCount(0);
  });

  test('the empty room is one line and one button, not an onboarding checklist', async ({ page }) => {
    await page.goto('/admin/agenda/tasks');
    test.skip((await page.locator('[data-task]').count()) > 0, 'the room has tasks in it');
    await expect(page.getByText('Nothing to do.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add the first' })).toBeVisible();
    await expect(page.getByText(/get started|welcome|tip:/i)).toHaveCount(0);
  });

  test('a past-due row offers the CHOICE, and no tick', async ({ page }) => {
    await page.goto('/admin/agenda/tasks');
    const late = page.locator('[data-group="past"] [data-task]').first();
    test.skip((await late.count()) === 0, 'nothing is past due');
    // A circle beside a "Did it" chip is two paths to one outcome while saying
    // nothing about the other one.
    await expect(late.locator('.tick')).toHaveCount(0);
    await expect(late.locator('[data-dispose="done"]')).toBeVisible();
    await expect(late.locator('[data-dispose="skipped"]')).toBeVisible();
    // Icons, not two same-shaped text chips: this control has to be answerable
    // at a glance.
    await expect(late.locator('[data-dispose="done"] svg')).toBeVisible();
    await expect(late.locator('[data-dispose="skipped"] svg')).toBeVisible();
  });

  test('⚠ a tick STAYS, struck through, and the same click undoes it', async ({ page }) => {
    await page.goto('/admin/agenda/tasks');
    const row = page.locator('[data-group="today"] [data-task], [data-group="week"] [data-task]').first();
    test.skip((await row.count()) === 0, 'nothing scheduled to tick');
    await stubActions(page, {
      'tasks.dispose': () => ({ id: 'x', eventId: 'e', nextDueOn: null, archived: true }),
      'tasks.undo': () => ({ id: 'x', dueOn: '2026-08-03' }),
    });

    await row.locator('.tick').click();
    await expect(row).toHaveClass(/task--done/);
    // A task that vanishes gives no sense of progress and no way back from a
    // mis-tap.
    await expect(row).toBeVisible();

    await row.locator('.tick').click();
    await expect(row).not.toHaveClass(/task--done/);
  });

  test('a failed disposition says so and leaves the row alone', async ({ page }) => {
    await page.goto('/admin/agenda/tasks');
    const row = page.locator('[data-group="today"] [data-task], [data-group="week"] [data-task]').first();
    test.skip((await row.count()) === 0, 'nothing scheduled to tick');
    await stubActions(page, {});

    await row.locator('.tick').click();
    await expect(page.locator('[data-task-error]')).toBeVisible();
    // A failure must not look like a success.
    await expect(row).not.toHaveClass(/task--done/);
    await expect(row.locator('.tick')).toBeEnabled();
  });

  test('effort reads as a magnitude, in one hue at four densities', async ({ page }) => {
    await page.goto('/admin/agenda/tasks');
    const pills = page.locator('.eff');
    test.skip((await pills.count()) === 0, 'no tasks yet');

    // The meter is filled TO THE STEP: effort is ordinal, and four identical
    // chips threw the ordering away.
    for (const [key, step] of [
      ['quick', 1],
      ['sitting', 2],
      ['block', 3],
      ['project', 4],
    ] as const) {
      const pill = page.locator(`.eff--${key}`).first();
      if ((await pill.count()) === 0) continue;
      await expect(pill.locator('.eff__m i.on')).toHaveCount(step);
    }
  });
});
