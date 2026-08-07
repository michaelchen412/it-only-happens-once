// The theme toggle, after it stopped being implemented twice (plan 19 · §3).
//
// It existed in both layouts and the two copies disagreed. `AdminLayout` synced
// `aria-pressed` on load; `SiteLayout` set it ONLY inside its click handler — so
// on the public site the attribute was absent until you pressed the button, and
// absent again after every view transition replaced the DOM. Same control, same
// two themes, two implementations, one of them right.
//
// Signed out on purpose: the public site is the half that was broken, and it is
// also the half with the router, which is what made it stay broken. Read-only —
// the theme lives in localStorage and nothing here touches the database.
import { test, expect } from '@playwright/test';

const TOGGLE = '#theme-toggle';

test.describe('the toggle says which way it is pointing', () => {
  test('carries aria-pressed on first paint, before anything is clicked', async ({ page }) => {
    // ⚠ THE ORIGINAL BUG. The attribute was written only by the click handler,
    // so a reader arriving at the page was told nothing at all about the state
    // of a two-state control.
    await page.goto('/');
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-pressed', /^(true|false)$/);
  });

  test('tracks the theme, and both agree', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    const btn = page.locator(TOGGLE);

    const before = await html.getAttribute('data-theme');
    await btn.click();
    const after = await html.getAttribute('data-theme');
    expect(after, 'the theme actually changed').not.toBe(before);
    await expect(btn).toHaveAttribute('aria-pressed', String(after === 'paper'));

    await btn.click();
    await expect(html).toHaveAttribute('data-theme', before!);
    await expect(btn).toHaveAttribute('aria-pressed', String(before === 'paper'));
  });

  test('survives a view-transition navigation', async ({ page }) => {
    // ⚠ THE SECOND HALF OF THE BUG, and the reason a delegated listener alone
    // is not enough. The router swaps the whole body, so the incoming page's
    // button is a DIFFERENT element that arrives with whatever the server
    // rendered — which is no aria-pressed at all. Only a re-sync on
    // `astro:page-load` puts it back.
    await page.goto('/');
    await page.locator(TOGGLE).click();
    const chosen = await page.locator('html').getAttribute('data-theme');

    await page.locator('#site-menu a[href="/blog"]').click();
    await page.waitForURL('/blog');

    await expect(page.locator('html'), 'the theme itself persists').toHaveAttribute('data-theme', chosen!);
    await expect(page.locator(TOGGLE), 'and so does the button telling you so').toHaveAttribute(
      'aria-pressed',
      String(chosen === 'paper'),
    );
  });

  test('the choice persists across a full reload', async ({ page }) => {
    await page.goto('/');
    await page.locator(TOGGLE).click();
    const chosen = await page.locator('html').getAttribute('data-theme');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', chosen!);
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-pressed', String(chosen === 'paper'));
  });
});

test.describe('dark is the default, whatever the machine says', () => {
  // The pick used to be saved-choice → system-preference → dusk, so a reader on
  // a light OS met `paper` first. It is saved-choice → dusk now: this site was
  // drawn at dusk and light is the opt-in. See the note in `Base.astro`.
  test.use({ colorScheme: 'light' });

  test('a light machine, no saved choice, still lands on dusk', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dusk');
    await expect(page.locator(TOGGLE), 'and the toggle says so').toHaveAttribute('aria-pressed', 'false');
  });

  test('and the explicit choice still outranks it', async ({ page }) => {
    // The other direction of the same rule: the OS cannot force paper, but the
    // reader can, and a reload must not hand it back.
    await page.goto('/');
    await page.locator(TOGGLE).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  });
});

test.describe('the nav collapses at one breakpoint, not two', () => {
  // plan 19 · §7: the public nav collapsed at 640px while the Observatory's
  // sidebar collapsed at 768px, so 640–767px showed a desktop nav beside a
  // workshop still wearing a burger. Unified on `md:` (768px).
  test('burger at 767px, inline nav at 768px', async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 800 });
    await page.goto('/');
    await expect(page.locator('#menu-toggle'), 'a burger just below the line').toBeVisible();

    await page.setViewportSize({ width: 768, height: 800 });
    await expect(page.locator('#menu-toggle'), 'and none at it').toBeHidden();
    await expect(page.locator('#site-menu a[href="/blog"]')).toBeVisible();
  });
});
