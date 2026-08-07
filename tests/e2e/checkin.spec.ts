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

/**
 * Has this date got nothing on it yet?
 *
 * ⚠ THE HARNESS RUNS AGAINST THE LIVE PROJECT, so which panel a date opens on
 * is a fact about Michael's actual sleep log rather than about the code — and a
 * spec that assumes "ask" is a spec that passes until the feature gets used.
 * The server's own answer is on the zone, so it is read rather than guessed.
 */
const panelOf = (page: import('@playwright/test').Page) =>
  page.locator('[data-checkin]').getAttribute('data-panel-initial');

const blank = async (page: import('@playwright/test').Page) => (await panelOf(page)) === 'ask';

/**
 * EITHER DOOR INTO THE FORM — "Start" on a date with nothing on it, the pencil
 * on one already answered. Same reasoning as `checkin.mobile.spec.ts`: which
 * door is showing is not a fact about the backfill window, and waiting for the
 * wrong one is an environmental failure wearing a bug's clothes.
 */
async function openForm(page: import('@playwright/test').Page) {
  const start = page.getByRole('button', { name: 'Start' });
  if (await start.isVisible().catch(() => false)) await start.click();
  else await page.locator('[data-edit]').click();
  await expect(page.locator('[data-panel="fill"]')).toBeVisible();
}

/** Answer every check-in call with the row it asked for. Nothing is written. */
async function stub(page: import('@playwright/test').Page) {
  const payloads: Record<string, unknown>[] = [];
  const all = await stubActions(page, {
    'checkin.save': (req) => {
      payloads.push(req.postDataJSON());
      return { id: 'stub', log_date: (req.postDataJSON() as { logDate: string }).logDate };
    },
    'checkin.setSkipped': (req) => {
      payloads.push(req.postDataJSON());
      return { id: 'stub' };
    },
  });
  // ⚠ FILTERED TO THIS CARD'S OWN CALLS, because `stubActions` records EVERY
  // action the page makes and Today makes one that has nothing to do with the
  // check-in: `calendar-sync.ts` asks Google the moment the page is drawn
  // (13 · Piece 3). Unfiltered, every count here read one high — so "a tap
  // saves once" failed while the tap was saving exactly once, and the number it
  // was really counting was a page load. `seen()` must mean what the assertions
  // say it means, and they all say "saves from this card".
  const seen = () => all().filter((n) => n.startsWith('checkin.'));
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
    //
    // ⚠ SCOPED TO THE ZONE, and it has to be. Over the whole page this matched
    // the push opt-in's own copy — "only on a morning you haven't checked in" —
    // which is a promise about when the Observatory stays quiet, not a scold on
    // the card. The rule being defended is about THIS card: nothing here counts
    // what you missed.
    await expect(zone.getByText(/streak|in a row|missed|you haven.t/i)).toHaveCount(0);
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
    const night = await page.locator('[data-fs="night"]').boundingBox();
    const rating = await page.locator('[data-fs="rating"]').boundingBox();
    const naps = await page.locator('[data-fs="naps"]').boundingBox();
    expect(dream!.y).toBeLessThan(night!.y);
    expect(night!.y).toBeLessThan(rating!.y);
    // And naps are LAST, because they are the only section here about the day:
    // unanswerable at 7am, so anywhere earlier puts a question you cannot answer
    // in the middle of a card built to be finished in under a minute.
    expect(rating!.y).toBeLessThan(naps!.y);
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
    expect(first.dreams).toEqual([{ tone: 'anxious', intensity: null, wokeYou: false, recurring: false }]);
    // The prefilled times ride along — they are part of the form's state, and
    // the action takes the whole form every time.
    expect(first.bed).toMatch(/^\d{2}:\d{2}$/);

    await page.locator('[data-star="sleep_quality"][data-v="3"]').click();
    await expect.poll(() => seen().length).toBe(2);
    expect((payloads[1] as Record<string, unknown>).sleepQuality).toBe(3);
  });

  test('two kinds of dream in one night, each with its own strength', async ({ page }) => {
    // THE GAP THIS CLOSES (Michael, 2026-08-06): the tones used to be mutually
    // exclusive, so a night with an anxious dream AND a distressing one kept
    // whichever was tapped last, under a single intensity spanning both.
    const { payloads, seen } = await stub(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();

    await page.locator('[data-dream="anxious"]').click();
    await page.locator('[data-dream="distressing"]').click();
    await expect(page.locator('[data-dream-more="anxious"]')).toBeVisible();
    await expect(page.locator('[data-dream-more="distressing"]')).toBeVisible();

    await page.locator('[data-tb="intensity_anxious"][data-v="2"]').click();
    await page.locator('[data-tb="intensity_distressing"][data-v="5"]').click();
    // The clinical line between an anxiety dream and a nightmare — the question
    // plan 11 opened with and could not measure until today.
    await page.locator('[data-dream-more="distressing"] [data-flag="wokeYou"]').click();

    await expect.poll(() => seen().length).toBe(5);
    expect((payloads[4] as Record<string, unknown>).dreams).toEqual([
      { tone: 'anxious', intensity: 2, wokeYou: false, recurring: false },
      { tone: 'distressing', intensity: 5, wokeYou: true, recurring: false },
    ]);
    // Two tones, and neither strength leaked into the other.
    await expect(page.locator('[data-tb="intensity_anxious"].tb--on')).toHaveCount(1);
    await expect(page.locator('[data-tb="intensity_distressing"].tb--on')).toHaveCount(1);
  });

  test('the dream details only exist once there is a dream', async ({ page }) => {
    const { payloads, seen } = await stub(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();

    const more = page.locator('[data-dream-more="anxious"]');
    await expect(more).toBeHidden();

    await page.locator('[data-dream="anxious"]').click();
    await expect(more).toBeVisible();

    // "Nothing" is a real answer and one tap — and choosing it must take every
    // tone's details away with it, which is the same rule the table's CHECK
    // constraint and the action both enforce.
    await page.locator('[data-tb="intensity_anxious"][data-v="4"]').click();
    await page.locator('[data-dream="none"]').click();
    await expect(more).toBeHidden();
    await expect(page.locator('[data-tb="intensity_anxious"].tb--on')).toHaveCount(0);

    await expect.poll(() => seen().length).toBe(3);
    const last = payloads[2] as Record<string, unknown>;
    expect(last.dreams).toEqual([]);
    expect(last.dreamless).toBe(true);
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

  test('a broken night is representable, and it moves the efficiency', async ({ page }) => {
    // ⚠ THE NIGHT THIS EXISTS FOR (Michael, 2026-08-06): *"I fell asleep for
    // three hours, I was awake for three hours, and I went to bed again and only
    // slept two hours."* `many` carried thirty minutes, so the card said 83%
    // about a 54% night — twenty-nine points, on the one number CBT-I moves.
    await stub(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();

    const derived = page.locator('[data-derived]');
    await page.locator('[data-field="bed"]').fill('23:00');
    await page.locator('[data-field="woke"]').fill('07:30');
    await page.locator('[data-field="gotUp"]').fill('07:45');
    await page.locator('[data-lat="30_60"]').click();

    // A timed waking appears only under a bucket that admits one.
    await expect(page.locator('[data-wakings]')).toBeHidden();
    await page.locator('[data-wake="many"]').click();
    await expect(page.locator('[data-wakings]')).toBeVisible();
    await expect(derived).toHaveText('8h 45m in bed · ≈7h 15m asleep · 83%');

    await page.getByRole('button', { name: 'A long waking' }).click();
    const waking = page.locator('[data-waking]').first();
    await waking.locator('[data-t="woke"]').fill('02:30');
    await waking.locator('[data-t="backAsleep"]').fill('05:30');
    await expect(derived).toHaveText('8h 45m in bed · ≈4h 45m asleep · 54%');

    // CBT-I stimulus control tells you to LEAVE THE BED. Until this existed,
    // obeying it scored exactly the same as lying there ignoring it — the three
    // hours sat in the denominator either way.
    await waking.getByRole('button', { name: 'Got up' }).click();
    await expect(derived).toHaveText('5h 45m in bed · ≈4h 45m asleep · 83%');
  });

  test('a nap is counted, and never folded into the night', async ({ page }) => {
    await stub(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();

    const derived = page.locator('[data-derived]');
    await page.locator('[data-field="bed"]').fill('23:00');
    await page.locator('[data-field="woke"]').fill('07:00');
    await page.locator('[data-lat="under_15"]').click();
    await page.locator('[data-wake="none"]').click();
    await expect(derived).toHaveText('8h 00m in bed · ≈7h 52m asleep · 98%');

    await page.getByRole('button', { name: 'Add a nap' }).first().click();
    const nap = page.locator('[data-nap]').first();
    await nap.locator('[data-t="start"]').fill('14:00');
    await nap.locator('[data-t="end"]').fill('14:45');
    // Efficiency is a claim about ONE NIGHT IN ONE BED. The nap rides at the
    // end of the line and changes nothing inside it.
    await expect(derived).toHaveText('8h 00m in bed · ≈7h 52m asleep · 98% · +45m napped');
  });

  test('"nothing taken" is a tap, not an empty answer', async ({ page }) => {
    // Reading no selection as "took nothing" would silently invent the control
    // group every correlation over this column depends on. `[]` is an answer;
    // `null` is a question nobody answered.
    const { payloads, seen } = await stub(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();

    await page.locator('[data-aid="melatonin"]').click();
    await expect.poll(() => seen().length).toBe(1);
    expect((payloads[0] as Record<string, unknown>).sleepAids).toEqual(['melatonin']);

    await page.locator('[data-aid="alcohol"]').click();
    await expect.poll(() => seen().length).toBe(2);
    expect((payloads[1] as Record<string, unknown>).sleepAids).toEqual(['melatonin', 'alcohol']);

    // "Nothing" is exclusive, and it is not the same as never asking.
    await page.locator('[data-aid="none"]').click();
    await expect.poll(() => seen().length).toBe(3);
    expect((payloads[2] as Record<string, unknown>).sleepAids).toEqual([]);
  });

  test('typing debounces instead of saving every keystroke', async ({ page }) => {
    const { seen } = await stub(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.locator('[data-dream="neutral"]').click();
    await expect.poll(() => seen().length).toBe(1);

    await page.getByRole('button', { name: 'What you remember' }).click();
    // ⚠ `pressSequentially`, NOT `fill`. This types character by character on
    // purpose — the assertion below is about the DEBOUNCE, and `fill` sets the
    // value in one shot, which would make the test pass without exercising it.
    await page.locator('[data-field="dream_body"]').pressSequentially('a long corridor');
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
    await openForm(page);
    await expect(page.locator('[data-bf]')).toBeVisible();

    // Four days back: readable, not writable, and no prompt to fill it.
    await page.goto(`/admin?date=${dateIn(tz, -4)}`);
    await expect(page.locator('[data-checkin]')).toHaveAttribute('data-writable', 'false');
    await expect(page.locator('[data-panel="fill"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0);
    // ⚠ WHAT IT SAYS DEPENDS ON WHETHER THAT NIGHT EXISTS, and both answers are
    // right: a day outside the window is READABLE, so one with a record shows
    // the record, and one without is simply absent. Asserting "Nothing
    // recorded." unconditionally was asserting that Michael had not used the
    // feature four days ago. What is unconditional is everything above — no
    // form, no prompt — and that exactly one of these two panels is showing.
    const panel = await panelOf(page);
    expect(['closed', 'done']).toContain(panel);
    await expect(page.locator(`[data-panel="${panel}"]`)).toBeVisible();

    // And it is never framed as a failure — no count, no catching up.
    await expect(page.getByText(/missed|behind|catch up/i)).toHaveCount(0);
  });

  test('prefill is OFF on a past day, and on today it is on', async ({ page }) => {
    const tz = await page.goto('/admin').then(() => zoneOf(page));

    // ⚠ THE SUGGESTION ONLY EXISTS ON A MORNING WITH NOTHING ON IT — the page
    // withholds it the moment either time is already recorded, which is the
    // point of it. So the positive half is asserted on the day it can be, and
    // skipped rather than faked on a day already answered.
    const untouched = await blank(page);
    await openForm(page);
    if (untouched) {
      await expect(page.locator('[data-field="bed"]')).not.toHaveValue('');
      await expect(page.locator('[data-prefill]')).toBeVisible();
    }

    // A plausible suggested time on a day you are RECONSTRUCTING gets confirmed
    // without ever being recalled, and that manufactures data.
    await page.goto(`/admin?date=${dateIn(tz, -2)}`);
    const pastIsBlank = await blank(page);
    await openForm(page);
    // The rule itself, and it holds whatever that day already carries: the hint
    // is rendered for today and for no other date.
    await expect(page.locator('[data-prefill]')).toHaveCount(0);
    // The times are only expected empty when the day genuinely is. On a day
    // with a real night on it they carry that night — which is the record, not
    // a suggestion, and is exactly the distinction being defended.
    if (pastIsBlank) {
      await expect(page.locator('[data-field="bed"]')).toHaveValue('');
      await expect(page.locator('[data-field="woke"]')).toHaveValue('');
    }
  });

  test('the future is not offered at all', async ({ page }) => {
    const tz = await page.goto('/admin').then(() => zoneOf(page));
    await page.goto(`/admin?date=${dateIn(tz, 1)}`);
    await expect(page.locator('[data-checkin]')).toHaveAttribute('data-writable', 'false');
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0);
  });
});
