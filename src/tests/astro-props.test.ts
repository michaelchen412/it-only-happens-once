// A bare `<` at the start of a line in an .astro FRONTMATTER COMMENT silently
// breaks the Astro compiler's `Props` extraction.
//
// ⚠ WHAT IT COSTS, because the symptom is nowhere near the cause. `Astro.props`
// degrades to `any`, every field destructured from it goes with it, and the only
// visible trace is a scatter of ts(7006) "implicitly has an 'any' type" errors
// on callback parameters two hundred lines further down — pointing at `.map((s)
// => …)` in the template, not at the comment. Found 2026-08-10 by bisecting
// QuotePage.astro's header comment one line at a time (plan 32 · §3).
//
// ⚠ AND `astro check` IS NOT A SUFFICIENT GUARD. It only complains where the
// resulting `any` reaches a position TypeScript objects to. A component whose
// props are used only in plain interpolations — `{title}`, `{href}` — loses all
// of its typing with zero errors reported, which is the silent version of this
// bug and the reason this file exists rather than a note in a comment.
//
// The rule is easy to obey: write "below `sm`", not "< sm".
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function astroFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) astroFiles(path, out);
    else if (name.endsWith('.astro')) out.push(path);
  }
  return out;
}

/** The frontmatter fence, or '' for a component that has none. */
function frontmatter(source: string): string {
  if (!source.startsWith('---')) return '';
  const end = source.indexOf('\n---', 3);
  return end === -1 ? '' : source.slice(3, end);
}

describe('.astro frontmatter', () => {
  const files = astroFiles('src');

  it('finds the components (a guard that scans nothing passes for free)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has NO LINE BEGINNING WITH `<` — it silently unTYPES the whole component', () => {
    const offenders: string[] = [];
    for (const file of files) {
      frontmatter(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          // `*` allows for a jsdoc-style continuation; the check is the first
          // non-space, non-asterisk character on the line.
          const t = line.replace(/^\s*\**\s*/, '');
          if (t.startsWith('<')) offenders.push(`${file}:${i + 1}  ${t.slice(0, 60)}`);
        });
    }
    expect(offenders, `Write "below \`sm\`" rather than "< sm":\n${offenders.join('\n')}`).toEqual([]);
  });
});
