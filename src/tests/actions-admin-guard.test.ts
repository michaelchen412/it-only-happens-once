// The tripwire for the rule `requireAdmin` states: **if an action writes, its
// first line is `requireAdmin(ctx)`.**
//
// ⚠ THIS EXISTS BECAUSE THE RULE USED TO HAVE AN EXCEPTION CLAUSE, and the
// clause is what failed. The documented policy was "guard the actions that
// touch no RLS-protected table" — true, careful, and impossible to apply
// consistently: by the 2026-08-08 audit, guarding had come to follow module
// ancestry instead. Every HQ namespace guarded; `constellations`, `vocabulary`
// and `site` did not, nor did eight handlers in `fragments` or `songs.pair`.
// Twenty-seven mutating handlers, and nobody had decided that.
//
// RLS is still the trust boundary and it held throughout — but RLS refuses
// SILENTLY. A non-admin's update matches zero rows, which is not an error, so
// the action returns `{ ok: true }` and the screen says the save worked. The
// guard is the difference between a no and a lie.
//
// Text, not types, for the same reason `action-guard.test.ts` is: the question
// is *which handlers hold one at all*, and an AST rule that decides whether a
// guard is reached on every path is a much larger thing that would still not
// answer it. The blind spot is written down rather than pretended away — this
// cannot see a guard that is conditional, only that the line is there.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ACTIONS = fileURLToPath(new URL('../actions/', import.meta.url));

/**
 * Actions that may go unguarded, each with the reason.
 *
 * **One entry, and it should stay one.** Adding a line here is allowed; it has
 * to come with a sentence saying why a stranger is allowed to call it.
 */
const ALLOWED: Record<string, string> = {
  'site.ts › send': 'the public contact form on /about — a form a stranger cannot use is not a contact form',
};

/** Every `name: defineAction({ … })` in a module, sliced by brace matching. */
function actionsIn(source: string): { name: string; body: string }[] {
  const found: { name: string; body: string }[] = [];
  const opener = /(\w+): defineAction\(\{/g;
  for (let m = opener.exec(source); m; m = opener.exec(source)) {
    let depth = 0;
    let i = m.index + m[0].length - 1; // at the '{'
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) break;
    }
    found.push({ name: m[1], body: source.slice(m.index, i + 1) });
  }
  return found;
}

const modules = readdirSync(ACTIONS)
  .filter((f) => f.endsWith('.ts') && f !== '_shared.ts' && f !== 'index.ts')
  .map((file) => ({ file, source: readFileSync(join(ACTIONS, file), 'utf8') }));

describe('every action is guarded', () => {
  it('finds the actions at all — the slicer has not drifted', () => {
    // If the brace matcher ever mis-parses, the sweep below would quietly pass
    // over the handlers it failed to find. Cheaper to notice here.
    for (const { file, source } of modules) {
      const declared = source.match(/\w+: defineAction\(\{/g)?.length ?? 0;
      expect(actionsIn(source), `${file}: sliced a different number of actions than are declared`).toHaveLength(
        declared,
      );
      for (const { name, body } of actionsIn(source)) {
        expect(body.trimEnd().endsWith('}'), `${file} › ${name}: the slice is not a whole action`).toBe(true);
        expect(body, `${file} › ${name}: the slice has no handler in it`).toContain('handler:');
      }
    }
  });

  it('every action calls requireAdmin, or is on the allowlist with a reason', () => {
    const unguarded: string[] = [];
    for (const { file, source } of modules) {
      for (const { name, body } of actionsIn(source)) {
        const id = `${file} › ${name}`;
        if (!body.includes('requireAdmin(ctx)') && !(id in ALLOWED)) unguarded.push(id);
      }
    }
    expect(
      unguarded,
      'These actions do not call `requireAdmin(ctx)`. RLS will refuse a non-admin SILENTLY — an update that ' +
        'matches zero rows is not an error, so the handler returns { ok: true } and the interface reports a save ' +
        'that never happened. Add the guard as the first line of the handler. If the action is genuinely meant ' +
        'to be callable by a stranger, add it to ALLOWED with the sentence that says why.',
    ).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    const ids = new Set(
      modules.flatMap(({ file, source }) => actionsIn(source).map(({ name }) => `${file} › ${name}`)),
    );
    const stale = Object.keys(ALLOWED).filter((id) => !ids.has(id));
    expect(stale, 'These are not actions any more — delete their line, so the list keeps shrinking.').toEqual([]);
  });
});
