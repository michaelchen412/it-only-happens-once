// Every repo path named in a `src/` comment still exists (31 · §5).
//
// ⚠ THIS IS A RATCHET, NOT A REPAIR. At the time it was written all 61
// references resolved — nothing was broken and nothing was fixed. It is the
// same move `tests/e2e/a11y.spec.ts` made with plan 19's audit numbers: turn a
// property that currently holds into one that cannot quietly stop holding.
// Renaming a module or deleting a page can no longer leave a comment pointing
// at nothing, and it fails in `verify`, which fails the deploy.
//
// WHY THIS AND NOT A COMMENT SWEEP. `src/lib` + `src/actions` is 42% comment,
// and the obvious reading of that number is "too much". It is the wrong
// reading: those comments are the most valuable thing in this repo and are the
// house style GROUND-RULES asked for on 2026-08-03. The real risk is narrower —
// prose goes stale SILENTLY, in a way code cannot, which is the whole reason
// plan 28 had to exist. So this checks the half of a comment that is a FACT (a
// path either resolves or it does not) and leaves the half that is a judgement
// (whether the reasoning is still true) to a human, where it belongs.
//
// ⚠ IT CANNOT TELL YOU A COMMENT IS STILL TRUE. A file that still exists but no
// longer does what the comment says it does passes this test. That is not a
// gap to close later; it is the boundary between what a test can hold and what
// only a reader can.
//
// ⚠ AND IT PROVED ITSELF BEFORE IT EXISTED. Deleting the three `*-lab` benches
// (31 · §7) left FOURTEEN dangling references across shipped components, CSS,
// a spec and an Accepted ADR. That is what this catches, and the labs are the
// reason we know the failure is real rather than theoretical.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

/**
 * ⚠ THE THREE LOCAL-ONLY DOCS, AND WHY SKIPPING THEM IS NOT A LOOPHOLE.
 *
 * `design.md`, `vision.md` and `about-michael.md` are git-ignored on purpose
 * (see `.gitignore`) — personal working files that inform the work and are
 * deliberately not in the public repo. They exist on Michael's disk and are
 * legitimately cited from code comments.
 *
 * They MUST be skipped rather than checked, and the reason is the deploy:
 * since 2026-08-09 `verify` runs inside `npm run build`, which is Vercel's
 * build command. Vercel checks out the REPOSITORY, where these three files do
 * not exist — so a plain filesystem check on them would pass here, fail there,
 * and take production down with it on the next deploy. Exactly the class of
 * bug `scripts/check-server-bundle.mjs` exists for: a check that only ever
 * looked at the developer's disk.
 */
const LOCAL_ONLY = new Set(['design.md', 'vision.md', 'about-michael.md']);

/**
 * A repo path as it appears in prose. Deliberately conservative: it matches
 * things that look like real files in this tree and nothing else, because a
 * greedier pattern turns every `foo.bar` in a sentence into a failing
 * assertion. `adr/NNNN-*.md` is matched without its `docs/` prefix because
 * that is how ADRs are cited from code.
 */
const REF =
  /(?:docs\/adr\/\d{4}-[a-z0-9-]+\.md|adr\/\d{4}-[a-z0-9-]+\.md|docs\/[a-z-]+\.md|src\/[A-Za-z0-9/_.[\]-]+\.(?:ts|astro|css)|scripts\/[a-z0-9_-]+\.mjs|supabase\/migrations\/[0-9A-Za-z_*]+\.sql|tests\/e2e\/[A-Za-z0-9.-]+\.ts|(?:design|vision|about-michael)\.md)/g;

/** Every `.ts` / `.astro` under `src/`, recursively. */
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(ts|astro)$/.test(e.name) ? [full] : [];
  });
}

/** `(reference, the file that names it)` for every path-shaped string in `src/`. */
function references(): { ref: string; from: string }[] {
  const out = new Map<string, string>();
  for (const file of sources(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(REF)) {
      // First writer wins — the message only needs one place to look.
      if (!out.has(m[0])) out.set(m[0], path.relative(ROOT, file));
    }
  }
  return [...out].map(([ref, from]) => ({ ref, from }));
}

/** Resolve a citation to a path on disk. ADRs are cited without `docs/`. */
function resolve(ref: string): string {
  return path.join(ROOT, ref.startsWith('adr/') ? `docs/${ref}` : ref);
}

/** A `*` in a migration name is a real citation style, so expand it. */
function existsAllowingGlob(target: string): boolean {
  if (!target.includes('*')) return fs.existsSync(target);
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) return false;
  const pattern = new RegExp(
    `^${path
      .basename(target)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')}$`,
  );
  return fs.readdirSync(dir).some((f) => pattern.test(f));
}

describe('the paths named in src/ comments still exist', () => {
  const all = references();

  it('found the references at all', () => {
    // ⚠ THE VACUOUS-PASS GUARD, and it is the same one
    // `e2e-read-only.test.ts` opens with. Every assertion below is per-
    // reference, so a regex that quietly stops matching — or a `src/` that
    // moved — turns this whole file green while checking nothing. The floor is
    // well under the 61 counted on 2026-08-10, so ordinary deletions do not
    // trip it and a broken scanner does.
    expect(all.length).toBeGreaterThan(40);
  });

  it('every referenced path resolves', () => {
    const broken = all
      .filter(({ ref }) => !LOCAL_ONLY.has(ref))
      .filter(({ ref }) => !existsAllowingGlob(resolve(ref)))
      .map(({ ref, from }) => `${ref}  ← named in ${from}`);

    expect(broken, `These comments point at files that no longer exist:\n  ${broken.join('\n  ')}\n`).toEqual([]);
  });

  it('the local-only skips are still local-only, and still exist as a category', () => {
    // ⚠ THE SKIP LIST HAS TO EARN ITSELF EACH RUN. If one of the three ever
    // becomes a tracked file, it should be checked like anything else rather
    // than sitting in a permanent exemption nobody re-reads — and if the
    // git-ignore rule for it is dropped, this is the line that notices.
    const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    for (const name of LOCAL_ONLY) {
      expect(ignore, `${name} is exempted from the path check but is no longer git-ignored`).toContain(name);
    }
  });
});
