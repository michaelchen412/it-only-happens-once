// A date is the READER's — `scripts/timestamp.ts`, driven with a fixed clock
// and a chosen zone (2026-11-13).
//
// ⚠ THE BUG THIS PINS SHOWED UP ONLY BY TIME OF DAY. An essay published at
// 7:02pm in New York read "Yesterday", with "Last updated … 12:02 AM" in its
// popover, because the server measured today and formatted the time in UTC —
// where it was already past midnight. At noon the same page looked right.
// Hence a fixed clock: the spec reads at 7:30pm New York time, the exact
// window where UTC has turned over, and again as a reader in Tokyo, who is
// genuinely a day ahead and SHOULD see "Yesterday".
//
// REAL DATA, READ-ONLY. `do-we-matter` was posted on 2026-11-13 and published
// at 00:01:57 UTC on the 14th (7:01pm New York). If it is edited, the
// "Last updated" assertions follow `updated_at` and may need the slug swapped.
import { expect, test } from './fixtures';

const SLUG = 'do-we-matter';

test.describe('a New York reader at 7:30pm on the day it was posted', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('reads "Today", and is not told about an edit that never happened', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-14T00:30:00Z')); // 7:30pm EST, Nov 13
    await page.goto(`/blog/${SLUG}`);
    const stamp = page.locator('.post-article time[data-ts-day]').first();
    await expect(stamp).toHaveText('Today');
    await stamp.click();
    await expect(page.locator('.ts-popover:popover-open')).toContainText('Posted on Friday, November 13, 2026');
    // `updated_at` is the publish write itself — the same evening, so no line.
    // ⚠ The ATTRIBUTE, not visibility: the line lives inside a popover, so
    // "hidden" would pass whenever the popover is closed and prove nothing.
    await expect(page.locator('.post-article [data-ts-updated]').first()).toHaveAttribute('hidden', '');
  });
});

test.describe('a Tokyo reader the next morning', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });

  test('reads "Yesterday" — and the publish write is still not an edit', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-14T01:00:00Z')); // 10am JST, Nov 14
    await page.goto(`/blog/${SLUG}`);
    await expect(page.locator('.post-article time[data-ts-day]').first()).toHaveText('Yesterday');
    // ⚠ THE CASE THAT CHOSE THE RULE. Measured against the POSTED DATE (New
    // York's 13th), a Tokyo reader — already on the 14th when it went live —
    // would be told about an edit. Measured against the publish instant, both
    // ends are the 14th in Tokyo, and nothing is announced.
    await expect(page.locator('.post-article [data-ts-updated]').first()).toHaveAttribute('hidden', '');
  });
});

test.describe('an essay that really was edited later', () => {
  // `color`: published 2023, last touched in 2026 — a later day in any zone.
  test.use({ timezoneId: 'Asia/Tokyo' });

  test("says when, in the READER's zone and never the server's UTC", async ({ page }) => {
    await page.goto('/blog/color');
    const line = page.locator('.post-article [data-ts-updated]').first();
    await expect(line).not.toHaveAttribute('hidden');
    // Formatted independently here, in the zone the browser was given — the
    // browser's text has to agree with it, and not with the UTC rendering.
    const iso = (await line.locator('time').getAttribute('datetime'))!;
    const at = new Date(iso);
    const fmt = (timeZone: string) =>
      `${at.toLocaleDateString('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at ${at.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })}`;
    await expect(line).toHaveText(`Last updated on ${fmt('Asia/Tokyo')}`);
    expect(fmt('Asia/Tokyo')).not.toBe(fmt('UTC'));
  });
});
