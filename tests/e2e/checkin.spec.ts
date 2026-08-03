// The morning check-in (11 · Piece 1).
//
// ⚠ READ THIS BEFORE TRUSTING A GREEN RUN. These specs **stub the action**, so
// what they prove is that the CLIENT behaves — that a tap saves immediately,
// that the payload carries what was tapped, that the derived line is right, and
// that the card fits a phone. They do NOT prove the write lands.
//
// And stubbing is not optional here. The harness runs against the LIVE project,
// and `daily_checkins` is Michael's actual sleep record. A spec that wrote to
// it would put invented nights into the one series the whole feature exists to
// keep honest — and an invented row is worse than an absent one, because the
// trend cannot tell them apart. Nothing in this file may ever be allowed to
// reach the database.
//
// The write path was exercised separately, by hand, against the live action on
// 2026-08-02: the timestamps, the backfill window, skip/unskip, and the dream
// constraint. Every probe row was deleted and the table verified empty after.
import { test, expect } from '@playwright/test';
import { stubActions } from './fixtures';

/** `YYYY-MM-DD` in a zone — the spec's own clock. */
const dateIn = (tz: string, offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() + offsetDays * 86400000));

async function zoneOf(page: import('@playwright/test').Page) {
  const tz = await page.locator('#tz-note').getAttribute('data-tz');
  expect(tz).toBeTruthy();
  return tz!;
}

/** Answer every check-in call with the row it asked for. Nothing is written. */
async function stub(page: import('@playwright/test').Page) {
  const payloads: Record<string, unknown>[] = [];
  const seen = await stubActions(page, {
    'checkin.save': (req) => {
      payloads.push(req.postDataJSON());
      return { id: 'stub', log_date: (req.postDataJSON() as { logDate: string }).logDate };
    },
    'checkin.setSkipped': (req) => {
      payloads.push(req.postDataJSON());
      return { id: 'stub' };
    },
  });
  return { payloads, seen };
}

test.describe('the check-in, before it has been answered', () => {
  test('asks once, offers a skip, and blocks nothing', async ({ page }) => {
    await page.goto('/admin');
    const zone = page.locator('[data-checkin]');

    await expect(zone.getByText('How did you sleep?')).toBeVisible();
    await expect(zone.getByRole('button', { name: 'Start' })).toBeVisible();
    await expect(zone.getByRole('button', { name: 'Skip', exact: true })).toBeVisible();

    // NOT A WALL. On a bad morning the day has to be reachable in one tap, so
    // there is no dialog and nothing is modal.
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(zone).toBeVisible();

    // NO STREAK, EVER, and nothing counting what was missed.
    await expect(page.getByText(/streak|in a row|missed|you haven.t/i)).toHaveCount(0);
  });

  test('Start opens the form without a round trip', async ({ page }) => {
    const { seen } = await stub(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();

    await expect(page.locator('[data-panel="fill"]')).toBeVisible();
    await expect(page.locator('[data-panel="ask"]')).toBeHidden();
    // Opening a form is not an answer, so it must not write one.
    expect(seen()).toEqual([]);
  });

  test('the dream question comes first', async ({ page }) => {
    // Settled 2026-08-02. Recall decays within minutes of waking, while the
    // times and ratings are just as answerable at 9am — so the perishable
    // field goes where you are most likely to still have it. Asserted on
    // rendered GEOMETRY, not source order, because the ordering is done with
    // flex `order` and source order says nothing about what you see.
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();

    const dream = await page.locator('[data-fs="dream"]').boundingBox();
    const sleep = await page.locator('[data-fs="sleep"]').boundingBox();
    const waking = await page.locator('[data-fs="waking"]').boundingBox();
    expect(dream!.y).toBeLessThan(sleep!.y);
    expect(sleep!.y).toBeLessThan(waking!.y);
  });
});

test.describe('answering it', () => {
  test('a tap saves immediately, and carries what was tapped', async ({ page }) => {
    const { payloads, seen } = await stub(page);
    const tz = await page.goto('/admin').then(() => zoneOf(page));
    await page.getByRole('button', { name: 'Start' }).click();

    await page.locator('[data-dream="anxious"]').click();
    await expect.poll(() => seen().length).toBe(1);

    const first = payloads[0] as Record<string, unknown>;
    expect(first.logDate).toBe(dateIn(tz));
    expect(first.dreamRecall).toBe('anxious');
    // The prefilled times ride along — they are part of the form's state, and
    // the action takes the whole form every time.
    expect(first.bed).toMatch(/^\d{2}:\d{2}$/);

    await page.locator('[data-star="sleep_quality"][data-v="3"]').click();
    await expect.poll(() => seen().length).toBe(2);
    expect((payloads[1] as Record<string, unknown>).sleepQuality).toBe(3);
  });

  test('the dream details only exist once there is a dream', async ({ page }) => {
    await stub(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();

    const more = page.locator('[data-dream-more]');
    await expect(more).toBeHidden();

    await page.locator('[data-dream="anxious"]').click();
    await expect(more).toBeVisible();

    // "Nothing" is a real answer and one tap — and choosing it must take the
    // intensity and the text away with it, which is the same rule the table's
    // CHECK constraint enforces.
    await page.locator('[data-tb="dream_intensity"][data-v="4"]').click();
    await page.locator('[data-dream="none"]').click();
    await expect(more).toBeHidden();
    await expect(page.locator('[data-tb="dream_intensity"].tb--on')).toHaveCount(0);
  });

  test('the two star scales stay two scales', async ({ page }) => {
    // Eight solid hours that still leave you wrung out is the signature being
    // investigated, and one combined score erases it. If a later pass ever
    // merges these, this is the spec that should go red.
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('[data-star="sleep_quality"]')).toHaveCount(5);
    await expect(page.locator('[data-star="restedness"]')).toHaveCount(5);
    await expect(page.locator('[data-tb="valence"]')).toHaveCount(5);
    await expect(page.locator('[data-tb="arousal"]')).toHaveCount(5);
  });

  test('every scale carries a word, and stars deliberately do not', async ({ page }) => {
    await stub(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();

    await page.locator('[data-tb="valence"][data-v="1"]').click();
    await expect(page.locator('[data-w-for="valence"]')).toHaveText('bleak');
    await page.locator('[data-tb="arousal"][data-v="5"]').click();
    await expect(page.locator('[data-w-for="arousal"]')).toHaveText('wired');
  });

  test('the derived line grows as the answers arrive, and claims nothing early', async ({ page }) => {
    await stub(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();

    const derived = page.locator('[data-derived]');
    await page.locator('[data-field="bed"]').fill('23:35');
    await page.locator('[data-field="woke"]').fill('06:25');
    // Crossing midnight is the normal case, not the edge one.
    await expect(derived).toHaveText('6h 50m in bed');

    // An efficiency that assumed "asleep instantly, never woke" would be a
    // number he did not give, presented as one he did.
    await page.locator('[data-lat="15_30"]').click();
    await expect(derived).toHaveText('6h 50m in bed');
    await page.locator('[data-wake="few"]').click();
    await expect(derived).toHaveText('6h 50m in bed · ≈6h 16m asleep · 92%');
  });

  test('typing debounces instead of saving every keystroke', async ({ page }) => {
    const { seen } = await stub(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.locator('[data-dream="neutral"]').click();
    await expect.poll(() => seen().length).toBe(1);

    await page.getByRole('button', { name: 'What you remember' }).click();
    await page.locator('[data-field="dream_body"]').type('a long corridor');
    // Fifteen characters must not be fifteen round trips.
    await expect.poll(() => seen().length, { timeout: 3000 }).toBe(2);
  });

  test('a failed save says so, and keeps saying so', async ({ page }) => {
    // The footer says "Saves as you go", which is a promise. The expensive
    // lesson in this codebase is an outbox that reported a success it did not
    // have; on this table that would mean losing the worst morning of a month.
    await page.route('**/_actions/**', (route) => route.abort('failed'));
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.locator('[data-star="restedness"][data-v="2"]').click();

    const saved = page.locator('[data-saved]');
    await expect(saved).not.toHaveText('Saved');
    await expect(saved).toHaveClass(/text-error/);
  });
});

test.describe('skipping', () => {
  test('is an explicit answer, not a gap', async ({ page }) => {
    const { payloads, seen } = await stub(page);
    const tz = await page.goto('/admin').then(() => zoneOf(page));
    await page.getByRole('button', { name: 'Skip', exact: true }).click();

    await expect.poll(() => seen()).toEqual(['checkin.setSkipped']);
    expect(payloads[0]).toEqual({ logDate: dateIn(tz), skipped: true });
  });
});

test.describe('backfill', () => {
  test('reaches three days back and no further', async ({ page }) => {
    const tz = await page.goto('/admin').then(() => zoneOf(page));

    // Three days back: fillable, and it says which day it is talking about.
    await page.goto(`/admin?date=${dateIn(tz, -3)}`);
    await expect(page.locator('[data-checkin]')).toHaveAttribute('data-writable', 'true');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('[data-bf]')).toBeVisible();

    // Four days back: readable, not writable, and no prompt to fill it.
    await page.goto(`/admin?date=${dateIn(tz, -4)}`);
    await expect(page.locator('[data-checkin]')).toHaveAttribute('data-writable', 'false');
    await expect(page.locator('[data-panel="fill"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0);
    await expect(page.getByText('Nothing recorded.')).toBeVisible();

    // And it is never framed as a failure — no count, no catching up.
    await expect(page.getByText(/missed|behind|catch up/i)).toHaveCount(0);
  });

  test('prefill is OFF on a past day, and on today it is on', async ({ page }) => {
    const tz = await page.goto('/admin').then(() => zoneOf(page));

    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('[data-field="bed"]')).not.toHaveValue('');
    await expect(page.locator('[data-prefill]')).toBeVisible();

    // A plausible suggested time on a day you are RECONSTRUCTING gets confirmed
    // without ever being recalled, and that manufactures data.
    await page.goto(`/admin?date=${dateIn(tz, -2)}`);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('[data-field="bed"]')).toHaveValue('');
    await expect(page.locator('[data-field="woke"]')).toHaveValue('');
    await expect(page.locator('[data-prefill]')).toHaveCount(0);
  });

  test('the future is not offered at all', async ({ page }) => {
    const tz = await page.goto('/admin').then(() => zoneOf(page));
    await page.goto(`/admin?date=${dateIn(tz, 1)}`);
    await expect(page.locator('[data-checkin]')).toHaveAttribute('data-writable', 'false');
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0);
  });
});
