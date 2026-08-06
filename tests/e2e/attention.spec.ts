// The tab title carries the count (20 · Piece 5), and it is honest about it.
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
