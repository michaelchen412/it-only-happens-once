// The click lands first — docs/plans/24 · Piece 1.
//
// This is the spec for a control whose entire job happens in the frame after a
// click and is gone a second later, on a page that then gets REPLACED. Almost
// every obvious way to test it is wrong, so the two techniques are written down:
//
//   1. Read the state SYNCHRONOUSLY at click time, inside one `page.evaluate`.
//      A normal Playwright assertion auto-waits for the navigation to settle, so
//      it can never observe the frame this control exists for. (First attempt
//      did exactly that and failed with "waiting for navigation to finish".)
//   2. Never `await` across a real click. The navigation destroys the execution
//      context and `evaluate` dies mid-function. Where a later frame is needed,
//      set the attribute by hand instead — that is what the script does anyway,
//      and it isolates the CSS from the script.
import { test, expect } from '@playwright/test';

test('the bar and the pending row answer on the frame of the click', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.locator('#nav-progress')).toHaveCount(1);

  const s = await page.evaluate(() => {
    const a = document.querySelector<HTMLAnchorElement>('#sidebar nav a[href="/admin/people"]')!;
    const before = document.getElementById('nav-progress')!.className;
    a.click(); // the delegated listener runs synchronously, before the navigation task
    const bar = document.getElementById('nav-progress')!;
    return {
      before,
      after: bar.className,
      opacity: getComputedStyle(bar).opacity,
      busy: document.getElementById('admin-main')!.getAttribute('aria-busy'),
      pendingHref: document.querySelector('[data-nav-pending]')?.getAttribute('href') ?? null,
      pendingCount: document.querySelectorAll('[data-nav-pending]').length,
      todayStillCurrent: document.getElementById('nav-today')!.getAttribute('aria-current'),
    };
  });

  expect(s.before).not.toContain('is-active'); // quiet before
  expect(s.after).toContain('is-active'); // ...answering on the same frame
  expect(s.opacity).toBe('1');
  expect(s.busy).toBe('true');
  expect(s.pendingHref).toBe('/admin/people');
  expect(s.pendingCount).toBe(1); // exactly one row claims it
  // ⚠ `aria-current` stays on the page you are actually still on. Only the paint
  // runs ahead of the truth; the accessibility tree does not.
  expect(s.todayStillCurrent).toBe('page');

  await page.waitForURL('**/admin/people');
  await expect(page.locator('#nav-progress')).not.toHaveClass(/is-active/);
});

test('the highlight MOVES — the old active row gives up its tint', async ({ page }) => {
  await page.goto('/admin');

  // ⚠ READ AFTER THE TRANSITION, and this is the trap that cost a debugging
  // round. The nav rows carry `transition-colors` (150ms, already there for
  // hover), so `getComputedStyle` at t=0 returns the crossfade's START value —
  // the row still looks active for one frame. Reading immediately reports a
  // failure that is not real.
  const s = await page.evaluate(async () => {
    const a = document.querySelector<HTMLAnchorElement>('#sidebar nav a[href="/admin/people"]')!;
    const today = document.getElementById('nav-today')!;
    a.setAttribute('data-nav-pending', ''); // what the script does, without navigating
    await new Promise((r) => setTimeout(r, 400)); // past the 150ms crossfade
    return {
      pendingBg: getComputedStyle(a).backgroundColor,
      todayBg: getComputedStyle(today).backgroundColor,
      todayWeight: getComputedStyle(today).fontWeight,
    };
  });

  expect(s.pendingBg).not.toBe('rgba(0, 0, 0, 0)'); // the row you pressed is lit
  expect(s.todayBg).toBe('rgba(0, 0, 0, 0)'); // ...and the one you left is not
  expect(s.todayWeight).toBe('400');
});

test('it stays quiet for clicks that do not replace the document', async ({ page }) => {
  await page.goto('/admin');

  const out = await page.evaluate(() => {
    const bar = document.getElementById('nav-progress')!;
    const res: Record<string, string> = {};
    const mk = (attrs: Record<string, string>) => {
      const a = document.createElement('a');
      for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
      document.body.appendChild(a);
      return a;
    };
    const fire = (a: HTMLAnchorElement, init: MouseEventInit = {}) => {
      bar.classList.remove('is-active');
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
      return bar.className;
    };
    // Every one of these is a real link in this tree, not a hypothetical.
    res.download = fire(mk({ href: '/admin/export.json', download: '' })); // the Library export
    res.newTab = fire(mk({ href: '/admin/people', target: '_blank' })); // five View ↗ controls
    res.external = fire(mk({ href: 'https://example.com/' }));
    res.mailto = fire(mk({ href: 'mailto:a@b.c' }));
    res.samePageHash = fire(mk({ href: location.pathname + '#x' }));
    res.metaKey = fire(mk({ href: '/admin/library' }), { metaKey: true });
    res.middleClick = fire(mk({ href: '/admin/library' }), { button: 1 });
    res.plainInternal = fire(mk({ href: '/admin/library' })); // the control case
    return res;
  });

  for (const k of ['download', 'newTab', 'external', 'mailto', 'samePageHash', 'metaKey', 'middleClick']) {
    expect(out[k], `${k} must not start the bar`).not.toContain('is-active');
  }
  expect(out.plainInternal, 'a plain internal link must start the bar').toContain('is-active');
});

// 24 · Pieces 2 and 8 — the rooms whose reads were parallelised, and the day
// that middleware now resolves from a cached zone and verified claims.
test('the rooms still render, the day still resolves, and admin stays no-store', async ({ page }) => {
  for (const path of ['/admin', '/admin/people', '/admin/agenda', '/admin/library']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    expect(await page.locator('#hq').getAttribute('data-today'), path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await page.locator('#hq').getAttribute('data-tz'), path).toBeTruthy();
    // ⚠ 24 deliberately did NOT touch this header — see the plan's § open question.
    expect(res?.headers()['cache-control'], path).toBe('no-store');
  }
  // Piece 8b: the identity the chrome renders now comes from verified claims.
  await expect(page.locator('#sidebar').getByText('@')).toBeVisible();
});
