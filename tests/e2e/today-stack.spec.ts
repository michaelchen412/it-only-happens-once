// Today, assembled (13 · Piece 5) — in a real browser, at `/admin`.
//
// READ-ONLY BY CONSTRUCTION, like the rest of the harness: this navigates and
// reads the DOM. The 55 live checks recorded in the plans cover what a browser
// spec cannot reach here — the brief's four sources, the lead deciding what is
// in Coming up, and the arrears cap — because all three need rows, and seeding
// them would mean writing to the live project.
//
// ⚠ WHAT THIS FILE IS ACTUALLY FOR is the set of claims that must hold on ANY
// morning, including one with nothing in it. Those are the ones that decay
// silently, because a page with no data looks fine while being wrong:
//
//  · a domain with nothing to say renders NOTHING — never an empty box
//  · nothing anywhere counts what you owe
//  · the stack order survives a phone, which is a computed-style question
//  · only the check-in follows the date bar
import { test, expect, type Page } from '@playwright/test';

const ZONES = [
  { attr: '[data-agenda-zone]', title: 'Today' },
  { attr: '[data-coming-up]', title: 'Coming up' },
  { attr: '[data-people-zone]', title: 'People' },
  { attr: '[data-practice]', title: 'Practice' },
  { attr: '[data-past-due]', title: 'Past due' },
];

/** Text a human would see — daisyUI inlines a stylesheet, and it contains words. */
const visibleText = async (page: Page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

test.describe('what the page claims', () => {
  test('⚠ a zone with nothing to say is ABSENT, never an empty box', async ({ page }) => {
    await page.goto('/admin');
    // 10-hq.md §10b: on a quiet morning a grid of "no data" cards reads as a
    // broken app *and* as a list of things you have already failed to do. So a
    // zone is either present WITH rows, or not there at all — there is no third
    // state, and this is the assertion that keeps it that way.
    for (const zone of ZONES) {
      const section = page.locator(zone.attr);
      if ((await section.count()) === 0) {
        await expect(page.getByRole('heading', { name: zone.title, exact: true })).toHaveCount(0);
      } else {
        await expect(section.getByRole('heading', { name: zone.title, exact: true })).toBeVisible();
        expect(await section.locator('.row, .sig, .brf, .bw__row').count()).toBeGreaterThan(0);
      }
    }
  });

  test('⚠ the sentence that stood here while the agenda did not exist is gone', async ({ page }) => {
    await page.goto('/admin');
    expect(await visibleText(page)).not.toMatch(/isn’t built yet|isn't built yet/);
  });

  test('⚠ NOTHING COUNTS WHAT YOU OWE — no badge, no total, no streak', async ({ page }) => {
    await page.goto('/admin');

    // ⚠ THE CHECK-IN IS EXCLUDED, AND IT IS THE ONE HONEST EXCEPTION. It prints
    // a sleep efficiency — `93%` — and the first version of this assertion went
    // red on it, which is the assertion working: a percentage on this page is a
    // verdict unless it is a MEASUREMENT of something you yourself gave. Sleep
    // efficiency is derived from two times you typed in, and is the number that
    // actually moves under CBT-I (§11). Every other zone is about what you have
    // and have not done, and none of them may carry one.
    const text = await page.evaluate(() => {
      const root = document.querySelector('.hq-cq')!.cloneNode(true) as HTMLElement;
      root.querySelector('[data-checkin]')?.remove();
      return (root.innerText || root.textContent || '').replace(/\s+/g, ' ');
    });

    // 10-hq.md §3. "6 overdue" is a verdict about a person; the only number
    // allowed on this page is `N of M done`, which counts what you DID.
    expect(text).not.toMatch(/\d+\s*(overdue|past due|behind|missed)/i);
    expect(text).not.toMatch(/\bstreak\b/i);
    expect(text).not.toMatch(/\d+%/);
    // And the one count there is never starts at zero — it appears when earned.
    expect(text).not.toMatch(/\b0 of \d+ done\b/);
  });

  test('past due is BELOW both columns and is not a disclosure', async ({ page }) => {
    await page.goto('/admin');
    const past = page.locator('[data-past-due]');
    test.skip((await past.count()) === 0, 'nothing is past due');

    // §10f: it is not an accordion. Hiding arrears at the bottom means never
    // resolving them, and a click in front of a one-tap disposition defeats the
    // point of the one-tap disposition.
    await expect(past.locator('details')).toHaveCount(0);
    const rail = await page.locator('.col-rail').boundingBox();
    const box = await past.boundingBox();
    expect(box!.y).toBeGreaterThan(rail!.y);
    // Being last is what does the work the collapse was doing.
    await expect(page.locator('.hq-grid [data-past-due]')).toHaveCount(0);
  });
});

test.describe('Practice — the one zone you cannot act on', () => {
  test('⚠ a signal has no verb', async ({ page }) => {
    await page.goto('/admin');
    const practice = page.locator('[data-practice]');
    test.skip((await practice.count()) === 0, 'nothing published and no goal to observe');

    // §6 builds the writing nudge as a signal precisely so it can never become
    // an overdue item. A button in here would be the first step back.
    await expect(practice.locator('button')).toHaveCount(0);
    await expect(practice.locator('input, select, textarea')).toHaveCount(0);
    await expect(practice.locator('.tick')).toHaveCount(0);
  });

  test('the writing line reads as a duration, and goes quieter rather than redder', async ({ page }) => {
    await page.goto('/admin');
    const line = page.locator('[data-signal="published"]');
    test.skip((await line.count()) === 0, 'nothing published yet');

    // A past date is a duration everywhere in HQ (§10d) — never "July 2023",
    // which is the register the corpus uses and not this one.
    await expect(line).toContainText(/(today|yesterday|\d+ (days|weeks|months|years) ago|over a year ago)/);

    // ⚠ AND COLD MUST NOT BE WARM. The real corpus has not had a new essay
    // since 2023, so this line ships cold on day one — the moment it renders in
    // the error or warning colour it is a debt rather than an observation.
    const cold = await line.evaluate((el) => el.classList.contains('sig--cold'));
    if (cold) {
      const value = page.locator('[data-signal="published"] .sig__v');
      const [colour, error, warning] = await value.evaluate((el) => {
        const root = getComputedStyle(document.documentElement);
        return [
          getComputedStyle(el).color,
          root.getPropertyValue('--color-error').trim(),
          root.getPropertyValue('--color-warning').trim(),
        ];
      });
      expect(colour).not.toBe(error);
      expect(colour).not.toBe(warning);
    }
  });
});

test.describe('only the check-in follows the date bar', () => {
  test('⚠ another date is another question — every "now" zone goes', async ({ page }) => {
    await page.goto('/admin');
    const yesterday = await page.getByLabel('Previous day').getAttribute('href');
    await page.goto(yesterday!);

    // "Past due", "Been a while" and "Last published" are statements about NOW.
    // Rendering them on a Tuesday last March would be the page asserting
    // something untrue, and offering their dismissals there would write a row
    // dated today from a page that is not about today (§10f).
    for (const zone of ZONES) await expect(page.locator(zone.attr)).toHaveCount(0);

    // …and the check-in is still there, because backfilling one is what the
    // date bar exists for.
    await expect(page.getByRole('heading', { name: 'Morning' })).toBeVisible();
  });
});

test.describe('the stack', () => {
  test('⚠ the rail is BESIDE the main column, not under it', async ({ page }) => {
    await page.goto('/admin');
    const rail = page.locator('.col-rail > *').first();
    test.skip((await rail.count()) === 0, 'nothing in the rail this morning');

    // TRAP 2: a container cannot query itself, so `container-type` sits on the
    // wrapper and not on `.hq-grid`. If that ever gets "tidied" onto the grid
    // the query stops matching and the two columns silently become one stack —
    // which typechecks, builds, and looks like a design choice in a screenshot.
    const main = await page.locator('.col-main > *').first().boundingBox();
    const side = await rail.boundingBox();
    expect(side!.x).toBeGreaterThan(main!.x);
  });

  test('Today still ships no editor, now that it has four more zones', async ({ page }) => {
    await page.goto('/admin');
    // The reason this page took the root: it is opened on a phone every
    // morning, and TipTap is the largest thing the admin can load. Piece 5 adds
    // rows that look editable in the rooms — the assertion is that none of the
    // sheets came with them.
    await expect(page.locator('#wsheet, #fsheet, #task-sheet, #event-sheet, #goal-sheet')).toHaveCount(0);
    const scripts = await page
      .locator('script[src]')
      .evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).src));
    expect(scripts.filter((s) => /tiptap|prosemirror/i.test(s))).toHaveLength(0);
  });
});
