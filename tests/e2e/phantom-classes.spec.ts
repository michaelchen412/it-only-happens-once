// Classes that style nothing (2026-08-21).
//
// ⚠ THIS FILE EXISTS BECAUSE `.navb` SHIPPED AND NOTHING NOTICED. The
// calendar's two step arrows carried `class="navb"` for as long as the calendar
// has existed — referenced in one file, DEFINED IN NONE — so they had no size,
// no hit area, no hover and no colour, and were two bare glyphs sitting in the
// text flow. Every spec about those links passed the whole time, because a
// phantom class renders perfectly: there is no error, no warning, and no
// assertion about a link that a missing class can fail.
//
// A scan of the building then found two more of the same kind:
//
//   · `chip--off`  the `draft` badge on the notes list — the only thing
//                  separating a draft from a published piece there
//   · `row__mark`  the mark beside an inactive goal, unmuted while every other
//                  icon in HQ is at 0.6
//
// ⚠ AND THE REASON ALL THREE WERE INVISIBLE IS THE THING THIS FILE ACTUALLY
// GUARDS. An unstyled class is NORMAL here: `cn-*`, `fb-*`, `lib-*`, `link-*`
// and friends are `querySelector` hooks with no CSS by design. So a styling
// class that lost its rule looks exactly like a JS hook doing its job, and the
// eye slides off it. The allowlist below is what separates the two — a hook has
// to be NAMED to be allowed, which makes each one a decision, and anything new
// and unstyled fails here instead of shipping.
//
// WHEN THIS GOES RED, the question is which kind you added. A styling class →
// write the rule. A JS hook → prefer `data-*`, which is this building's
// convention for exactly this (`data-tag`, `data-dispose`, `data-edit-event`)
// and cannot ever be mistaken for styling. Only add to the list below if
// neither is possible.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Classes deliberately carrying no CSS.
 *
 * ⚠ EVERY ENTRY IS A `querySelector` HOOK that predates the `data-*`
 * convention. This list should SHRINK. Nothing should be added to it that
 * could have been a `data-` attribute instead.
 */
const HOOKS = new Set([
  // Third-party, rendered by TipTap/ProseMirror rather than by us.
  'tiptap',
  'ProseMirror-trailingBreak',
  // The rich editor's dialogs.
  'link-dialog',
  'link-url',
  'link-remove',
  'link-cancel',
  'link-apply',
  'alt-text',
  'alt-skip',
  'alt-apply',
  // The fragment manager, its filters and its pickers.
  'fpanel',
  'fpanel-filters',
  'fpanel-sort',
  'fpanel-type',
  'fpanel-list',
  'fragment-row',
  'sby-check',
  'sby-status',
  'ep-check',
  'tag-check',
  'cn-picker',
  'cn-list',
  'cn-row',
  'cn-check',
  'cn-open',
  'cn-none',
  'cn-footer',
  'cn-new-btn',
  'cn-new-form',
  'cn-new-name',
  'cn-new-cancel',
  'cn-new-save',
  'cn-picker-status',
  // The fragment browser, shared by the manager and Sets.
  'fbrowser',
  'fb-cname',
  'fb-cdesc',
  'fb-error',
  'fb-panel',
  'fb-createbar',
  'fb-create',
  'fb-create-term',
  // The library's inline editor.
  'lib-row',
  'lib-save',
  'lib-delete',
  // The filter field's empty state — it takes its look from `admin-hint`.
  'ff',
  'ff__none',
  // A BEM block that is a grouping element only; every rule is on its children.
  'month',
]);

const ROUTES = [
  '/admin',
  '/admin/agenda?date=2026-12-01&day=2026-12-25',
  '/admin/agenda?view=week',
  '/admin/agenda/tasks',
  '/admin/agenda/goals',
  '/admin/people',
  '/admin/notes',
  '/admin/fragments',
  '/admin/sets',
  '/admin/constellations',
  '/admin/library',
];

/** Every class on the page that no loaded stylesheet rule mentions. */
async function unstyled(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selectors: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        const any = rule as CSSStyleRule & { cssRules?: CSSRuleList };
        if (any.selectorText) selectors.push(any.selectorText);
        if (any.cssRules) walk(any.cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules);
      } catch {
        /* cross-origin */
      }
    }
    const all = selectors.join('\n');
    const used = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('[class]'))) {
      for (const c of Array.from(el.classList)) used.add(c);
    }
    // ⚠ MATCHED AS `CSS.escape` WRITES IT, then required to end at a class
    // boundary. Tailwind's variants and arbitrary values are escaped in the
    // selector (`.focus\:top-3`, `.max-h-\[24vh\]`), so a naive `\.[\w-]+`
    // regex reports several hundred false positives; and without the boundary
    // `.ev` would be satisfied by `.ev--holiday`.
    return [...used].filter((c) => {
      const lit = '.' + CSS.escape(c);
      return !new RegExp(lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])').test(all);
    });
  });
}

test('⚠ no class in the building styles nothing without being named a hook', async ({ page }) => {
  const found = new Map<string, string[]>();
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    for (const cls of await unstyled(page)) {
      if (HOOKS.has(cls)) continue;
      found.set(cls, [...(found.get(cls) ?? []), route]);
    }
  }
  const report = [...found.entries()].map(([c, rs]) => `  .${c}  on  ${rs.join(', ')}`).join('\n');
  expect(report, `Classes with no CSS rule and not on the hook allowlist:\n${report}`).toBe('');
});
