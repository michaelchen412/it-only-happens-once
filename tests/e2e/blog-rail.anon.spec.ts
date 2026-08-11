// The blog rail's faceting, against the real database.
//
// ⚠ WHAT THIS PROVES THAT THE UNIT TEST CANNOT. `src/tests/blog-rail.test.ts`
// pins the arithmetic, but the stub "fakes the builder, not the database" — it
// hands `listSubjects` the rows the query would have returned, so the query
// itself is untested there by design. The author narrowing rides on a two-level
// embed (`fragments!inner(…, authors(slug))`), and if that ever stops resolving
// — an RLS change on `authors`, a PostgREST upgrade — every fragment's author
// reads as null and EVERY tag goes dead under a filter. That failure is silent
// and looks exactly like an author who wrote about nothing. Only a live read
// catches it.
//
// Signed out on purpose: this is a reader-facing surface, and anon runs with no
// storageState. Read-only by construction — every route here is a GET.
import type { Page } from '@playwright/test';
// ⚠ `test` FROM ./fixtures, never from @playwright/test — that import is what
// carries the read-only guard (2026-08-09). Only the TYPE comes from upstream.
import { test, expect } from './fixtures';

/** The rail as the reader sees it: what is offered, what is inert, and the
 *  number each one promises. */
async function rail(page: Page) {
  const scope = page.locator('[data-subjects] ul');
  await expect(scope).toBeVisible();
  return page.evaluate(() => {
    const read = (el: Element) => {
      const nums = [...el.querySelectorAll('span')].map((s) => s.textContent?.trim() ?? '');
      const count = Number.parseInt(nums[nums.length - 1] ?? '', 10);
      return { name: (el.textContent ?? '').trim().replace(/\s*\d+$/, ''), count };
    };
    const ul = document.querySelector('[data-subjects] ul')!;
    return {
      live: [...ul.querySelectorAll('a[data-subject-link]')].map((a) => ({
        ...read(a),
        href: (a as HTMLAnchorElement).getAttribute('href')!,
        selected: a.getAttribute('aria-current') === 'true',
      })),
      dead: [...ul.querySelectorAll('[aria-disabled="true"]')].map(read),
    };
  });
}

/** The feed's own total, from the summary line above it. */
async function feedTotal(page: Page): Promise<number> {
  const text = await page.locator('#blog-feed > p').first().innerText();
  return Number.parseInt(text.trim(), 10);
}

/** An author reachable the way a reader reaches one: by following an attribution
 *  off the quotes feed. Discovered, never seeded — and skipped rather than
 *  stubbed if the corpus has no repeat author. */
async function someAuthor(page: Page): Promise<string | null> {
  await page.goto('/blog?view=quotes');
  const hrefs = await page
    .locator('a[href*="author="]')
    .evaluateAll((els) =>
      els.map((e) => new URL((e as HTMLAnchorElement).href).searchParams.get('author')).filter((s): s is string => !!s),
    );
  // The busiest one on the page: most likely to leave both a live tag and a
  // dead one, which is what makes the assertions below say anything.
  const tally = new Map<string, number>();
  for (const s of hrefs) tally.set(s, (tally.get(s) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

test.describe('the rail counts every filter on the page', () => {
  test('unfiltered, nothing is offered that leads nowhere', async ({ page }) => {
    await page.goto('/blog?view=quotes');
    const { live, dead } = await rail(page);
    expect(live.length).toBeGreaterThan(0);
    expect(dead).toHaveLength(0); // nothing is a dead end when nothing is filtered
    for (const tag of live) expect(tag.count).toBeGreaterThan(0);
  });

  test('THE AUTHOR NARROWS THE COUNTS — the bug this file was written for', async ({ page }) => {
    const author = await someAuthor(page);
    test.skip(!author, 'no quote on the feed offers an author door');

    await page.goto('/blog?view=quotes');
    const before = new Map((await rail(page)).live.map((t) => [t.name, t.count]));

    await page.goto(`/blog?view=quotes&author=${author}`);
    const after = await rail(page);

    // The embed resolved: not every tag went dead. This is the assertion that
    // fails if `authors(slug)` ever stops coming back.
    expect(after.live.length).toBeGreaterThan(0);
    // And it did something: at least one tag now counts fewer, or is gone.
    const narrowed = after.live.some((t) => t.count < (before.get(t.name) ?? 0)) || after.dead.length > 0;
    expect(narrowed).toBe(true);
    for (const tag of after.live) expect(tag.count).toBeLessThanOrEqual(before.get(tag.name) ?? 0);
  });

  test('every number on an offered tag is what the feed then shows', async ({ page }) => {
    const author = await someAuthor(page);
    test.skip(!author, 'no quote on the feed offers an author door');
    await page.goto(`/blog?view=quotes&author=${author}`);
    const { live } = await rail(page);
    expect(live.length).toBeGreaterThan(0);

    // The count is a PROMISE — "add me and N remain" — so the only honest test
    // is to add it and count what remains. Every offered tag, not a sample:
    // the corpus is small and a wrong one is invisible until a reader finds it.
    for (const tag of live.filter((t) => !t.selected)) {
      await page.goto(tag.href);
      expect(await feedTotal(page), `${tag.name} promised ${tag.count}`).toBe(tag.count);
    }
  });

  test('a tag shown as a dead end really is one', async ({ page }) => {
    const author = await someAuthor(page);
    test.skip(!author, 'no quote on the feed offers an author door');

    // The slug comes from the UNFILTERED rail, where the same subject is still a
    // link — read, not guessed from the name. "emotion vs reason" is one bad
    // slugify away from a URL that filters by nothing and passes for the wrong
    // reason.
    await page.goto('/blog?view=quotes');
    const slugByName = new Map(
      (await rail(page)).live.map((t) => [t.name, new URL(t.href, 'http://x').searchParams.get('subject')!]),
    );

    await page.goto(`/blog?view=quotes&author=${author}`);
    const { dead } = await rail(page);
    test.skip(dead.length === 0, 'this author used every subject in the taxonomy');

    // Inert in the markup is only half of it; the combination has to be empty in
    // fact, or disabling it hid a result rather than preventing a dead end.
    const slug = slugByName.get(dead[0].name);
    expect(slug, `no slug for the disabled tag "${dead[0].name}"`).toBeTruthy();
    await page.goto(`/blog?view=quotes&author=${author}&subject=${slug}`);
    expect(await feedTotal(page)).toBe(0);
  });

  test('an unknown author empties the rail, exactly as it empties the feed', async ({ page }) => {
    // `listQuotes` answers a slug no row carries with nothing rather than
    // ignoring it. A rail that ignored it instead would show a full taxonomy
    // over an empty feed — the two halves of one page disagreeing about what
    // was asked.
    await page.goto('/blog?view=quotes&author=nobody-has-this-slug');
    expect(await feedTotal(page)).toBe(0);
    const { live, dead } = await rail(page);
    expect(live).toHaveLength(0);
    expect(dead.length).toBeGreaterThan(0);
  });

  test('the writing view ignores an author it cannot apply', async ({ page }) => {
    // Only quotes carry an author row. Left ungated this drew the chip and
    // headed the feed "N essays by …" over a list filtered by nothing.
    await page.goto('/blog?author=nobody-has-this-slug');
    await expect(page.locator('#feed-list figure, #feed-list article').first()).toBeVisible();
    await expect(page.getByText('Who said it')).toHaveCount(0);
  });
});

test.describe('the chip that shows the filter', () => {
  test('it names the author and removes only that filter', async ({ page }) => {
    const author = await someAuthor(page);
    test.skip(!author, 'no quote on the feed offers an author door');
    await page.goto(`/blog?view=quotes&author=${author}`);
    const { live } = await rail(page);
    test.skip(live.length === 0, 'this author has no subjects to stack');

    await page.goto(`${live[0].href}`); // author + one subject
    const chip = page.locator('[data-author-chip]');
    await expect(chip).toBeVisible();

    // ✕ drops the person, KEEPS the subject: the rail's per-filter controls are
    // per-filter, and one that quietly cleared the others would be a "Clear"
    // wearing a chip's clothes.
    const href = await chip.getAttribute('href');
    expect(href).not.toContain('author=');
    expect(href).toContain('subject=');
  });
});
