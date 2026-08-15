// Every segmented control a script reads is one the markup actually renders.
//
// ⚠ THIS EXISTS BECAUSE THE MISMATCH IS SILENT IN BOTH DIRECTIONS, and it cost
// a real bug that ran for as long as `goal-sheet.ts` has existed.
//
// `GoalSheet.astro` writes `data-goal-status`. The script asked for
// `group('goalStatus')` — because the old local helper needed the name twice,
// once for `querySelectorAll('[data-' + attr + ']')` and once for
// `el.dataset[attr]`, and those want opposite spellings of it. In an HTML
// document `[data-goalStatus]` is matched case-insensitively as
// `data-goalstatus`, an attribute nothing in this tree renders. So the group
// selected NOTHING:
//
//   · no click handler was bound, so the control could not be changed;
//   · `picked('goalStatus', 'active')` found no checked option and returned its
//     FALLBACK — on every save.
//
// Editing any goal therefore wrote `status: 'active'`, quietly reactivating one
// that had been paused, achieved or let go. And the sheet went on displaying the
// correct status the whole time, because that is server-rendered `aria-checked`
// — so the screen and the write disagreed, with nothing on either saying so.
//
// `radio-group.ts` now takes the attribute exactly as the markup spells it and
// never touches `dataset`, which removes the two-spellings problem at the root.
// This is the half that notices a plain typo, which no API can prevent.
//
// ⚠ WHAT IT DOES NOT CHECK, said plainly. It asks whether the attribute exists
// SOMEWHERE in the markup, not whether it exists in the same sheet the script
// reaches into. A control moved from one sheet to another would pass here. That
// is deliberate: the script→component mapping is by convention rather than by
// anything in the source, and a test that has to guess at it would be a test
// nobody trusts. The failure this catches is the one that actually happened.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, 'src', 'scripts');

/**
 * `options(form, 'effort')`, `pick(form, 'rep', …)`, `picked(form, 'unit', …)`.
 *
 * ⚠ THE CAPTURE ACCEPTS CAPITALS ON PURPOSE, and the first draft of this file
 * did not — which made it pass cleanly when tested against the very bug it was
 * written for. `[a-z][a-z0-9-]*` simply does not match `goalStatus`, so the
 * offending call was not captured, not checked, and silently fine. A tripwire
 * whose pattern cannot express the failure is a tripwire that reports success.
 */
const CALL = /\b(?:options|pick|picked)\(\s*[A-Za-z_$][\w$]*\s*,\s*'([A-Za-z][\w-]*)'/g;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(ts|astro)$/.test(e.name) ? [full] : [];
  });
}

/** Every attribute suffix named in a segmented-control call, and where. */
function used(): { attr: string; from: string }[] {
  const out = new Map<string, string>();
  for (const file of walk(SCRIPTS)) {
    for (const [, attr] of fs.readFileSync(file, 'utf8').matchAll(CALL)) {
      if (!out.has(attr)) out.set(attr, path.relative(ROOT, file));
    }
  }
  return [...out].map(([attr, from]) => ({ attr, from }));
}

/** The whole of `src/`, as one string — the markup could be anywhere in it. */
const markup = walk(path.join(ROOT, 'src'))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

describe('a segmented control a script reads is one the markup renders', () => {
  const attrs = used();

  it('found the calls at all', () => {
    // The vacuous-pass guard `comment-refs` and `e2e-read-only` both open with:
    // every assertion below is per-attribute, so a regex that stopped matching
    // would leave this file green while checking nothing. Seven distinct
    // attributes existed on 2026-08-15.
    expect(attrs.length).toBeGreaterThan(4);
  });

  it('never asks for one in camelCase, which HTML has no way to render', () => {
    // ⚠ THE SHARPER OF THE TWO RULES, and the one that catches the original bug
    // without needing to look at any markup at all. An HTML attribute name is
    // ASCII-lowercased by the parser, so `data-goalStatus` becomes
    // `data-goalstatus` — there is no markup anywhere that a capital could
    // correctly match. The camel spelling is the `dataset` key, which these
    // helpers deliberately never touch.
    const camel = attrs.filter(({ attr }) => /[A-Z]/.test(attr)).map(({ attr, from }) => `${attr}  ← in ${from}`);

    expect(
      camel,
      `A segmented control is named by its ATTRIBUTE, in the markup's own kebab-case — ` +
        `'goal-status', never 'goalStatus'. HTML lowercases attribute names, so a capital here ` +
        `can never match anything and the group will be silently empty:\n  ${camel.join('\n  ')}\n`,
    ).toEqual([]);
  });

  it('every attribute it asks for is one that exists in the markup', () => {
    const missing = attrs
      // `data-goal-status={…}` in an .astro file, `data-rep="…"` in a template
      // string. Anchored on a word boundary so `data-rep` does not match
      // `data-rep-panel`, which is a different attribute with its own meaning.
      .filter(({ attr }) => !new RegExp(`data-${attr}(?![\\w-])`).test(markup))
      .map(({ attr, from }) => `data-${attr}  ← asked for by ${from}`);

    expect(
      missing,
      `These scripts read a segmented control whose attribute nothing renders. The group will be ` +
        `empty, so the control cannot be changed and \`picked\` silently returns its fallback on ` +
        `every read:\n  ${missing.join('\n  ')}\n`,
    ).toEqual([]);
  });
});
