// The tripwire for the rule `<ClientRouter />` imposes on every admin script
// (plan 24 · §9; `scripts/page.ts` carries the argument).
//
// ⚠ THIS CLASS OF BUG IS INVISIBLE TO EVERYTHING ELSE IN `verify`. A listener
// bound to an element that the router threw away still typechecks, still lints,
// and still passes every unit test — the failure is a button that has quietly
// stopped being a button, with nothing in the console. The e2e half is
// `tests/e2e/walk.spec.ts`, which navigates by CLICKING and arrives twice; this
// half is the cheap, fast statement of the same rule, so a new script cannot opt
// out of it without one of the two going red.
//
// ── THE TWO HALVES OF THE RULE ─────────────────────────────────────────────
//
//   1. an admin script's DOM work runs inside `onPage`, so it re-runs on every
//      arrival rather than once per document
//   2. a listener on `document` or `window` inside a boot goes through
//      `page.on`, so it is taken off again on the way out
//
// The second matters more. Element listeners DIE on a swap, which is visible the
// moment anybody presses the thing. Document listeners ACCUMULATE, which is
// invisible until the second copy fires — one press filing a note twice, opening
// two dialogs, sending two writes.
//
// ⚠ THE EXEMPTIONS ARE NAMED RATHER THAN INFERRED, and each one has to say what
// makes it safe. "It looked fine" is how the list grows until it means nothing.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = new URL('../scripts/', import.meta.url);
const src = (f: string) => readFileSync(new URL(f, DIR), 'utf8');

/**
 * Scripts the Observatory loads — the ones the router's swap can reach.
 *
 * Collected from the admin pages and admin components rather than listed by
 * hand, so a script added to a room next month is covered without anybody
 * remembering to add it here.
 */
function adminScripts(): string[] {
  const roots = [new URL('../pages/admin/', import.meta.url), new URL('../components/admin/', import.meta.url)];
  const found = new Set<string>();
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(at);
      else if (entry.name.endsWith('.astro')) {
        for (const m of readFileSync(at, 'utf8').matchAll(/import '(?:\.\.\/)+scripts\/([a-z-]+)'/g)) {
          found.add(m[1] + '.ts');
        }
      }
    }
  };
  // AdminLayout is not under either root and mounts the widest-reaching ones.
  for (const m of readFileSync(new URL('../layouts/AdminLayout.astro', import.meta.url), 'utf8').matchAll(
    /import '\.\.\/scripts\/([a-z-]+)'/g,
  )) {
    found.add(m[1] + '.ts');
  }
  roots.forEach(walk);
  return [...found].sort();
}

/**
 * Scripts that legitimately do no per-arrival work, each with the reason.
 *
 * ⚠ THE REASON IS THE POINT. Every entry here is a claim that the file binds
 * only to things a swap does not destroy; if that stops being true the file
 * belongs in `onPage` and the line belongs deleted.
 */
const EXEMPT: Record<string, string> = {
  'nav-progress.ts':
    'binds only to document and window, and already listens for astro:page-load — ' +
    'it was written in anticipation of this migration six weeks early',
  'keyboard-inset.ts':
    'binds only to window.visualViewport and writes to documentElement; ' +
    'both outlive the swap, so there is nothing to re-find',
  'entity-combo.ts': 'a custom element — the browser upgrades new instances itself on every swap',
  'subject-filter.ts': 'a custom element, same as entity-combo',
  'capture.ts':
    'its dialog carries transition:persist, so the element TRAVELS across the swap ' +
    'with its listeners and its mounted editor — re-booting would re-mount 512 KB of TipTap ' +
    'on every navigation (see CaptureDialog.astro)',
};

describe('every admin script survives being walked back into', () => {
  const scripts = adminScripts();

  it('finds the scripts to check at all', () => {
    // A guard on the guard: if the scrape breaks, every test below passes
    // vacuously and the rule quietly stops being enforced.
    expect(scripts.length).toBeGreaterThan(20);
    expect(scripts).toContain('notes.ts');
    expect(scripts).toContain('capture.ts');
  });

  it.each(adminScripts())('%s runs its DOM work on every arrival', (file) => {
    if (EXEMPT[file]) return;
    const code = src(file);
    // A script with no DOM work at all has nothing to re-run.
    if (!/document\.(getElementById|querySelector)/.test(code)) return;
    expect(
      code.includes('onPage('),
      `${file} looks up elements but never calls onPage.\n` +
        'Under <ClientRouter /> a module runs once per DOCUMENT, so this binds to\n' +
        'elements the first arrival had and is dead on every arrival after.\n' +
        'Wrap its body in onPage from ./page — or add it to EXEMPT with the reason.',
    ).toBe(true);
  });

  it.each(adminScripts())('%s scopes its document and window listeners', (file) => {
    if (EXEMPT[file]) return;
    const code = src(file);
    if (!code.includes('onPage(')) return;
    /*
      ⚠ MATCHED ON TEXT, so a listener reached through an alias is invisible
      here — the same blind spot `action-guard.test.ts` names about itself, and
      acceptable for the same reason: the failure this guards is somebody typing
      the obvious `document.addEventListener` inside a boot, which is exactly
      what all 22 of the migrated sites looked like.
    */
    const bare = [...code.matchAll(/^\s*(document|window)\.addEventListener\(/gm)].map((m) => m[0].trim());
    expect(
      bare,
      `${file} registers a listener on ${bare[0]?.split('.')[0] ?? 'document'} without page.on.\n` +
        'document and window SURVIVE the swap, so this adds a second copy on every\n' +
        'arrival — N listeners after N visits, and one press does the work N times.\n' +
        'Use page.on(document, …) so it is removed again on the way out.',
    ).toEqual([]);
  });
});

describe('page.ts itself', () => {
  it('⚠ never calls its own boot directly beside the listener', () => {
    /*
      `astro:page-load` fires on the initial document load as well as on every
      navigation. Calling `boot()` beside the registration — the obvious-looking
      "run it now, and again later" — would double every binding on the very
      first page: the accumulate bug, introduced by the thing written to fix it.
    */
    const code = src('page.ts');
    expect(/^\s*boot\(\);/m.test(code)).toBe(false);
    expect(code).toContain("addEventListener('astro:page-load'");
  });
});
