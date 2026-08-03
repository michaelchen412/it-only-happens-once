// Today, and the move that made room for it (11 · Piece 0a + 0b, ADR-0015).
//
// TWO THINGS THIS FILE IS ACTUALLY FOR.
//
//  1. THE MOVE IS PURE CHURN, which is the most boring and most breakable kind
//     of change. `/admin` stopped being the Fragment Manager, and a web of deep
//     links pointed at it. The compiler cannot see a single one of them: a
//     stale `href` is a valid string, and a hash never reaches the server at
//     all. So the producers are asserted here, in a browser, following the
//     links rather than reading them.
//
//  2. TODAY'S DATE BAR IS THE FIRST HQ SURFACE, and every control on it is a
//     real link to `?date=YYYY-MM-DD`. That is worth proving rather than
//     assuming, because the prototype's version was built with `createElement`
//     and silently lost every style rule it had (10-hq.md §10h, trap 3).
//
// Read-only by construction, like the rest of the harness: this drives
// navigation and reads the DOM. Nothing here can write a row.
import { test, expect } from '@playwright/test';
import { fixtures } from './fixtures';

/** `YYYY-MM-DD` in a given IANA zone — the spec's own `localToday`. */
function localDate(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(at);
}

/** The zone Today is counting days in, read off the page's own note element. */
async function configuredZone(page: import('@playwright/test').Page): Promise<string> {
  const tz = await page.locator('#tz-note').getAttribute('data-tz');
  expect(tz, 'Today should publish the zone it is counting days in').toBeTruthy();
  return tz!;
}

test.describe('the move: /admin is Today, the manager is /admin/fragments', () => {
  test('the root is Today and carries no fragment table', async ({ page }) => {
    await page.goto('/admin');

    await expect(page.locator('.datebar')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Morning' })).toBeVisible();

    // The manager's own furniture must be absent — not merely "a different
    // page", but specifically not the table that used to live here.
    await expect(page.locator('.fpanel')).toHaveCount(0);
    await expect(page.locator('[data-type-filter]')).toHaveCount(0);
  });

  test('the manager still works at its new address', async ({ page }) => {
    await page.goto('/admin/fragments');
    await expect(page.locator('.fpanel')).toBeVisible();
    await expect(page.locator('[data-type-filter=""]')).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });

  // The reason Today does not import the sheets. This page is opened on a phone
  // every morning; TipTap is the single biggest thing the admin can load, and
  // it would be loaded to do nothing.
  test('Today does not mount the writing sheet', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('#wsheet')).toHaveCount(0);
    await expect(page.locator('#fsheet')).toHaveCount(0);

    // …and the bundle itself never arrives. Asserting on the DOM alone would
    // pass even if the editor were being downloaded and left unmounted.
    const scripts = await page.locator('script[src]').evaluateAll((els) =>
      els.map((e) => (e as HTMLScriptElement).src),
    );
    const editor = scripts.filter((s) => /tiptap|prosemirror/i.test(s));
    expect(editor, `Today pulled an editor bundle: ${editor.join(', ')}`).toHaveLength(0);
  });

  test('the sidebar offers both rooms, and marks which one you are in', async ({ page }) => {
    await page.goto('/admin');
    const nav = page.locator('#sidebar nav');
    await expect(nav.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/admin');
    await expect(nav.getByRole('link', { name: 'Fragments' })).toHaveAttribute('href', '/admin/fragments');
    await expect(nav.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', { name: 'Fragments' }).click();
    await expect(page).toHaveURL(/\/admin\/fragments$/);
    await expect(page.locator('#sidebar nav').getByRole('link', { name: 'Fragments' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('the building is the Observatory', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveTitle(/— Observatory$/);
    await expect(page.locator('#sidebar').getByText('Observatory')).toBeVisible();

    const manifest = await page.locator('link[rel=manifest]').getAttribute('href');
    const res = await page.request.get(manifest!);
    const m = await res.json();
    expect(m.name).toContain('Observatory');
    expect(m.short_name).toBe('Observatory');
    // `id` and `start_url` must NOT move, or an installed app forks into two.
    expect(m.id).toBe('/admin');
    expect(m.start_url).toBe('/admin');
  });
});

test.describe('the deep links survived the move', () => {
  // A hash never reaches the server, so `/admin` cannot 302 these without
  // dropping the fragment identifier. Every producer was updated instead, and
  // Today bounces whatever is already in a browser's history.
  test('#new-writing lands on the manager with the sheet open', async ({ page }) => {
    await page.goto('/admin#new-writing');
    await expect(page).toHaveURL('/admin/fragments#new-writing');
    await expect(page.locator('#wsheet')).toBeVisible();
  });

  test('#edit=<id> keeps the id across the bounce', async ({ page }) => {
    const { draftSlug } = fixtures();
    test.skip(!draftSlug, 'no unpublished essay exists to edit');

    // Get a real id the way the blog does — from the preview banner's edit link.
    await page.goto(`/blog/${draftSlug}`);
    const href = await page.getByRole('link', { name: 'Edit' }).getAttribute('href');
    expect(href, 'the blog preview must point at the manager, not the old root').toMatch(
      /^\/admin\/fragments#edit=/,
    );
    const id = href!.split('#edit=')[1];

    // …and the same link still works if it arrives at the OLD address.
    await page.goto(`/admin#edit=${id}`);
    await expect(page).toHaveURL(`/admin/fragments#edit=${id}`);
    await expect(page.locator('#wsheet')).toBeVisible();
  });

  test('the retired writing page redirects to the manager, not to Today', async ({ page }) => {
    await page.goto('/admin/writing/new');
    await expect(page).toHaveURL('/admin/fragments#new-writing');
    await expect(page.locator('#wsheet')).toBeVisible();
  });

  test('the bounce replaces rather than pushes, so Back does not loop', async ({ page }) => {
    await page.goto('/admin/fragments');
    await page.goto('/admin#new-writing');
    await expect(page).toHaveURL('/admin/fragments#new-writing');
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/fragments$/);
  });

  test('an ordinary visit to Today is not bounced anywhere', async ({ page }) => {
    // The guard on the guard: a bounce that fires too eagerly would make the
    // front door unreachable, which is a worse bug than a stale link.
    for (const url of ['/admin', '/admin#', '/admin#browse']) {
      await page.goto(url);
      await expect(page.locator('.datebar')).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/admin');
    }
  });
});

test.describe("the date bar is the page's control", () => {
  test('the header reads as the day you are standing on', async ({ page }) => {
    await page.goto('/admin');
    const tz = await configuredZone(page);
    const [y, m, d] = localDate(tz).split('-').map(Number);

    const header = await page.locator('[data-header-date]').textContent();
    // Ordinal, weekday, full month, four-digit year — and the day number must
    // be TODAY in the configured zone, not in the browser's and not in the
    // server's. That is the entire point of the settings row.
    expect(header).toMatch(/^\w+day, \w+ \d{1,2}(st|nd|rd|th), \d{4}$/);
    expect(header).toContain(String(y));
    expect(header).toMatch(new RegExp(`\\b${d}(st|nd|rd|th)\\b`));
    expect(new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' })).toBe(
      header!.split(', ')[1].split(' ')[0],
    );
  });

  test('the arrows step a day, and Today comes back', async ({ page }) => {
    await page.goto('/admin');
    const todayText = await page.locator('[data-header-date]').textContent();

    // On today there is nothing to go back to, so the chip is absent.
    await expect(page.locator('.datebar__back')).toHaveCount(0);

    // Assert against the link's OWN target rather than recomputing tomorrow
    // here: a spec that does its own date arithmetic is a second implementation
    // of the thing under test, and it disagrees on exactly the days that matter
    // (a 23- or 25-hour DST day). What is worth checking is that the header
    // moved and the URL is the one the control offered.
    const next = page.getByLabel('Next day');
    const href = await next.getAttribute('href');
    expect(href).toMatch(/^\/admin\?date=\d{4}-\d\d-\d\d$/);
    await next.click();
    await expect(page).toHaveURL(href!);
    await expect(page.locator('[data-header-date]')).not.toHaveText(todayText!);

    // Being on another day must never be ambiguous.
    const back = page.locator('.datebar__back');
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL('/admin');
    await expect(page.locator('[data-header-date]')).toHaveText(todayText!);
  });

  test('the month grid is server-rendered — 42 real links, before any script', async ({ page }) => {
    // The prototype built these with `createElement`, so Astro's scoped styles
    // never matched them and every hover, cursor and focus rule silently did
    // nothing. Rendering them as markup is the fix; this is the assertion that
    // keeps it.
    await page.goto('/admin');
    await page.locator('.datebar__date').click();

    const cells = page.locator('.cal__grid a');
    await expect(cells).toHaveCount(42);
    await expect(cells.first()).toHaveAttribute('href', /^\/admin\?date=\d{4}-\d\d-\d\d$/);

    // Exactly one today and one selection, and on an unmoved page they agree.
    await expect(page.locator('.cal__grid .is-today')).toHaveCount(1);
    await expect(page.locator('.cal__grid .is-sel')).toHaveCount(1);
    const tz = await configuredZone(page);
    await expect(page.locator('.cal__grid .is-today')).toHaveAttribute('href', `/admin?date=${localDate(tz)}`);

    // And the styles actually reach them, which is the thing that broke.
    await expect(page.locator('.cal__grid .is-sel')).toHaveCSS('cursor', 'pointer');
  });

  test('stepping a month keeps the calendar open and the day unchanged', async ({ page }) => {
    await page.goto('/admin');
    const tz = await configuredZone(page);
    const today = localDate(tz);

    const header = await page.locator('[data-header-date]').textContent();
    await page.locator('.datebar__date').click();
    const title = await page.locator('.cal__head span').textContent();
    await page.getByLabel('Previous month').click();

    // Open across the navigation, or stepping months would be unusable.
    await expect(page.locator('.cal__grid a').first()).toBeVisible();
    await expect(page.locator('.cal__head span')).not.toHaveText(title!);

    // LOOKING at another month is not BEING on another day — the header must
    // not have moved, and the `↩ Today` chip must not have appeared.
    await expect(page.locator('[data-header-date]')).toHaveText(header!);
    await expect(page).toHaveURL(new RegExp(`date=${today}`));
    await expect(page.locator('.datebar__back')).toHaveCount(0);
  });

  test('picking a day navigates to it and closes the calendar', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('.datebar__date').click();

    const cell = page.locator('.cal__grid a:not(.is-out):not(.is-sel)').first();
    const href = await cell.getAttribute('href');
    await cell.click();

    await expect(page).toHaveURL(href!);
    await expect(page.locator('.cal__grid a').first()).not.toBeVisible();
    await expect(page.locator('.datebar__back')).toBeVisible();
  });

  test('a nonsense ?date= falls back to today rather than rendering a fiction', async ({ page }) => {
    await page.goto('/admin');
    const today = await page.locator('[data-header-date]').textContent();

    // 31 February is the one to check: JS rolls impossible dates forward
    // silently, so without a round-trip check this page would happily title
    // itself "Tuesday, March 3rd".
    for (const junk of ['2026-02-31', 'yesterday', '2026-13-01', '']) {
      await page.goto(`/admin?date=${encodeURIComponent(junk)}`);
      await expect(page.locator('[data-header-date]')).toHaveText(today!);
      await expect(page.locator('.datebar__back')).toHaveCount(0);
    }
  });
});

test.describe('what Today does not claim', () => {
  // ⚠ RETIRED BY 13 · PIECE 5, and deliberately not deleted. This used to
  // assert that Today / Coming up / Practice / Past due were ABSENT and that
  // one sentence stood in their place — true from 2026-08-02 until the agenda
  // existed, and false the moment it did. The rule underneath is unchanged and
  // is now enforced from the other side, in `today-stack.spec.ts`: a domain
  // with nothing to say renders nothing, and a domain WITH something renders
  // rows — never an empty box either way (10-hq.md §10b).
  //
  // What survives here is the half that outlived the sentence: the page must
  // never carry a "no data" skeleton, whatever is or is not built.
  test('a zone is present with rows, or absent — never an empty skeleton', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText(/isn’t built yet/)).toHaveCount(0);

    for (const attr of ['[data-agenda-zone]', '[data-coming-up]', '[data-practice]', '[data-past-due]', '[data-people-zone]']) {
      const zone = page.locator(attr);
      if ((await zone.count()) === 0) continue;
      expect(await zone.locator('.row, .sig, .brf, .bw__row').count(), `${attr} is an empty box`).toBeGreaterThan(0);
    }
  });

  test('People renders only when it has something to say, and quietly when it does', async ({ page }) => {
    await page.goto('/admin');
    const zone = page.locator('[data-people-zone]');

    // The same rule from the other side: People has a source now, so it is
    // allowed on the page — but a brief-less, drift-less morning still gets no
    // zone at all rather than an empty one.
    if ((await zone.count()) === 0) {
      await expect(page.getByRole('heading', { name: 'People', exact: true })).toHaveCount(0);
    } else {
      await expect(zone.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
      // And what it says is never arrears: no badge, no count, no red.
      await expect(zone.locator('.u-now')).toHaveCount(0);
      await expect(zone.getByText('overdue', { exact: false })).toHaveCount(0);
    }
  });

  test('no control on the page does nothing when pressed', async ({ page }) => {
    await page.goto('/admin');
    // The global capture ✚ is deliberately ABSENT until the piece that wires
    // it, rather than present and inert — a button that does nothing when
    // pressed is the invented affordance the prototypes existed to catch.
    // (Start/Skip were in this assertion until the check-in shipped and made
    // them real; they are covered by checkin.spec.ts now.)
    await expect(page.locator('.fab')).toHaveCount(0);
  });

  test('the travel note is a note — it never moves the day', async ({ page }) => {
    await page.goto('/admin');
    const tz = await configuredZone(page);
    const note = page.locator('#tz-note');

    // The harness browser runs in the machine's zone. Whether the note shows is
    // therefore environment-dependent; what is NOT is that the header still
    // reads the configured zone's date either way.
    const shown = await note.isVisible();
    if (shown) {
      await expect(note).toContainText(tz);
    }
    const [, , d] = localDate(tz).split('-').map(Number);
    await expect(page.locator('[data-header-date]')).toContainText(`${d}`);
  });
});
