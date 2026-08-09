// The tripwire for the one invariant `src/scripts/action-error.ts` exists to
// hold: **`astro:actions` THROWS on a dead network rather than returning
// `{ error }`.** A bare `await actions.x.y(…)` therefore rejects and skips
// every line after it — the re-enable, the close, the sentence — and the whole
// class only misfires when the network is down, which is never while you are
// testing.
//
// ⚠ THIS TEST EXISTS BECAUSE A COMMENT DID NOT WORK, and that is the entire
// argument for it. The invariant was carried by a warning pasted into sixteen
// files; a full-repo audit on 2026-08-08 ran the grep
// [15](docs/plans/archive/15-freshness.md) had asked for and found **nine of
// the fifty-nine client scripts had missed the paste** — one of them the
// quote/song Save, which offline stuck disabled for the life of the sheet with
// nothing on screen. A convention that fails at 15% of its sites is not a
// convention. So the lifecycle is a function now (`submitAction` / `callAction`)
// and this is what stops the seventeenth file quietly opting out of it.
//
// **The allowlist below is the debt, and it only ever shrinks.** Adding a line
// is allowed; it just has to come with a sentence saying who catches the throw.
//
// ⚠ TWO BLIND SPOTS, written down rather than pretended away. This matches
// TEXT, so it cannot see an action awaited through an alias
// (`await action(fd)`, `await call(actions.…)`) and it cannot tell a guarded
// await from an unguarded one — it only asks *which files hold one at all*.
// That is deliberate: the alternative is an AST rule that has to decide what
// counts as a sufficient `try`, and a `try` whose catch hand-rolls
// `err.message` is the exact half-pattern this codebase already paid for
// (see `formatActionError`'s note, and `admin/people/[slug].astro`, which had
// the catch and still could not say the sentence it carried).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(ROOT, 'src');

/**
 * Files that may hold a bare `await actions.…`, each with the reason it is
 * safe. Anything not on this list must go through `callAction` (which turns a
 * throw into `{ error }`) or `submitAction` (which owns the whole
 * disable → await → format → restore lifecycle).
 */
const ALLOWED: Record<string, string> = {
  // Every await sits inside a try whose catch ends in `formatActionError`.
  'src/scripts/versions-panel.ts': 'six awaits, six try/catch pairs',
  'src/scripts/writing-sheet.ts': 'the autosave state machine — each await has its own catch',
  'src/scripts/task-list.ts': 'disposition toggle, try/catch',
  'src/scripts/drift.ts': 'try/catch, with the invariant written out beside it',
  'src/scripts/calendar-sync.ts': 'try/catch',
  'src/scripts/subject-suggest.ts': 'try/catch — the "Thinking…" stick this class is named after',
  'src/scripts/writing-proofread.ts': 'try/catch, same shape as subject-suggest',
  'src/scripts/capture.ts': 'try/catch inside the serialized save lock',
  'src/scripts/checkin.ts': 'the autosave loop, wrapped in try/catch/finally',

  // Guarded one level up rather than in place — which is why a per-file
  // allowlist is the honest granularity here.
  'src/scripts/push.ts': '`persist()` is bare; both of its callers wrap it in a try',
  'src/scripts/notes.ts': 'the undo callback is bare; its invoker catches. The rest are in try blocks',

  // Guarded by the helper, one callback in.
  'src/scripts/person-sheet.ts': 'both awaits are inside a `submitAction` work callback',
};

/** `await actions.` in code — comment and doc lines don't count. */
const BARE = /(^|[^.\w])await\s+actions\s*\./;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // `src/tests/` is skipped because THIS file quotes the pattern it is
    // hunting for, in prose and in a regex, and no comment filter can be
    // trusted to tell those apart from a real one.
    if (entry.isDirectory()) {
      if (entry.name !== 'tests') walk(full, out);
    } else if (/\.(ts|astro)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function filesWithBareAwait(): string[] {
  const hits = new Set<string>();
  for (const file of walk(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    if (lines.some((l) => !COMMENT.test(l) && BARE.test(l))) {
      hits.add(relative(ROOT, file).split('\\').join('/'));
    }
  }
  return [...hits].sort();
}

describe('a save cannot silently skip a dead network', () => {
  const found = filesWithBareAwait();

  it('every bare `await actions.…` is on the allowlist, with a reason', () => {
    const surprises = found.filter((f) => !(f in ALLOWED));
    expect(
      surprises,
      'These files await an action directly. `astro:actions` THROWS on a dead network rather than ' +
        'returning `{ error }`, so the rejection skips everything after the await — the button never ' +
        'comes back and nothing is said. Use `submitAction` (whole lifecycle) or `callAction` ' +
        '(throw → `{ error }`) from src/scripts/action-error.ts. If the throw is genuinely caught ' +
        'somewhere that ends in `formatActionError`, add the file to ALLOWED with that sentence.',
    ).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    const stale = Object.keys(ALLOWED).filter((f) => !found.includes(f));
    expect(stale, 'These no longer hold a bare await — delete their line, so the list keeps shrinking.').toEqual([]);
  });
});
