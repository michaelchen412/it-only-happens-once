// The tripwire for the one rule `mini-editor-lazy.ts` exists to hold:
// **nothing mounted on every admin page may `import` TipTap statically.**
//
// ⚠ THIS TEST EXISTS BECAUSE A COMMENT DID NOT WORK — TWICE, and the second
// time cost Michael a slow room for two and a half weeks.
//
// `rich-editor` is **512 KB raw / 171 KB gzipped**, far the largest chunk this
// site ships. `capture.ts` measured that on 2026-08-07, moved the ✚ behind an
// `import()`, and wrote a long header naming the eight rooms that had been
// parsing an editor nobody had opened. Then:
//
//   · plan 46 gave the pile a drawer with a real editor and reached for the
//     static import again — so /admin/notes pulled the whole chunk on the
//     critical path of every load, for an editor behind a closed dialog;
//   · TaskSheet, EventSheet and LogSheet had never stopped, and the pile mounts
//     all three, so it arrived by four routes at once.
//
// Michael, 2026-09-18: *"a lot of these actions on the notes page seem to take
// a long time? some jank or inefficiency?"* — measured at 563 KB of
// critical-path JS for that room, against 51 KB after.
//
// A rule carried only by a comment in the file you are NOT editing is not a
// rule. This is what stops the third time.
//
// ⚠ WHAT THIS MATCHES, AND ITS ONE BLIND SPOT. It matches the TEXT of a static
// import, so it cannot see an editor reached through a re-export. That is
// acceptable: there is no such re-export today, and the failure it guards is
// somebody typing the obvious import at the top of a new sheet — which is
// exactly what happened both previous times.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = (f: string) => readFileSync(new URL(`../scripts/${f}`, import.meta.url), 'utf8');

/** A static `import … from './rich-editor'` — the thing that costs 512 KB. */
const STATIC = /^\s*import\s+(?!type\b)[^;]*from\s+['"]\.\/rich-editor['"]/m;

/**
 * Scripts mounted by a surface that many rooms carry, where an editor is behind
 * a control most page views never touch.
 *
 * ⚠ THE PILE MOUNTS THE FIRST FOUR AT ONCE, which is why they are listed
 * together rather than reasoned about one at a time: any single one of them
 * reverting puts the whole chunk back on /admin/notes' critical path, and the
 * other three being lazy buys nothing at all.
 */
const MUST_BE_LAZY = [
  'notes.ts', // the pile's drawer
  'task-sheet.ts', // mounted by the pile AND the agenda AND today
  'event-sheet.ts', // mounted by the pile AND the calendar
  'log-sheet.ts', // mounted by the pile
  'log-box.ts', // every person's profile
  'capture.ts', // the ✚ — mounted by AdminLayout on EVERY admin page
];

describe('the editor is never on the critical path of a room that might not want it', () => {
  it.each(MUST_BE_LAZY)('%s reaches rich-editor through import(), not a static import', (file) => {
    const code = src(file);
    expect(
      STATIC.test(code),
      `${file} statically imports rich-editor (512 KB raw / 171 KB gzipped).\n` +
        "Use `lazyMiniEditor` from './mini-editor-lazy', or an `import()` behind a warm-up —\n" +
        "see that file's header for why, and capture.ts for the pattern.",
    ).toBe(false);
    // …and it must actually reach it somehow, or this test is passing because
    // the file stopped using an editor and the assertion above went vacuous.
    expect(/rich-editor|mini-editor-lazy/.test(code), `${file} no longer references an editor at all`).toBe(true);
  });

  it('⚠ each one also WARMS, so the laziness is not paid for at the first press', () => {
    // `lazyMiniEditor` alone would move the whole parse onto the click that
    // opens the sheet — the exact trade capture.ts refuses. The bargain is: off
    // the critical path, resident before it is wanted.
    for (const file of MUST_BE_LAZY) {
      const code = src(file);
      expect(
        /warmOnIdle|requestIdleCallback/.test(code),
        `${file} defers the editor but never warms it — the parse just moved onto the first press`,
      ).toBe(true);
    }
  });
});
