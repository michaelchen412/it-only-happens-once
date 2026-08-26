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
import { test, expect, stubActions } from './fixtures';

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

/**
 * Open the form on a day with NOTHING on it yet.
 *
 * ⚠ THESE SPECS NEED A BLANK MORNING, AND UNTIL 2026-08-07 THEY PRETENDED NOT
 * TO. Fifteen of them clicked "Start" directly — a button the server only
 * renders on a date with no answers — so from the moment Michael did his own
 * check-in, every one of them failed for thirty seconds and then reported a
 * timeout. That is the exact failure this file warns about two helpers up: an
 * environmental failure wearing a bug's clothes. It cost a real
 * misdiagnosis: a refactor of the Morning card was read as having broken the
 * check-in, and was only cleared by reverting it and watching the same fifteen
 * fail identically.
 *
 * ⚠ AND IT IS `skip`, NOT `openForm`. The pencil would get these tests INTO the
 * form on an answered day, and every one of them would then assert against a
 * form prefilled with a real night — `payloads[4].dreams` would carry Michael's
 * dreams as well as the tapped ones. Reaching the form is not the precondition;
 * an EMPTY one is. The backfill block below is the model: assert what holds
 * unconditionally, and gate the rest on `blank()` rather than faking it.
 *
 * The honest cost, stated so nobody discovers it as a surprise: on a day already
 * answered these skip rather than run, and there is no blank day to borrow —
 * the window is three days and it is usually full. They exercise on a morning
 * before the check-in, and say plainly that they did not otherwise.
 */
async function startBlank(page: import('@playwright/test').Page) {
  test.skip(!(await blank(page)), 'today is already answered — these assert against an empty form');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('[data-panel="fill"]')).toBeVisible();
}

/**
 * The three night times, all of them, so a derived number is a function of what
 * the test said and nothing else.
 *
 * ⚠⚠ UNANSWERED IS NOT THE SAME AS EMPTY, and the gap between those two words
 * cost two specs (found 2026-08-18). `startBlank` guards "today has no answers"
 * — but **prefill is ON for today** and pulls the night times forward from a
 * recent day, which is a real feature with a passing spec of its own two blocks
 * down ("prefill is OFF on a past day, and on today it is on"). So the form
 * these two opened was unanswered AND prefilled: `gotUp` sat at `09:21`.
 *
 * ⚠ AND `gotUp` IS INSIDE THE DERIVED NUMBER, which is what turned a stale field
 * into a wrong assertion rather than a harmless one:
 * `inBed = night + (gotUp − woke) − outOfBed`. A test that set `bed`/`woke` for a
 * 6h 50m night and left `gotUp` alone read **9h 46m** — the prefilled 2h 56m
 * lie-in, added on. It looked like a derivation bug and was a fixture bug:
 * exactly the "environmental failure wearing a bug's clothes" this file warns
 * about twice, walking straight through the guard written for it, because the
 * guard asks whether the day was ANSWERED and the tests need it EMPTY.
 *
 * ⚠ It sets all three rather than clearing them. A night with no `gotUp` is a
 * different case from one where you got up when you woke, and these tests mean
 * the second — so the default is `woke`, which is what makes `inBed` equal the
 * night itself.
 */
async function night(page: import('@playwright/test').Page, bed: string, woke: string, gotUp = woke) {
  await page.locator('[data-field="bed"]').fill(bed);
  await page.locator('[data-field="woke"]').fill(woke);
  await page.locator('[data-field="gotUp"]').fill(gotUp);
}

test.describe('the check-in, before it has been answered', () => {
  test('asks once, offers a skip, and blocks nothing', async ({ page }) => {
    await page.goto('/admin');
    // Same precondition as `startBlank`, spelled out because this one asserts
    // the ASK panel itself rather than opening the form from it.
    test.skip(!(await blank(page)), 'today is already answered — the ask has correctly been replaced');
    const zone = page.locator('[data-checkin]');

    await expect(zone.getByText('How did you sleep?')).toBeVisible();
    await expect(zone.getByRole('button', { name: 'Start' })).toBeVisible();
    await expect(zone.getByRole('button', { name: 'Skip', exact: true })).toBeVisible();

    // NOT A WALL, and this line is the whole of that rule (11-checkin.md §4.1).
    //
    // ⚠ IT SURVIVED THE FORM BECOMING A SHEET ON 2026-08-26 UNCHANGED, AND THAT
    // IS THE POINT — what the rule forbids is a modal you WAKE UP BEHIND, so it
    // is a claim about ARRIVAL. Nothing is open when the page loads; the drawer
    // exists only after you press Start. Do not weaken this to
    // `dialog[data-panel="fill"]:not([open])` if some other dialog ever lands on
    // Today: the assertion that matters is that NOTHING greets you modally.
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
    await startBlank(page);

    // ⚠ THE FORM ARRIVES AS A MODAL SHEET, AND THE ASK IS DELIBERATELY STILL
    // THERE BEHIND IT. This asserted `[data-panel="ask"]` was HIDDEN until
    // 2026-08-26, when the fill panel became a `<dialog>` — and the card
    // underneath is now left in its resting state on purpose, the way every
    // page in this building is left under a sheet. Hiding it would mean the
    // 0.28s slide out of a dismissal played over an empty card.
    const sheet = page.locator('dialog[data-panel="fill"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveJSProperty('open', true);
    await expect(page.locator('[data-panel="ask"]')).toBeVisible();
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
    await startBlank(page);

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
    await startBlank(page);

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
    await startBlank(page);

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
    await startBlank(page);

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
    await startBlank(page);
    await expect(page.locator('[data-star="sleep_quality"]')).toHaveCount(5);
    await expect(page.locator('[data-star="restedness"]')).toHaveCount(5);
    await expect(page.locator('[data-tb="valence"]')).toHaveCount(5);
    await expect(page.locator('[data-tb="arousal"]')).toHaveCount(5);
  });

  test('every scale carries a word, and stars deliberately do not', async ({ page }) => {
    await stub(page);
    await page.goto('/admin');
    await startBlank(page);

    await page.locator('[data-tb="valence"][data-v="1"]').click();
    await expect(page.locator('[data-w-for="valence"]')).toHaveText('bleak');
    await page.locator('[data-tb="arousal"][data-v="5"]').click();
    await expect(page.locator('[data-w-for="arousal"]')).toHaveText('wired');
  });

  test('the derived line grows as the answers arrive, and claims nothing early', async ({ page }) => {
    await stub(page);
    await page.goto('/admin');
    await startBlank(page);

    const derived = page.locator('[data-derived]');
    // Crossing midnight is the normal case, not the edge one.
    await night(page, '23:35', '06:25');
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
    await startBlank(page);

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
    await startBlank(page);

    const derived = page.locator('[data-derived]');
    await night(page, '23:00', '07:00');
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
    await startBlank(page);

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
    await startBlank(page);
    await page.locator('[data-dream="neutral"]').click();
    await expect.poll(() => seen().length).toBe(1);

    await page.getByRole('button', { name: 'What you remember' }).click();
    // ⚠ `pressSequentially`, NOT `fill`. This types character by character on
    // purpose — the assertion below is about the DEBOUNCE, and `fill` sets the
    // value in one shot, which would make the test pass without exercising it.
    // The field is a mini editor since plan 43, so the surface is the
    // contenteditable inside the mount point — `pressSequentially` still types
    // character by character, which is the whole point of the assertion below.
    await page.locator('[data-field="dream_body"] [contenteditable]').pressSequentially('a long corridor');
    // Fifteen characters must not be fifteen round trips.
    await expect.poll(() => seen().length, { timeout: 3000 }).toBe(2);
  });

  test('a failed save says so, and keeps saying so', async ({ page }) => {
    // The footer says "Saves as you go", which is a promise. The expensive
    // lesson in this codebase is an outbox that reported a success it did not
    // have; on this table that would mean losing the worst morning of a month.
    await page.route('**/_actions/**', (route) => route.abort('failed'));
    await page.goto('/admin');
    await startBlank(page);
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
    // The bare "Skip" lives on the ASK panel, so it needs the same blank
    // morning `startBlank` does — the FILL panel's is "Skip today", and
    // matching that one instead would test a different button.
    test.skip(!(await blank(page)), 'today is already answered — the ask, and its Skip, are gone');
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

/**
 * ⚠ THE TOOLBAR LIVES INSIDE THE FIELD, SO BLURRING ONTO IT IS NOT LEAVING IT.
 *
 * The two prose fields became mini editors in plan 43, and the autosave's "save
 * on the way out" moved from a textarea's `blur` to the editable's `focusout`.
 * Those are not the same event on this widget: a textarea had no controls inside
 * it, and this one has two. Pressing B moves focus to a button that is part of
 * the same field, and the first version read that as leaving — so every
 * formatting click fired an immediate flush and defeated the 800ms debounce that
 * "typing debounces instead of saving every keystroke" exists to protect.
 *
 * ⚠ AND THAT SPEC COULD NOT HAVE CAUGHT IT, which is why this one is separate.
 * It runs behind `startBlank`, so it skips on any day Michael has already
 * answered — most days, and it skipped on the day this was written. This one
 * takes `openForm` (either door) and asserts a property of a CONTROL, which is
 * true of a prefilled form and an empty one alike — the distinction
 * `startBlank`'s own note draws when it explains why it refuses the pencil.
 *
 * NO DEBOUNCE IS PENDING WHEN THE CLICK HAPPENS — nothing has been typed — so
 * the assertion needs no timing window: a save appearing here can only have come
 * from the click itself.
 */
test('⚠ pressing B is not "leaving the field", so it does not post', async ({ page }) => {
  const { seen } = await stub(page);
  await page.goto('/admin');
  await openForm(page);

  const reveal = page.getByRole('button', { name: 'A line about today' });
  if (await reveal.isVisible()) await reveal.click();
  const box = page.locator('[data-field="note"] [contenteditable]');
  await box.click();

  const before = seen().length;
  await page.locator('#ci-note-wrap .tt-btn[data-cmd="bold"]').click();
  await expect(page.locator('#ci-note-wrap .tt-btn[data-cmd="bold"]')).toHaveAttribute('aria-pressed', 'true');
  expect(seen().length, 'a formatting click is not an edit and must not save').toBe(before);
});

/**
 * ⚠ THE FORM BECAME A SHEET ON 2026-08-26, AND A SHEET OWES ADR 0032 AN ANSWER
 * ON ALL THREE WAYS OUT. Before that there was exactly one — a Done button —
 * and none of the three gestures below existed to be got wrong.
 *
 * They take `openForm` (either door) rather than `startBlank`, deliberately:
 * every one asserts a property of the SHEET, which is as true of a prefilled
 * form as of an empty one, and `startBlank` skips on any day Michael has
 * already answered — which is most days, and would have left the new exits
 * covered by nothing at all.
 *
 * Nothing here writes: `stub` answers every check-in call with the row it asked
 * for, and each test touches no control before leaving, so no save is even
 * pending. Leaving reloads (the summary is rendered from the ROW, never from
 * the browser's idea of it), which is why each assertion is about the sheet
 * being GONE rather than about what replaced it.
 */
test.describe('leaving the form', () => {
  test('⚠ Escape gets out from INSIDE a mini editor, where ProseMirror eats the key', async ({ page }) => {
    await stub(page);
    await page.goto('/admin');
    await openForm(page);
    const sheet = page.locator('dialog[data-panel="fill"]');

    // ⚠ THE CARET HAS TO BE IN THE EDITOR, or this passes on the wrong thing.
    // `prosemirror-view`'s `captureKeyDown` preventDefaults Escape
    // unconditionally, so the keydown's default never survives to become the
    // dialog's `cancel` — the event `wireSheetDismiss` binds. With focus
    // anywhere else on the card the native path works and this proves nothing;
    // with focus in here, only `checkin.ts`'s own keydown can close the sheet.
    // capture.ts paid for this lesson first, in the box you dump thoughts into.
    const reveal = page.getByRole('button', { name: 'A line about today' });
    if (await reveal.isVisible()) await reveal.click();
    await page.locator('[data-field="note"] [contenteditable]').click();

    await page.keyboard.press('Escape');
    await expect(sheet, 'Escape inside the note left the sheet standing').toBeHidden();
  });

  test('the backdrop is a way out, and the card behind is still the card', async ({ page }) => {
    await stub(page);
    await page.goto('/admin');
    await openForm(page);
    const sheet = page.locator('dialog[data-panel="fill"]');

    // ⚠ THE PRESS IS AT VIEWPORT COORDINATES, NOT AT A `position` INSIDE THE
    // SHEET, and the difference is the whole mechanism. `.drawer-dialog` pins
    // itself right at `max-w-lg`, so the <dialog> element's own box IS the
    // drawer — `position: { x: 4 }` lands on the sheet's left edge, inside it.
    // What `backdrop-close.ts` waits for is `e.target === dialog`, which is what
    // the dimmed area to the LEFT of the drawer reports.
    //
    // down and up at one point, because the press has to both start and end
    // there: a text selection dragged out of a sheet is not a dismissal.
    const box = (await sheet.boundingBox())!;
    await page.mouse.move(box.x - 60, box.y + 200);
    await page.mouse.down();
    await page.mouse.up();
    await expect(sheet, 'a press on the backdrop left the sheet standing').toBeHidden();

    // And Morning is still Morning: the zone is not a panel the sheet took with
    // it, and the routine at its foot is outside every panel by design.
    await expect(page.locator('[data-checkin]')).toBeVisible();
  });

  test('Done is the same exit as the other two, not a fourth thing', async ({ page }) => {
    await stub(page);
    await page.goto('/admin');
    await openForm(page);
    const sheet = page.locator('dialog[data-panel="fill"]');

    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet, 'Done left the sheet standing').toBeHidden();
  });

  test('⚠ and there is no discard guard on the way out, because nothing is unsaved', async ({ page }) => {
    // ADR 0032's FIRST legal answer, asserted rather than asserted-in-a-comment:
    // every tap on this card wrote immediately and every keystroke is flushed on
    // the way past, so dismissing costs nothing and must not stop to ask. A
    // confirm over a form with nothing to lose is the kind readers learn to
    // click through — and then it protects nothing anywhere in the building.
    //
    // ⚠ THE ONE STATE THAT DOES GUARD IS A FAILED SAVE (`checkin.ts`), which is
    // not reachable here: `stub` answers every call. That branch is the reason
    // this assertion has to be narrow — "no confirm" is true of the happy path
    // only, and the happy path is the whole of ordinary use.
    await stub(page);
    await page.goto('/admin');
    await openForm(page);

    await page.locator('[data-star="sleep_quality"][data-v="3"]').click();
    await expect(page.locator('[data-saved]')).toHaveText(/Saved/);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog').filter({ hasText: 'Discard changes?' })).toHaveCount(0);
    await expect(page.locator('dialog[data-panel="fill"]')).toBeHidden();
  });
});
