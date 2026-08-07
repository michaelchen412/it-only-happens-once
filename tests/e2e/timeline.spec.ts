// The log box and the timeline (12 · Piece 2).
//
// READ-ONLY BY CONSTRUCTION, like the rest of the harness. Every spec that
// drives a save stubs `/_actions/**`, so what these prove is that the CLIENT
// behaves given a correct response — never that the action sends one. That gap
// is closed by the live action drive recorded in the plans, not here.
//
// They also DISCOVER rather than seed: if the roster is empty they skip, and
// say so, rather than creating rows in a live database.
//
// ⚠ THE REGRESSION THESE MOSTLY GUARD is trap 7. The pickers were first written
// as absolutely positioned divs opening upward, and every row landed under the
// sticky header — unclickable, while still reporting `toBeVisible`. Opening
// downward would have been clipped by `.zone { overflow: hidden }` instead.
// Anything here that clicks a picker row is that guard.
import { test, expect, type Page } from '@playwright/test';
import { stubActions } from './fixtures';

/** The first person on the roster, or null when nobody is there yet. */
async function firstPerson(page: Page): Promise<string | null> {
  await page.goto('/admin/people');
  const card = page.locator('[data-person]').first();
  if ((await page.locator('[data-person]').count()) === 0) return null;
  return card.getAttribute('href');
}

async function openProfile(page: Page): Promise<boolean> {
  const href = await firstPerson(page);
  test.skip(!href, 'no people in the roster to open');
  await page.goto(href!);
  await expect(page.locator('[data-timeline]')).toBeVisible();
  return true;
}

const type = async (page: Page, text: string) => {
  const box = page.locator('[data-log-input]');
  await box.fill(text);
  await box.dispatchEvent('input');
};

test.describe('the log box', () => {
  test.beforeEach(async ({ page }) => await openProfile(page));

  test('is open at the head of the timeline, never behind a dialog', async ({ page }) => {
    // §6: "a dialog you must open first is a dialog you don't open at fifteen
    // seconds' notice." Typing IS the action.
    await expect(page.locator('[data-log-input]')).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });

  test('starts one line tall and grows with the words', async ({ page }) => {
    const box = page.locator('[data-log-input]');
    const one = (await box.boundingBox())!.height;
    expect(one).toBeLessThan(60);
    await type(page, 'One.\nTwo.\nThree.\nFour.');
    expect((await box.boundingBox())!.height).toBeGreaterThan(one);
  });

  test('keeps its controls out until there are words', async ({ page }) => {
    await expect(page.locator('[data-log-meta]')).toBeHidden();
    await expect(page.locator('[data-log-save]')).toBeHidden();
    await type(page, 'Coffee.');
    await expect(page.locator('[data-log-meta]')).toBeVisible();
    await expect(page.locator('[data-log-save]')).toBeVisible();
  });

  test('whitespace alone is not something typed', async ({ page }) => {
    await type(page, '    ');
    await expect(page.locator('[data-log-save]')).toBeHidden();
  });

  test('defaults to a hangout, today, with nobody else', async ({ page }) => {
    await type(page, 'x');
    await expect(page.locator('[data-kind-label]')).toHaveText('Hangout');
    await expect(page.locator('[data-date-label]')).toHaveText('Today');
  });

  // TRAP 7's guard: a picker row that cannot be clicked is the whole bug.
  test('a picker opens in the top layer and its rows can actually be clicked', async ({ page }) => {
    await type(page, 'x');
    await page.locator('[data-kind-open]').click();
    await expect(page.locator('[data-pop="kind"]')).toBeVisible();
    await page.locator('[data-kind="gift"]').click();
    await expect(page.locator('[data-kind-label]')).toHaveText('Gift');
    await expect(page.locator('[data-pop="kind"]')).toBeHidden();
  });

  test('the glyph follows the label, and a second choice still works', async ({ page }) => {
    await type(page, 'x');
    await page.locator('[data-kind-open]').click();
    await page.locator('[data-kind="call"]').click();
    await expect(page.locator('[data-kind-icon] svg')).toHaveCount(1);
    await page.locator('[data-kind-open]').click();
    await page.locator('[data-kind="note"]').click();
    await expect(page.locator('[data-kind-label]')).toHaveText('Note');
  });

  test('offers a date and never a time', async ({ page }) => {
    await type(page, 'x');
    await page.locator('[data-date-open]').click();
    await page.locator('[data-day="1"]').click();
    await expect(page.locator('[data-date-label]')).toHaveText('Yesterday');
    // `occurred_on` is a LOCAL DATE — a time input would be the settled schema
    // decision leaking back onto the surface.
    await expect(page.locator('[data-timeline] input[type="time"]')).toHaveCount(0);
    await expect(page.locator('[data-date-input]')).toHaveAttribute('type', 'date');
  });

  // The picker used to close on the FIRST digit of the year: a date input
  // reports its value per segment, so `2` in `2026` arrives as the year 0002 —
  // a complete, past, in-`max` date the handler happily committed. Typing has
  // to be driven key by key here; `fill()` sets all three segments at once and
  // never reproduces it.
  test('a year survives all four of its digits', async ({ page }) => {
    await type(page, 'x');
    await page.locator('[data-date-open]').click();
    const input = page.locator('[data-date-input]');
    const pop = page.locator('[data-pop="date"]');

    // Focus ONCE, then keep typing on the page's keyboard: every locator-level
    // press re-focuses the input, which sends the caret back to the month
    // segment and silently types a different date than the one you wrote.
    await input.focus();
    await page.keyboard.type('0115');
    await page.keyboard.type('2');
    await expect(pop).toBeVisible();
    await page.keyboard.type('02');
    await expect(pop).toBeVisible();

    await page.keyboard.type('4');
    await expect(pop).toBeHidden();
    await expect(page.locator('[data-date-label]')).toHaveText('1/15');
  });

  test('cannot offer a future date', async ({ page }) => {
    await type(page, 'x');
    await page.locator('[data-date-open]').click();
    const max = await page.locator('[data-date-input]').getAttribute('max');
    const today = await page.locator('[data-timeline]').getAttribute('data-today');
    expect(max).toBe(today);
  });

  test('only one picker is open at a time', async ({ page }) => {
    await type(page, 'x');
    await page.locator('[data-kind-open]').click();
    await page.locator('[data-date-open]').click();
    await expect(page.locator('[data-pop="kind"]')).toBeHidden();
    await expect(page.locator('[data-pop="date"]')).toBeVisible();
  });

  test('closes a picker on Escape', async ({ page }) => {
    await type(page, 'x');
    await page.locator('[data-kind-open]').click();
    await expect(page.locator('[data-pop="kind"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-pop="kind"]')).toBeHidden();
  });
});

test.describe('saving', () => {
  test('sends the subject, the words, the kind and a LOCAL date', async ({ page }) => {
    await openProfile(page);
    let payload: Record<string, unknown> | null = null;
    await stubActions(page, {
      'interactions.save': (req) => {
        payload = req.postDataJSON();
        return { id: '00000000-0000-4000-8000-000000000000' };
      },
    });

    const personId = await page.locator('[data-timeline]').getAttribute('data-person-id');
    const today = await page.locator('[data-timeline]').getAttribute('data-today');

    await type(page, 'Long call about nothing in particular.');
    await page.locator('[data-kind-open]').click();
    await page.locator('[data-kind="call"]').click();
    await page.locator('[data-log-save]').click();

    await expect.poll(() => payload).not.toBeNull();
    expect(payload).toMatchObject({
      personId,
      kind: 'call',
      occurredOn: today,
      body: 'Long call about nothing in particular.',
    });
    // A date, not an instant — no time component anywhere on the wire.
    expect(String((payload as any).occurredOn)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('a failed save says so and gives the button back', async ({ page }) => {
    await openProfile(page);
    await stubActions(page, {}); // no handler → aborted, i.e. a dead network

    await type(page, 'Something worth keeping.');
    const save = page.locator('[data-log-save]');
    await save.click();

    await expect(page.locator('[data-log-error]')).toBeVisible();
    await expect(save).toBeEnabled();
    await expect(save).toHaveText('Save');
    // And the words are still there — a failed save must never eat them.
    await expect(page.locator('[data-log-input]')).toHaveValue('Something worth keeping.');
  });
});

test.describe('the timeline', () => {
  test('says nothing rather than showing a skeleton when there is nothing', async ({ page }) => {
    await openProfile(page);
    const entries = await page.locator('.tl').count();
    if (entries === 0) {
      await expect(page.locator('[data-timeline]')).toContainText('Nothing logged yet.');
      // The box is still there — the empty state has to invite a jot.
      await expect(page.locator('[data-log-input]')).toBeVisible();
    } else {
      await expect(page.locator('[data-timeline]')).not.toContainText('Nothing logged yet.');
    }
  });

  test('every entry carries a mark, a stamp and its kind', async ({ page }) => {
    await openProfile(page);
    test.skip((await page.locator('.tl').count()) === 0, 'no entries logged yet');
    const row = page.locator('.tl').first();
    await expect(row.locator('.tl__mark svg')).toHaveCount(1);
    await expect(row.locator('.stamp')).toBeVisible();
    await expect(row.locator('.tl__kind')).not.toBeEmpty();
  });

  // No hover on a phone, so an affordance that needs a mouse does not exist.
  test('edit and delete are present without hovering', async ({ page }) => {
    await openProfile(page);
    test.skip((await page.locator('.tl').count()) === 0, 'no entries logged yet');
    const row = page.locator('.tl').first();
    await expect(row.getByRole('button', { name: 'Edit entry' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Delete entry' })).toBeVisible();
  });

  test('editing loads the entry back into the same box', async ({ page }) => {
    await openProfile(page);
    test.skip((await page.locator('.tl').count()) === 0, 'no entries logged yet');

    const row = page.locator('.tl').first();
    const body = await row.getAttribute('data-body');
    await row.getByRole('button', { name: 'Edit entry' }).click();

    // ONE editor, two jobs — a profile with two places to type is a profile
    // where you have to decide which one to use.
    await expect(page.locator('[data-log-input]')).toHaveValue(body!);
    await expect(page.locator('[data-log-cancel]')).toBeVisible();
    await expect(page.locator('.tl.is-editing')).toHaveCount(1);
  });

  test('cancelling an edit empties the box and unmarks the row', async ({ page }) => {
    await openProfile(page);
    test.skip((await page.locator('.tl').count()) === 0, 'no entries logged yet');

    await page.locator('.tl').first().getByRole('button', { name: 'Edit entry' }).click();
    await page.locator('[data-log-cancel]').click();
    await expect(page.locator('[data-log-input]')).toHaveValue('');
    await expect(page.locator('.tl.is-editing')).toHaveCount(0);
  });

  test('deleting asks first, and a refusal deletes nothing', async ({ page }) => {
    await openProfile(page);
    test.skip((await page.locator('.tl').count()) === 0, 'no entries logged yet');
    const seen = await stubActions(page, {});

    const before = await page.locator('.tl').count();
    await page.locator('.tl').first().getByRole('button', { name: 'Delete entry' }).click();
    await expect(page.locator('#confirm-dialog')).toBeVisible();
    await page.locator('#confirm-cancel').click();

    expect(seen(), 'cancelling must not call the action').toEqual([]);
    await expect(page.locator('.tl')).toHaveCount(before);
  });
});

test.describe('what the log gives back', () => {
  test('the profile header carries last contact as a duration', async ({ page }) => {
    await openProfile(page);
    const facts = page.locator('.phead__facts');
    if ((await page.locator('.tl').count()) === 0) {
      // Nothing logged: the fact has no source, so it must not be invented.
      await expect(facts).not.toContainText('Last contact');
    } else {
      await expect(facts).toContainText('Last contact');
      // A duration, never a bare date — that format carries no year.
      await expect(facts).toContainText(/today|yesterday|ago/);
    }
  });

  test('every roster card states a last contact, or says there is none', async ({ page }) => {
    await page.goto('/admin/people');
    test.skip((await page.locator('[data-person]').count()) === 0, 'no people in the roster');
    for (const card of await page.locator('[data-person]').all()) {
      await expect(card.locator('.pc__meta')).toContainText(/today|yesterday|ago|No entries yet/);
    }
  });
});
