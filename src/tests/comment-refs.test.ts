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
  /(?:docs\/adr\/\d{4}-[a-z0-9-]+\.md|adr\/\d{4}-[a-z0-9-]+\.md|docs\/plans\/(?:archive\/)?[A-Za-z0-9._-]+\.md|docs\/[a-z-]+\.md|src\/[A-Za-z0-9/_.[\]-]+\.(?:ts|astro|css)|scripts\/[a-z0-9_-]+\.mjs|supabase\/migrations\/[0-9A-Za-z_*]+\.sql|tests\/e2e\/[A-Za-z0-9.-]+\.ts|(?:design|vision|about-michael)\.md)/g;

/**
 * The plans folder, which is git-ignored and cited from more of `src/` than
 * anything else in this pattern.
 *
 * ⚠ IT WAS INVISIBLE TO THIS FILE FOR AS LONG AS THIS FILE HAS EXISTED, and the
 * reason is one character: the `docs/[a-z-]+\.md` alternative above matches
 * `plans` and then wants `.md`, finds `/`, and gives up. So a citation like
 * `docs/plans/archive/13-agenda.md` never matched, and **no plan citation had
 * ever been checked** — while the header above says the paths named in `src/`
 * comments still exist. The test was not wrong about what it checks; it read as
 * broader coverage than it had, which is the same failure as a stale doc.
 *
 * *(That example is itself the check working: this comment first named the
 * pre-archive path, and the widened pattern failed on its own file.)*
 *
 * ⚠ WHAT THE WIDENED PATTERN FOUND ON ITS FIRST RUN: **67 citations across 65
 * files pointing at plans that had been ARCHIVED out from under them** — not
 * merely unreachable for a stranger, but broken on Michael's own disk. Plans
 * 00–16 moved to `archive/` on 2026-08-01 and 2026-08-04 and the comments
 * citing them were never repointed. `13-agenda.md` alone was cited 25 times.
 */
const PLANS = 'docs/plans/';

/**
 * ⚠ CHECKED WHERE THE FOLDER EXISTS, SKIPPED WHERE IT CANNOT — which is a
 * deliberately different answer from `LOCAL_ONLY` below, and a better one where
 * it is available.
 *
 * The three files in `LOCAL_ONLY` are cited by name from anywhere, so there is
 * no way to tell "absent because git-ignored" from "absent because renamed".
 * `docs/plans/` is a whole directory: its presence is one `existsSync`, so the
 * check can simply run on the machine that has it and stand down on the machine
 * that does not.
 *
 * The asymmetry only fails in the safe direction. Vercel checks out the
 * repository, where this folder does not exist, so there the check is inert and
 * **cannot fail a build** — which is the hazard `LOCAL_ONLY`'s note is about.
 * Locally it runs, inside `verify`, in front of the one person who can fix what
 * it finds.
 */
const plansPresent = fs.existsSync(path.join(ROOT, PLANS));

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

  /** Is this reference one this machine is in a position to check? */
  const checkable = (ref: string) => {
    if (LOCAL_ONLY.has(ref)) return false;
    if (ref.startsWith(PLANS)) return plansPresent;
    return true;
  };

  it('every referenced path resolves', () => {
    const broken = all
      .filter(({ ref }) => checkable(ref))
      .filter(({ ref }) => !existsAllowingGlob(resolve(ref)))
      .map(({ ref, from }) => `${ref}  ← named in ${from}`);

    expect(broken, `These comments point at files that no longer exist:\n  ${broken.join('\n  ')}\n`).toEqual([]);
  });

  it.runIf(plansPresent)('sees the plan citations, now that the pattern can match them', () => {
    // ⚠ THE VACUOUS-PASS GUARD FOR THE NEW ALTERNATIVE SPECIFICALLY. The
    // assertion above is per-reference, so a `docs/plans/…` branch that stopped
    // matching would take this whole category back out of the check while every
    // test stayed green — which is precisely the state this file was in until
    // 2026-08-15. The floor sits under the 11 distinct paths counted that day.
    const plans = all.filter(({ ref }) => ref.startsWith(PLANS));
    expect(plans.length, `the ${PLANS} branch of REF has stopped matching anything`).toBeGreaterThan(5);
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

    // ⚠ AND THE PLANS FOLDER'S EXEMPTION HAS TO EARN ITSELF THE SAME WAY. The
    // `plansPresent` skip above is justified by exactly one fact — that Vercel's
    // checkout does not contain this folder. If it is ever committed, the skip
    // stops being a safety measure and becomes a hole, and these citations
    // should be checked everywhere like any other. This is the line that
    // notices.
    expect(ignore, `${PLANS} is skipped on the deploy but is no longer git-ignored`).toContain(PLANS);
  });
});
