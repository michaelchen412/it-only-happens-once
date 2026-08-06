// The audit, turned into a ratchet (plan 19 · "The harness is worth keeping").
//
// Every finding in plan 19 was a NUMBER, and every number came from a script
// that could run again — but the script was in /tmp and would have been gone by
// morning. That is the difference between a snapshot and a guard: without this
// file, the next room built from the same chair reintroduces the same faults and
// waits for the next audit to notice. With it, the run goes red.
//
// ⚠ WHAT THIS IS NOT. It is chromium at a narrow viewport, not Safari on a
// phone — the caveat `playwright.config.ts` writes about itself. It catches
// structure: tab order, overflow, accessible names, document outline. It cannot
// catch thumbs, hit feel, or the iOS keyboard, and plan 19 · §6 in particular
// still owes a walkthrough on real hardware.
//
// Read-only by construction: every route here is a GET, and nothing is clicked.
import { test, expect, type Page } from '@playwright/test';

/** Every room in the Observatory. The point is that a new room added without
 *  its own spec is still covered by this one. */
const ROOMS = [
  '/admin',
  '/admin/people',
  '/admin/agenda',
  '/admin/agenda/tasks',
  '/admin/agenda/goals',
  '/admin/notes',
  '/admin/fragments',
  '/admin/constellations',
  '/admin/library',
  '/admin/about',
];

const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

async function settle(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main')).toBeVisible();
}

test.describe('the document outline', () => {
  // A room with no <h1> presents to a screen reader — and to anyone navigating
  // by heading — as an undifferentiated pile of links. `/admin` and
  // `/admin/about` both measured ZERO before 2026-08-05.
  for (const route of ROOMS) {
    test(`${route} has exactly one h1`, async ({ page }) => {
      await settle(page, route);
      const h1s = page.locator('h1');
      const texts = await h1s.allTextContents();
      expect(await h1s.count(), `h1s found: ${JSON.stringify(texts)}`).toBe(1);
      expect((texts[0] ?? '').trim(), 'and it says something').not.toBe('');
    });
  }
});

test.describe('nothing tabbable is off screen', () => {
  // ⚠ THE ONE THIS FILE WAS WRITTEN FOR. The admin drawer closes by transform,
  // which hides it from the eye and from nobody else. Before the `inert` fix,
  // all ten rooms had THIRTEEN controls at x=-228..-13, still in the tab order
  // and still first — so Tab on a phone walked into an invisible menu.
  //
  // Deliberately measured at 390px AND at desktop width: the same <aside> is
  // the permanent sidebar above 768px, and an `inert` that forgot the viewport
  // would pass the phone check by breaking the desktop one.
  for (const route of ROOMS) {
    test(`${route} at 390px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await settle(page, route);
      const offscreen = await page.evaluate((sel) => {
        return (
          [...document.querySelectorAll<HTMLElement>(sel)]
            .filter((el) => !el.hasAttribute('disabled'))
            // ⚠ `inert` does NOT remove elements from querySelectorAll — it only
            // takes them out of the tab order and the a11y tree. Without this the
            // spec re-reports the very drawer the fix just neutralised, which is
            // exactly how it failed the first time it was run.
            .filter((el) => !el.closest('[inert]'))
            // A zero-size box is a closed <dialog>'s contents or a `display:none`
            // branch: not rendered, not tabbable, and not what this measures.
            // Every sheet in the workshop would otherwise report here.
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            })
            .map((el) => ({
              x: Math.round(el.getBoundingClientRect().right),
              label: el.textContent?.trim().slice(0, 24),
            }))
            .filter((c) => c.x < 1)
        );
      }, FOCUSABLE);
      expect(offscreen, `off-screen but tabbable: ${JSON.stringify(offscreen)}`).toEqual([]);
    });
  }

  test('the desktop sidebar is NOT inert', async ({ page }) => {
    // The other half of width-aware. If this fails, `inert` is tracking the
    // open flag alone and the real sidebar has been taken out of the tab order
    // on every desktop page — a fix that traded one bug for a worse one.
    await page.setViewportSize({ width: 1280, height: 800 });
    await settle(page, '/admin');
    await expect(page.locator('#sidebar')).not.toHaveAttribute('inert', /.*/);
    await expect(page.locator('#sidebar a[href="/admin/people"]')).toBeVisible();
  });
});

test.describe('no horizontal overflow', () => {
  // 320px is an iPhone SE / small Android and is the width plan 19 found
  // `/admin/fragments` failing at — `scrollWidth` 331 against a 320 viewport.
  for (const width of [320, 390, 768]) {
    test(`every room at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const bad: string[] = [];
      for (const route of ROOMS) {
        await settle(page, route);
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (over > 0) bad.push(`${route} (+${over}px)`);
      }
      expect(bad, 'rooms scrolling sideways').toEqual([]);
    });
  }
});

test.describe('every control says what it is', () => {
  // A button whose only content is an icon reads as "button" and nothing else.
  // The workshop is icon-dense by design, so this is the check that keeps that
  // density affordable.
  for (const route of ROOMS) {
    test(route, async ({ page }) => {
      await settle(page, route);
      const unnamed = await page.evaluate((sel) => {
        const named = (el: HTMLElement): boolean => {
          if (el.getAttribute('aria-label')?.trim()) return true;
          if (el.getAttribute('title')?.trim()) return true;
          if (el.textContent?.trim()) return true;
          const id = el.getAttribute('aria-labelledby');
          if (id && document.getElementById(id)?.textContent?.trim()) return true;
          if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
            if (el.labels?.length) return true;
            if (el.getAttribute('placeholder')?.trim()) return true;
          }
          // an <img>/<svg> child can carry the name
          return !!el.querySelector('img[alt]:not([alt=""])');
        };
        return [...document.querySelectorAll<HTMLElement>(sel)]
          .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
          .filter((el) => !named(el))
          .map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${el.className}`.slice(0, 70));
      }, FOCUSABLE);
      expect(unnamed, `controls with no accessible name: ${JSON.stringify(unnamed)}`).toEqual([]);
    });
  }
});
