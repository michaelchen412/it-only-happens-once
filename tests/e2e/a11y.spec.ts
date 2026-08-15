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
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

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
  // ⚠ ADDED 2026-08-12, AND ITS ABSENCE IS THE REASON THIS FILE MISSED A DEFECT.
  // Plan 38 · §1.5 found the roster search focusing invisibly — a Level A
  // failure that plan 19 walked past while counting 45 tab stops, because the
  // list below was a list of rooms and the check above was a check of tab ORDER.
  // Two gaps, and only one of them was the room list. The room that was missing
  // here has since been retired and `/admin/sets` took its place in the nav, so
  // that is what this line covers now; the other three shells this file doesn't cover
  // (`constellations/[id]`, `people/[slug]`, `agenda/goals/[slug]`) need a real
  // id, so they need a fixture row rather than a line here.
  '/admin/sets',
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
      // ⚠ `page.evaluate`, NOT `page.locator('h1')`, AND THE REASON IS NOT
      // STYLE. Playwright's selector engine pierces shadow roots; Astro's dev
      // toolbar lives in one, and its audit panel contains four `<h1>`s of its
      // own — *"Audit"*, *"No islands detected."* and friends. So this went from
      // 35/35 green to ten rooms red without a line of page code changing,
      // purely because the toolbar had finished initialising by the time the
      // spec looked. `document.querySelectorAll` does not cross a shadow
      // boundary, which is what "the document outline" meant all along: the
      // headings the PAGE ships, not everything the browser happens to hold.
      const texts = await page.evaluate(() =>
        [...document.querySelectorAll('h1')].map((h) => (h.textContent ?? '').trim()),
      );
      expect(texts.length, `h1s found: ${JSON.stringify(texts)}`).toBe(1);
      expect(texts[0] ?? '', 'and it says something').not.toBe('');
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

test.describe('focus is visible where it lands', () => {
  // ⚠ THE CHECK THIS FILE DID NOT HAVE, and the gap is exactly the shape plan
  // 19 warned about in its own header: it counted 45 tab stops and reported
  // ZERO missing focus rings, because counting tab stops is not looking at
  // them. `hq.css`'s `.search input` cleared `outline` and put nothing back, so
  // tabbing into the roster search moved focus somewhere invisible — WCAG
  // 2.4.7, Level A, live the whole time on a room already in ROOMS above.
  //
  // WHAT IT ASSERTS IS "SOMETHING CHANGED", NOT "AN OUTLINE APPEARED", and the
  // looseness is deliberate. Four controls in `hq.css` answer focus by moving a
  // BORDER to `--color-primary` rather than by drawing a ring, and that is a
  // decision this codebase took on purpose (see `.search:focus-within`). A spec
  // demanding `outline-width > 0` would fail all four and teach the next reader
  // to undo them. Any of outline / border / box-shadow counts; nothing at all
  // does not.
  for (const route of ROOMS) {
    test(route, async ({ page }) => {
      await settle(page, route);
      const invisible = await page.evaluate(() => {
        const seen = (el: Element) => {
          const s = getComputedStyle(el);
          return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.borderColor, s.boxShadow].join('|');
        };
        const bad: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('input:not([type="hidden"]), textarea')) {
          if (el.hasAttribute('disabled') || el.offsetParent === null) continue;
          // The wrapper, because that is where four of this codebase's five
          // focus answers live — `.search`, `.logbox`, and anything using
          // `:focus-within`. Reading only the field would call those five blind.
          const box = el.parentElement ?? el;
          const before = seen(el) + '//' + seen(box);
          el.focus();
          const after = seen(el) + '//' + seen(box);
          if (before === after) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : '.' + el.className}`);
          el.blur();
        }
        return bad.slice(0, 12);
      });
      expect(invisible, `focused and nothing changed: ${JSON.stringify(invisible)}`).toEqual([]);
    });
  }
});

test.describe('the ✚ does not sit on the last row', () => {
  // `.cap-fab` is mounted from AdminLayout onto every admin page — fixed,
  // 3.5rem square, 1.25rem off the bottom — so it owns the bottom ~76px of the
  // right edge in every room. Seven rooms cleared it with `pb-24` and seven did
  // not, because the corpus rooms predate the ✚ (plan 38 · §1.3).
  //
  // ⚠ THIS EXISTS BECAUSE THE FINDING WAS MEASURED FROM THE CSS, NOT SEEN. The
  // plan's own hands item says so. A rule read off a stylesheet is a claim; an
  // overlap measured at the bottom of a scrolled page is the thing itself — and
  // the clearance now lives in ONE place, which is exactly the kind of single
  // point whose removal should go red rather than unnoticed.
  //
  // ⚠ 390px, AND THE VIEWPORT IS LOAD-BEARING — the first version of this spec
  // ran at the default 1280 and passed with the clearance DELETED, which is the
  // only reason it was caught. Every room centres its content in a `max-w-*`
  // container, so at 1280 the container spans x=128..1152 while the ✚ sits at
  // x≈1204..1260: the two never share a column and no amount of missing padding
  // can make them overlap. The defect is real and is a PHONE defect. A spec that
  // reproduces it has to stand where it happens.
  //
  // ⚠ AND IT IS DATA-DEPENDENT IN ONE DIRECTION, which is worth knowing before
  // trusting a green: a room with too little content to scroll cannot collide
  // with anything, so this proves "no overlap" and never "the padding is there".
  // It is a ratchet against regression in the rooms that are full, not a proof
  // about the empty ones.
  for (const route of ROOMS) {
    test(route, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await settle(page, route);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const collisions = await page.evaluate((sel) => {
        const fab = document.querySelector('.cap-fab');
        if (!fab) return ['no .cap-fab on the page at all'];
        const f = fab.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>(sel)]
          .filter((el) => !el.closest('[inert]') && !el.closest('dialog') && el.offsetParent !== null)
          .filter((el) => el !== fab && !fab.contains(el))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            // `position: fixed` peers share the viewport with the ✚ by design —
            // BackToTop is placed against it deliberately (hq.css `:has`).
            if (getComputedStyle(el).position === 'fixed') return false;
            return r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top;
          })
          .map(
            (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${el.textContent?.trim().slice(0, 20)}"`,
          )
          .slice(0, 8);
      }, FOCUSABLE);
      expect(collisions, `under the ✚ at the bottom of the page: ${JSON.stringify(collisions)}`).toEqual([]);
    });
  }
});

test.describe('an exclusive choice announces as one', () => {
  // ⚠ THE ROLE IS A PROMISE ABOUT BEHAVIOUR, NOT JUST A LABEL (plan 38 · §6.3).
  // Nine segmented controls were `role="group"` + `aria-pressed` — three
  // independent toggles that happen to look like one control, announcing no
  // position, no set size and no relationship. They are radio groups now, and a
  // radio group that does not answer arrow keys is worse than the honest
  // `role="group"` it replaced: it tells a screen-reader user to reach for a
  // key that does nothing.
  //
  // So this checks the whole contract rather than the attribute: every group has
  // radios, every radio says whether it is checked, and the group has exactly
  // ONE tab stop — which is the observable half of `scripts/radio-group.ts`
  // being wired at all.
  for (const route of ROOMS) {
    test(route, async ({ page }) => {
      await settle(page, route);
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        for (const g of document.querySelectorAll<HTMLElement>('[role="radiogroup"]')) {
          const name = g.getAttribute('aria-label') ?? g.id ?? '(unnamed)';
          const radios = [...g.querySelectorAll<HTMLElement>('[role="radio"]')];
          if (radios.length === 0) {
            out.push(`${name}: a radiogroup with no radios in it`);
            continue;
          }
          const unstated = radios.filter((r) => r.getAttribute('aria-checked') === null);
          if (unstated.length) out.push(`${name}: ${unstated.length} radio(s) with no aria-checked`);
          // A radio group is ONE tab stop. More means the roving tabindex never
          // ran; none means the group cannot be reached by keyboard at all.
          const stops = radios.filter((r) => r.tabIndex === 0).length;
          if (stops !== 1) out.push(`${name}: ${stops} tab stops, expected exactly 1`);
        }
        return out;
      });
      expect(bad, `radiogroups not keeping the promise the role makes: ${JSON.stringify(bad)}`).toEqual([]);
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
