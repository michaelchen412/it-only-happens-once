// Every dialog opens and closes through `scripts/dialog-close.ts` (ADR 0032's
// motion half).
//
// ⚠ THIS TEST EXISTS BECAUSE THE RULE ALREADY FAILED ONCE, QUIETLY, FOR FOUR
// DAYS. `closeWithExit` was written on 2026-08-11 with a 90-line header
// explaining that `dialog.close()` never animates on WebKit — so on any iPhone,
// Chrome included, a sheet vanishes in a single frame instead of sliding out.
// One dialog was converted (the public Reader). The workshop's other twenty
// were left calling `close()` directly, and `admin.css` even wrote the debt
// down: *"they have the same Safari/Firefox defect this fixes and the same
// one-line cure available."*
//
// Nobody read either comment. Michael, 2026-08-15, on a phone: *"the popovers,
// sheets, and dialogues on iOS and Chrome never close gracefully, no matter
// where we are. I don't know if this is something that can be addressed or if
// it's just a part of the jank that exists on this set of devices."* It was
// addressable, it had been addressed, and the fix had simply not been applied
// anywhere — which a comment is structurally unable to notice and this is.
//
// Same argument as `sheet-dismiss.test.ts` next door: when a rule has to be
// re-remembered at every new call site, it needs a tripwire rather than a
// paragraph. That file pins that a sheet ANSWERS dismissal; this one pins HOW.
//
// ⚠ ONE BLIND SPOT, written down rather than pretended away. `strip` below is a
// comment remover, not a parser, so a `//` inside a string literal takes the
// rest of that line with it. That can only ever HIDE a violation sharing a line
// with a URL, never invent one. The alternative is an AST pass to catch a case
// that has not occurred in 60 files, and the neighbouring test made the same
// trade for the same reason.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/** Every .ts/.astro file under src/, recursively, minus the tests themselves. */
function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'tests') sourceFiles(path, out);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.astro')) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Block and line comments out.
 *
 * This is the load-bearing half of the test rather than a nicety: these files
 * carry more prose than code, and the prose quotes the very call this forbids —
 * "`dialog.close()` here would be the obvious line and it is the one that made
 * this vanish on an iPhone". Scanning raw text would flag five explanations of
 * the rule as five breaches of it, and a test that cries wolf about its own
 * documentation gets deleted rather than obeyed.
 */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * `.close()` receivers that are NOT dialogs, each with why.
 *
 * ⚠ THE BAR IS "THIS OBJECT IS NOT AN HTMLDialogElement", not "wiring it was
 * inconvenient". A dialog belongs in `closeWithExit`, full stop — there is no
 * dialog anywhere for which snapping shut is the right exit.
 */
const NOT_DIALOGS: Record<string, string> = {
  bitmap: 'An ImageBitmap in scripts/upload.ts — `close()` releases its memory, nothing is on screen.',
  handle: 'The ShellHandle in scripts/browser-shell.ts, whose own `close()` calls closeWithExit.',
  // ⚠ THE SAME OBJECT UNDER THE NAME ITS CONSUMERS ACTUALLY USE. `handle` above
  // is what `browser-shell.ts` calls it INSIDE itself; every file that wires one
  // — fragment-browser, pair-browser, epigraph-browser — binds it as `shell`.
  // The epigraph picker is simply the first to close the drawer from a consumer
  // rather than from a dismissal, which is what surfaced the gap. Keyed by
  // receiver name, this list needs both spellings or it exempts the definition
  // and catches the call sites.
  shell:
    'A ShellHandle in a FragmentBrowser consumer — the same object as `handle`, whose `close()` calls closeWithExit.',
  ui: 'The Sheet from scripts/sheet.ts (plan 41 · §4), whose own `close()` resets the dirty tracker and then calls closeWithExit — same shape as `handle` above.',
};

/*
  ⚠ THREE NETS NEEDED WIDENING FOR ONE CHANGE, and the pattern is worth naming
  because it will happen again. `wireSheet` absorbed four call literals at once,
  and each was the marker some test used to find its subjects:

    · this file matched `.close(` — `ui.close()` reads as a raw dialog close;
    · `sheet-dismiss.test.ts` matched `openDialog(` to FIND sheets at all, so
      seven of them would have dropped out of the checked set while its count
      assertion passed on the dozen non-sheet dialogs left;
    · its own header already records the same thing happening in 2026-08-15,
      when the marker moved from `.showModal()` to `openDialog()`.

  A detector that keys on a literal is a detector that a good refactor silently
  narrows. The habit that catches it: after moving a call behind a helper, grep
  the tests for the literal you just moved.
*/

/** `dialog-close.ts` IS the exit — it is the definition, not a call site. */
const OWNER = 'dialog-close.ts';

describe('every dialog opens and closes through dialog-close.ts', () => {
  const files = sourceFiles();

  it('finds the source tree at all — a zero here means the walker broke, not that the rule holds', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('nothing calls showModal() directly — openDialog() is the door', () => {
    const bad = files
      .filter((f) => !f.endsWith(OWNER))
      .filter((f) => strip(readFileSync(f, 'utf8')).includes('.showModal('))
      .map((f) => f.slice(SRC.length));
    expect(
      bad,
      `showModal() bypasses openDialog(), so a sheet reopened during its own exit animation ` +
        `either throws InvalidStateError or shuts itself 300ms later. Import openDialog from ` +
        `scripts/dialog-close.ts instead.`,
    ).toEqual([]);
  });

  it('nothing calls close() on a dialog directly — closeWithExit() is the exit', () => {
    const bad: string[] = [];
    for (const file of files) {
      if (file.endsWith(OWNER)) continue;
      for (const [, receiver] of strip(readFileSync(file, 'utf8')).matchAll(
        /([A-Za-z_$][A-Za-z0-9_$]*)[!?]?\.close\(/g,
      )) {
        if (receiver in NOT_DIALOGS) continue;
        bad.push(`${file.slice(SRC.length)} — ${receiver}.close()`);
      }
    }
    expect(
      bad,
      `close() removes a dialog from the top layer in the same frame, and the ` +
        `\`overlay\` property that would defer it is Chromium-only — so on every iOS browser ` +
        `the exit animation never renders at all. Use closeWithExit() from ` +
        `scripts/dialog-close.ts, or add the receiver to NOT_DIALOGS with the sentence ` +
        `explaining what it is instead.`,
    ).toEqual([]);
  });
});
