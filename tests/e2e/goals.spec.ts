// Goals (13 · Piece 2) — the room and one goal's page, in a real browser.
//
// READ-ONLY BY CONSTRUCTION. These run against the LIVE project, so anything
// that presses a control which writes stubs `/_actions/**`: what they prove is
// that the CLIENT behaves given a correct response, never that the action sends
// one. The 39 live checks recorded in the plans close that gap.
//
// ⚠ MOST OF WHAT THESE GUARD IS AN ABSENCE, and an absence is exactly what a
// screenshot review misses. §4a's whole argument is that a goal is a direction,
// so the assertions below are largely about what must NOT be on the page — a
// bar, a percentage, an "n of m", a red cold line, a paragraph explaining why
// none of those are there.
import type { Page } from '@playwright/test';
import { test, expect, stubActions } from './fixtures';

const room = async (page: Page) => {
  await page.goto('/admin/agenda/goals');
};

/** The visible words only — a percentage in daisyUI's CSS is not a score. */
const visibleText = async (page: Page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

test.describe('the goals room', () => {
  test('is one of the Agenda room’s three surfaces', async ({ page }) => {
    // Goals are visited monthly, so they were never going to earn a sidebar
    // entry — they are a tab in the room that holds the tasks they gather
    // (10-hq.md §9).
    await page.goto('/admin/agenda/tasks');
    await page.getByRole('link', { name: 'Goals', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/agenda\/goals$/);
    await expect(page.getByRole('heading', { name: 'Goals' })).toBeVisible();
  });

  test('⚠ scores nothing: no bar, no percentage, no "n of m done"', async ({ page }) => {
    await room(page);
    await expect(page.locator('progress, [role="progressbar"]')).toHaveCount(0);
    expect(await visibleText(page)).not.toMatch(/\d+%/);
    expect(await visibleText(page)).not.toMatch(/\d+ of \d+ (done|complete|finished)/i);
  });

  test('⚠ and carries no paragraph explaining the absence of one', async ({ page }) => {
    // 10-hq.md §10i: if a sentence exists to justify a design decision it
    // belongs in the plan, not on the screen. An absence needs no note.
    await room(page);
    const text = await visibleText(page);
    expect(text).not.toMatch(/progress bar|percent complete|not a project|deliberately/i);
  });

  test('shows the cap as a fact you can see, not an error you hit', async ({ page }) => {
    await room(page);
    await expect(page.getByText(/\d of 5 active/)).toBeVisible();
  });

  test('the empty room names the first goal rather than onboarding you', async ({ page }) => {
    await room(page);
    test.skip(
      (await page.locator('.gcard').count()) > 0 || (await page.locator('.row').count()) > 0,
      'the room has goals in it',
    );
    await expect(page.getByText('Nothing you’re working toward yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Name the first' })).toBeVisible();
    await expect(page.getByText(/get started|welcome|tip:/i)).toHaveCount(0);
  });

  test('⚠ a cold goal reads QUIETER, never redder', async ({ page }) => {
    await room(page);
    const cold = page.locator('.gcard__o--cold');
    test.skip((await cold.count()) === 0, 'nothing has gone cold');
    // The moment it turns amber it becomes a debt, which is the one thing §4a
    // will not let a goal be.
    const [colour, style] = await cold
      .first()
      .evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).fontStyle]);
    expect(style).toBe('italic');
    expect(colour).not.toMatch(/rgb\(2[0-9]{2}, [0-9]{1,2}, [0-9]{1,2}\)/);
  });
});

test.describe('the goal sheet', () => {
  const openSheet = async (page: Page) => {
    await room(page);
    await page.locator('[data-open-goal-sheet]').first().click();
    await expect(page.locator('#goal-sheet')).toBeVisible();
  };

  test('⚠ the horizon cannot express a date, because it is not a text field', async ({ page }) => {
    await openSheet(page);
    // §4a: the moment a goal has a deadline it is a task. Three buttons cannot
    // say "March 3rd"; a text input could.
    await expect(page.locator('[data-horizon]')).toHaveCount(3);
    await expect(page.locator('#goal-form input[type="date"]')).toHaveCount(0);
    // ⚠ `radio`, NOT `button` (plan 38 · §6.3). The horizon is an exclusive
    // choice and announced as three unrelated toggles until 2026-08-12; it is a
    // radio group now, so the role a spec asks for is part of what changed. That
    // this locator had to move is the assertion in miniature — a screen reader
    // was being told the same wrong thing.
    for (const label of ['this season', 'this year', 'the next few years']) {
      await expect(page.getByRole('radio', { name: label, exact: true })).toBeVisible();
    }
  });

  test('asks for a name and nothing else — a goal that needs a form is a project', async ({ page }) => {
    await openSheet(page);
    await expect(page.locator('#goal-form input[name="name"]')).toHaveAttribute('required', '');
    // Five controls in total: name, horizon, why, notes, and (when editing)
    // status. Notes joined on 2026-08-10 — "the why is only half of it" — and
    // the count is asserted rather than left open precisely so a sixth has to
    // argue for itself here first.
    //
    // ⚠ THE SELECTOR MOVED WITH THE FIELDS; THE GUARD DID NOT MOVE AT ALL. Why
    // and Notes became mini editors in plan 43, so two of the three are
    // `[contenteditable]` surfaces now. The hidden inputs that seed them are
    // `type="hidden"` and so fall outside `input[type="text"]` — which is what
    // keeps this a count of CONTROLS rather than of elements, and keeps a sixth
    // field having to argue for itself right here.
    await expect(
      page.locator('#goal-form input[type="text"], #goal-form textarea, #goal-form [contenteditable]'),
    ).toHaveCount(3);
  });

  test('⚠ notes are prose, and nothing in the sheet can hold a tick or a date', async ({ page }) => {
    // The field that most looks like a way around the table's founding rule.
    // Prose cannot be counted, and these two assertions are what stops the
    // routine you describe in it from quietly becoming a subtask list.
    //
    // ⚠ A MINI EDITOR SINCE PLAN 43, NOT A TEXTAREA, AND THE RULE IS UNTOUCHED.
    // That editor is the bold/italic one: `mountMiniEditor` turns OFF headings,
    // bullet lists, ordered lists, blockquote, code blocks and rules, and there
    // is no task-list extension anywhere in the build. So `- [ ]` still comes
    // back a plain bullet, exactly as the component header promises — the field
    // changed instrument, not what it is allowed to become.
    await openSheet(page);
    await expect(page.locator('#goal-notes [contenteditable]')).toBeVisible();
    await expect(page.locator('#goal-form input[type="checkbox"], #goal-form input[type="date"]')).toHaveCount(0);
  });

  test('⚠ TRAP 6: the horizon you just picked stays picked under the cursor', async ({ page }) => {
    await openSheet(page);
    const season = page.locator('[data-horizon="this_season"]');
    await season.click();
    await season.hover();
    const [on, off] = await season.evaluate((el) => [
      getComputedStyle(el).backgroundColor,
      getComputedStyle(document.querySelector('[data-horizon="next_few_years"]')!).backgroundColor,
    ]);
    expect(on).not.toBe(off);
  });

  test('a failed save says so and gives the button back', async ({ page }) => {
    await openSheet(page);
    await stubActions(page, {});
    await page.locator('#goal-form input[name="name"]').fill('Not going anywhere');
    await page.locator('#goal-form [data-submit]').click();

    await expect(page.locator('#goal-sheet-error')).toBeVisible();
    await expect(page.locator('#goal-form [data-submit]')).toBeEnabled();
    await expect(page.locator('#goal-sheet')).toBeVisible();
  });
});

test.describe('one goal', () => {
  const open = async (page: Page) => {
    await room(page);
    const card = page.locator('.gcard').first();
    if ((await card.count()) === 0) return false;
    await card.click();
    await expect(page.locator('.ghead')).toBeVisible();
    /*
      ⚠ WAIT FOR THE SCRIPT, NOT FOR THE MARKUP — and this cost four specs
      (2026-08-25). `.ghead` is server-rendered: it is visible in the first
      paint, and it says nothing whatever about whether `goal-sheet.ts` has
      executed. So the clicks below were landing on controls with no listener
      behind them yet, and three assertions failed on a page that was perfectly
      correct. Driving the same click by hand after a settle showed the control
      moving, staying moved, and no error — the product was never the problem.

      `wireRadioGroups()` is the LAST line of `goal-sheet.ts`, after the status
      and pin handlers are attached, and it stamps a roving tabindex on every
      option. So the attribute is not a proxy for readiness — it is proof that
      the code above it has run.
    */
    await expect(page.locator('[data-goal] [data-status]').first()).toHaveAttribute('tabindex', /^-?\d+$/);
    return true;
  };

  test('offers all four statuses side by side, with letting go among them', async ({ page }) => {
    test.skip(!(await open(page)), 'no goals to open');
    // Not hidden behind a menu, and not a delete: abandoning a goal should be a
    // dignified act you take.
    for (const s of ['Active', 'Paused', 'Achieved', 'Let go']) {
      // ⚠ `radio`, NOT `button`. These are `<button role="radio">` inside a
      // `role="radiogroup"` (plan 38 · §6.3 made the group announce itself as
      // one), and an explicit role REPLACES the implicit one — so a query for
      // a button matched nothing and had been failing on every run since. The
      // role in the query has to be the role in the markup.
      await expect(page.locator('[data-goal]').getByRole('radio', { name: s, exact: true })).toBeVisible();
    }
  });

  test('⚠ the four statuses fit their own labels — no "Achie…" for a status', async ({ page }) => {
    test.skip(!(await open(page)), 'no goals to open');
    // The header case `pseg--fit` exists for, caught here rather than by eye the
    // second time. Equal-width segments size to whatever is left in the row, so
    // adding the pin took 28px and "Achieved" stopped fitting. `aria-pressed` is
    // just as true of a truncated label, which is why the assertion is a width.
    const achieved = page.locator('[data-goal] [data-status="achieved"]');
    const { scrollWidth, clientWidth } = await achieved.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('pins to the Morning card in one tap, and the label names where', async ({ page }) => {
    test.skip(!(await open(page)), 'no goals to open');
    await stubActions(page, { 'goals.setPinned': () => ({ id: 'x', pinned: true }) });

    const pin = page.locator('[data-goal] [data-pin]');
    const was = (await pin.getAttribute('aria-pressed')) === 'true';
    await pin.click();
    // Moves first, like the status control beside it, and no confirm: pinning
    // destroys nothing and the same button undoes it.
    await expect(pin).toHaveAttribute('aria-pressed', String(!was));
    await expect(page.locator('#confirm-dialog[open]')).toHaveCount(0);
    // "Pin" alone would not say pinned WHERE, which is the only thing about
    // this control worth knowing.
    await expect(pin).toHaveAttribute('aria-label', /Morning card/);
  });

  test('⚠ a status change is one tap, with no confirm in front of it', async ({ page }) => {
    test.skip(!(await open(page)), 'no goals to open');
    await stubActions(page, { 'goals.setStatus': () => ({ id: 'x', status: 'paused' }) });

    const paused = page.locator('[data-goal] [data-status="paused"]');
    await paused.click();
    // It answers instantly — a segmented control that waits for a round trip
    // before moving reads as broken.
    await expect(paused).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#confirm-dialog[open]')).toHaveCount(0);
  });

  test('a refused status change puts the control BACK and says why', async ({ page }) => {
    test.skip(!(await open(page)), 'no goals to open');
    await stubActions(page, {});
    const before = await page
      .locator('[data-goal] [data-status]')
      .evaluateAll((els) => els.find((e) => e.getAttribute('aria-checked') === 'true')?.getAttribute('data-status'));

    await page.locator('[data-goal] [data-status="achieved"]').click();
    await expect(page.locator('[data-goal-error]')).toBeVisible();
    // The cap arrives as a sentence; the control must not be left claiming a
    // state the database refused.
    await expect(page.locator(`[data-goal] [data-status="${before}"]`)).toHaveAttribute('aria-checked', 'true');
  });

  test('separates scheduled from not-scheduled-yet, and offers a date on the second', async ({ page }) => {
    test.skip(!(await open(page)), 'no goals to open');
    // `exact`, because a role-name match is a substring one and "Not scheduled
    // yet" contains "scheduled".
    await expect(page.getByRole('heading', { name: 'Scheduled', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Not scheduled yet' })).toBeVisible();
    const unscheduled = page.locator('.zone', { has: page.getByRole('heading', { name: 'Not scheduled yet' }) });
    if ((await unscheduled.locator('[data-task]').count()) > 0) {
      // The affordance says what the section is for, so no sentence has to.
      await expect(unscheduled.getByRole('button', { name: 'Give it a date' }).first()).toBeVisible();
    }
    // And no prose arguing that an undated task is not a graveyard item.
    expect(await visibleText(page)).not.toMatch(/graveyard|not scheduled yet means|these will not appear/i);
  });

  test('⚠ "Done toward this" is a list of what happened, never a count with a bar', async ({ page }) => {
    test.skip(!(await open(page)), 'no goals to open');
    const done = page.locator('.zone', { has: page.getByRole('heading', { name: 'Done toward this' }) });
    await expect(done).toBeVisible();
    await expect(done.locator('progress, [role="progressbar"]')).toHaveCount(0);
    if ((await done.locator('.row').count()) > 0) {
      // Each row is a thing you did, with a date — not a tally.
      await expect(done.locator('.row').first().locator('.stamp')).toBeVisible();
    }
  });
});
