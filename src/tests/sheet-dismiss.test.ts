// Every sheet answers all three ways out (ADR 0032).
//
// ⚠ THIS TEST EXISTS BECAUSE THE CONVENTION FAILED SILENTLY, and it failed the
// way conventions do: not by being argued down, but by never being mentioned to
// the next file. The ✕, Escape and a press on the backdrop all mean *I want
// out*, and each one was wired by hand, per sheet, by whoever wrote it. On
// 2026-08-11 the audit that prompted this found the two corpus editors and the
// four dialogs answered all three, and **six HQ sheets plus the brand-new song
// sheet answered only the ✕** — clicking away did nothing at all.
//
// The split was not a decision. It was the order the files happened to be
// written in, which is exactly the class of drift a comment cannot hold and a
// test can. Same shape and same reason as `action-guard.test.ts` next door:
// when a rule has to be re-remembered at every new site, it needs a tripwire
// rather than a paragraph.
//
// ⚠ ONE BLIND SPOT, written down rather than pretended away. This matches TEXT.
// It asks *which sheets call `wireSheetDismiss` at all* — it cannot tell a
// correct policy from a careless one, and a `requestClose` that forgets to
// confirm will pass here. That is deliberate: the alternative is an AST rule
// deciding what counts as a sufficient guard, and the policies genuinely
// differ (the writing sheet parks unsaved words in a draft version before it
// even asks; a tag sheet has nothing to park). What this pins is that the
// question was ASKED.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));

/**
 * Client scripts that own a `<dialog>` the reader can be inside.
 *
 * Derived rather than listed: a file is in scope if it opens a modal, which is
 * the one thing every modal sheet must do and nothing else does. A tenth sheet
 * therefore joins this test by existing, which is the property a hand-maintained
 * list would not have.
 *
 * ⚠ THE MARKER MOVED ON 2026-08-15, AND THE CANARY BELOW IS WHY THAT WAS SAFE.
 * It used to be `.showModal()`. Then every sheet was converted to `openDialog()`
 * (scripts/dialog-close.ts) so its exit would animate on WebKit, and the literal
 * `.showModal()` survived in exactly one file — the helper that defines
 * `openDialog`. So this detector went on "working": it matched one file, the
 * wrong one, and would have reported a passing rule over nineteen unchecked
 * sheets. The `> 8` assertion in the first `it` is the only thing between that
 * and a green test suite guarding nothing, which is the entire argument for
 * writing a count assertion next to a derived list.
 */
function sheetScripts(): string[] {
  return (
    readdirSync(SCRIPTS)
      .filter((f) => f.endsWith('.ts'))
      // The helper itself is the definition, not a call site.
      .filter((f) => f !== 'dialog-close.ts')
      .filter((f) => readFileSync(join(SCRIPTS, f), 'utf8').includes('openDialog('))
  );
}

/**
 * Files that open a dialog but are NOT sheets in this sense, each with why.
 *
 * ⚠ THE BAR FOR THIS LIST IS "DISMISSING IT COSTS NOTHING AND IT SAYS SO", not
 * "it was inconvenient to wire". Every entry here is a surface where an
 * accidental outside click loses no work, because there is no work in it.
 */
const NOT_SHEETS: Record<string, string> = {
  'confirm-dialog.ts': 'IS the confirm — a sheet asks it, so it cannot ask one back. Dismiss = cancel.',
  'alt-dialog.ts': 'A single field on an image, and it commits on its own button. Nothing else is in it.',
  'link-dialog.ts': 'The rich editor’s link box, cancelled by Escape into the editor beneath it.',
  'capture.ts': 'FLUSHES on close — the thought is saved by dismissing it, so guarding would be backwards.',
  'notes.ts': 'The filer, which applies on choice; there is no pending state to lose.',
  'push.ts': 'A permission prompt, not an editor.',
  'writing-publish-dialog.ts': 'A confirmation over the writing sheet, which owns the words and the guard.',
  'versions-panel.ts': 'A reader over saved versions — nothing in it is unsaved by definition.',
  'proofread-locate.ts': 'A jump target, not an editor.',
  'rich-editor.ts':
    'Opens the LINK box, not a sheet — one URL field over an editor that keeps the selection either way.',
};

describe('every sheet answers all three ways out (ADR 0032)', () => {
  const files = sheetScripts();

  it('finds the sheets at all — a zero here means the detector broke, not that the rule holds', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files)('%s routes ✕ / Escape / backdrop through one exit', (file) => {
    const src = readFileSync(join(SCRIPTS, file), 'utf8');
    if (file in NOT_SHEETS && NOT_SHEETS[file]) return; // exempt, with its reason above
    expect(
      src.includes('wireSheetDismiss'),
      `${file} opens a modal but never calls wireSheetDismiss — so at least one of the ✕, ` +
        `Escape and the backdrop does nothing. Wire it, or add it to NOT_SHEETS with the ` +
        `sentence explaining why dismissing it costs nothing.`,
    ).toBe(true);
  });
});
