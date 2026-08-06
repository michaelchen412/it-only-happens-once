// The building says what it is waiting for (20 · Pieces 3–7).
//
// ⚠ WHAT THIS CAN AND CANNOT SEE, said plainly. The suite runs against the LIVE
// database and is read-only by construction, so it cannot arrange for something
// to be waiting — on a morning Michael has already checked in and has no task
// due, the true count is 0 and every title here is unprefixed. The arithmetic is
// `src/tests/hq-attention.test.ts`'s job, including the mutation checks that
// prove the past-due and skip guards bite.
//
// What is left is still the half a unit test cannot reach, and it is the half
// that has actually gone wrong before: the number is about the BUILDING and not
// about the room, it is about TODAY and not about the date the page is looking
// at, and at zero it says nothing at all. All three hold whatever the count is,
// which is exactly why they are worth asserting here.
import { expect, test } from '@playwright/test';

/** `Today — Observatory`, optionally prefixed `(2) `. Nothing else is legal. */
const TITLE = /^(\(\d+\) )?.+ — Observatory$/;

/** The prefix on a page, or '' — read from the served title. */
async function prefixOf(page: import('@playwright/test').Page, url: string): Promise<string> {
  await page.goto(url);
  const title = await page.title();
  expect(title, `"${title}" is not a legal Observatory title`).toMatch(TITLE);
  return title.match(/^\(\d+\) /)?.[0] ?? '';
}

test.describe('the count in the tab title', () => {
  test('⚠ never renders (0) — a permanent zero is a line you stop reading', async ({ page }) => {
    // Trap 6. `titlePrefix` returns '' rather than `(0)`, for the reason
    // `progressLabel()` already gives about `0 of 3 done`: the prefix APPEARING
    // is the signal, so a zero that is always there destroys it.
    for (const room of ['/admin', '/admin/people', '/admin/agenda', '/admin/library']) {
      await page.goto(room);
      expect(await page.title()).not.toContain('(0)');
    }
  });

  test('says the same thing in every room — it is about the building', async ({ page }) => {
    // The fault this feature exists to fix: navigating away from Today used to
    // make the system go silent. `(2) People — Observatory` is correct and is
    // the whole point. Whatever today's number is, four rooms must agree on it.
    const today = await prefixOf(page, '/admin');
    for (const room of ['/admin/people', '/admin/agenda', '/admin/library', '/admin/about']) {
      expect(await prefixOf(page, room), `${room} disagreed with /admin`).toBe(today);
    }
  });

  test('⚠ does not follow the date bar — the count always means today', async ({ page }) => {
    // Trap 2, and the one that would be invisible until it bit. Today is
    // navigable to any date via `?date=`; the badge is not. Stepping back to
    // backfill last week's check-in must not clear a signal about this morning,
    // and must not let that backfill decrement it.
    const now = await prefixOf(page, '/admin');
    for (const date of ['2026-01-01', '2025-06-15']) {
      expect(await prefixOf(page, `/admin?date=${date}`), `?date=${date} moved the count`).toBe(now);
    }
  });

  test('the room name still reads normally after the prefix', async ({ page }) => {
    // A prefix that swallowed the room name would be a regression nobody would
    // spot from the count alone.
    await page.goto('/admin/people');
    expect(await page.title()).toMatch(/People — Observatory$/);
  });
});

test.describe('the two pills', () => {
  test('there are exactly two, and they agree with the title', async ({ page }) => {
    // One number, three renderers. The sidebar pill is invisible on a phone
    // because the drawer is shut, which is why the burger carries the same
    // numeral — but "same" has to be true, so it is asserted rather than hoped.
    await page.goto('/admin');
    const pills = page.locator('[data-attention-pill]');
    await expect(pills).toHaveCount(2);

    // ⚠ THE `hidden` PROPERTY, NOT `toBeVisible()`. The burger lives in a
    // `md:hidden` header, so on a desktop viewport it is never *on screen* —
    // and conflating "the badge is off" with "the element is painted" would
    // make this pass at 1280px no matter what the badge did.
    const prefixed = /^\(\d+\) /.test(await page.title());
    for (let i = 0; i < 2; i++) {
      const pill = pills.nth(i);
      await expect(pill, `pill ${i} disagreed with the title`).toHaveJSProperty('hidden', !prefixed);
      if (prefixed) expect((await pill.textContent())?.trim()).toBe((await page.title()).match(/^\((\d+)\)/)![1]);
    }
  });

  test('⚠ neither is red — the urgency hue is spent on past due', async ({ page }) => {
    // `PastDueZone` establishes the rule: red means pressing HERE and nowhere.
    // A red badge on Today every morning — which is every morning, because that
    // is what a check-in is — devalues it everywhere it does real work.
    // Asserted on the class rather than the computed colour because the pill is
    // display:none at zero, and a token name is what a future edit would change.
    await page.goto('/admin');
    for (const cls of await page.locator('[data-attention-pill]').evaluateAll((els) => els.map((el) => el.className))) {
      expect(cls, 'the pill must stay neutral').toContain('bg-base-300');
      expect(cls).not.toMatch(/\berror\b|\bwarn\b|-red-|\bu-now\b/);
    }
  });

  test('⚠ the numeral is never the accessible name', async ({ page }) => {
    // A reader told "Today, 2" has been given a number and not what it counts.
    await page.goto('/admin');
    await expect(page.locator('[data-attention-pill]').first()).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#nav-today')).toHaveAttribute('aria-label', /^Today(, \d+ waiting)?$/);
    await expect(page.locator('#sb-open')).toHaveAttribute('aria-label', /^Open menu(, \d+ waiting)?$/);
  });
});

test.describe('the day has turned', () => {
  test('says nothing while the served day is still today', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('#day-turn')).toBeHidden();
    await expect(page.locator('#day-turn a')).toHaveAttribute('href', '/admin');
  });

  test('⚠ speaks when midnight passes, and does NOT reload the page', async ({ page }) => {
    // The whole point of Piece 6, and the half that cannot be reasoned about:
    // a tab left open overnight. Playwright's clock drives the real timer, so
    // this exercises the `setTimeout` path rather than a stubbed comparison.
    await page.clock.install();
    await page.goto('/admin');
    await expect(page.locator('#day-turn')).toBeHidden();

    // A marker that only survives if nothing navigated. An auto-reload at
    // midnight would discard an in-progress check-in or a half-written dump —
    // this is the assertion that keeps that from being "fixed" in later.
    await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));

    await page.clock.fastForward('25:00:00');
    await expect(page.locator('#day-turn')).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept),
      'the page reloaded — an auto-reload throws away whatever was half-typed',
    ).toBe(true);
  });
});

test.describe('the count moves when you answer', () => {
  /** The day the server rendered — the only day the badge is ever about. */
  const servedDay = (page: import('@playwright/test').Page) =>
    page.locator('#hq').evaluate((el) => (el as HTMLElement).dataset.today!);

  const signal = (page: import('@playwright/test').Page, on: string, kind: string, answered: boolean) =>
    page.evaluate(
      ([on, kind, answered]) =>
        document.dispatchEvent(new CustomEvent('hq:attention', { detail: { kind, on, answered: answered === 'yes' } })),
      [on, kind, answered ? 'yes' : 'no'],
    );

  test('all three renderers move together, without a navigation', async ({ page }) => {
    // Driven by dispatching the event rather than by ticking a real row: the
    // suite is read-only against the live database by construction, and what is
    // worth proving here is the LISTENER — that one event reaches the sidebar,
    // the burger and the title, and that they cannot drift apart.
    await page.goto('/admin');
    const before = await page.title();
    await signal(page, await servedDay(page), 'checkin', false);

    // Both pills come off `hidden` — the burger's is in a `md:hidden` header
    // and is not on screen at this width, which is a fact about the breakpoint
    // and not about the badge. The sidebar's, at this width, is really painted.
    await expect(page.locator('[data-attention-pill]').first()).toBeVisible();
    await expect(page.locator('[data-attention-pill]').nth(1)).toHaveJSProperty('hidden', false);
    await expect(page).toHaveTitle(/^\(\d+\) /);
    await expect(page.locator('#nav-today')).toHaveAttribute('aria-label', /^Today, \d+ waiting$/);
    await expect(page.locator('#sb-open')).toHaveAttribute('aria-label', /^Open menu, \d+ waiting$/);
    expect(await page.title(), 'the room name must survive the prefix').toContain(before.replace(/^\(\d+\) /, ''));
  });

  test('⚠ a prefix never stacks, however many answers arrive', async ({ page }) => {
    // `(1) (2) Today — …` is what you get from prefixing without stripping, and
    // it takes two events to see it — which is why this is its own test.
    // Computed from the served state rather than hard-coded: the expected total
    // is a fact about this morning's data, and a literal would pass today and
    // start lying on the first day something is actually due.
    await page.goto('/admin');
    const day = await servedDay(page);
    const tasks = Number(await page.locator('#hq').evaluate((el) => (el as HTMLElement).dataset.tasks));
    await signal(page, day, 'checkin', false); // → checkin = 1, whatever it was
    await signal(page, day, 'task', false);
    await signal(page, day, 'task', false);
    await expect(page).toHaveTitle(`(${1 + tasks + 2}) Today — Observatory`);
  });

  test('⚠ an answer for another date moves nothing — the badge is not the date bar', async ({ page }) => {
    // Backfilling last Tuesday's check-in must not clear a signal about this
    // morning, and ticking a past-due row must not decrement it. `checkin.ts`
    // posts whatever `logDate` the page is showing, so without the comparison
    // in `attention.ts` this is exactly what would go wrong.
    await page.goto('/admin');
    const before = await page.title();
    for (const day of ['2026-01-01', '2025-06-15']) {
      await signal(page, day, 'checkin', false);
      await signal(page, day, 'task', false);
    }
    expect(await page.title()).toBe(before);
    await expect(page.locator('[data-attention-pill]').first()).toBeHidden();
  });
});
