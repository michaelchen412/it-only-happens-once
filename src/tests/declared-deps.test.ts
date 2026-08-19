// Every package this tree imports is one `package.json` declares (41 · §2).
//
// ⚠ THIS IS THE HALF `check-server-bundle.mjs` CANNOT SEE, AND THE TWO ARE A
// PAIR. That script asks the harder question — *is this package actually inside
// the deployed function?* — by walking `.vercel/output/functions/_render.func`
// with a boundary so it cannot escape into the repo's own `node_modules`. It
// exists because on 2026-07-31 production returned 500 on every request with
// `Cannot find module 'htmlparser2'`.
//
// What it cannot notice is a package that resolves **only because something
// else dragged it in**. A transitive dependency is on disk locally, is traced
// into the function, and passes that check completely — right up until the
// parent drops it, majors it, or stops depending on it, at which point an
// import that was never ours to make stops resolving. Nothing warns, because
// nothing ever claimed it.
//
// ⚠ THREE OF THEM WERE FOUND ON 2026-08-15, and one was on a live route:
//
//   · `sharp`        — src/pages/og/[slug].png.ts, present only because Astro's
//                      image service happens to want it. The route's own header
//                      had verified it reaches the runtime, which is the harder
//                      question; the answer was right and the reason was
//                      incidental.
//   · `@tiptap/pm`   — src/scripts/proofread-marks.ts imports `Plugin`,
//                      `PluginKey`, `Decoration`, `DecorationSet` — real values
//                      in shipped client code — via a package that reached us
//                      through `@tiptap/core`.
//   · `devalue`      — tests/e2e/fixtures.ts, transitive from astro. An astro
//                      major that drops it breaks the whole e2e harness at an
//                      import line.
//
// Declaring them is a one-time fix. This is what stops the fourth. It also
// found a **fourth of the opposite kind** on its first run — `satori-html`,
// declared as a runtime dependency and imported by nothing at all — which is
// why the third assertion below exists.
//
// ⚠ IGNORING COMMENTARY IS THE WHOLE DIFFICULTY, AND TWO ATTEMPTS AT IT FAILED
// BEFORE `codeLines` — both by SPLICING rather than by over-matching. The
// account is at that function, and it is worth reading before touching any of
// the patterns here: `check-server-bundle.mjs` warns that *"bundled sources
// contain plenty of prose that trips a naive scan"*, and this file is the same
// lesson learned against **source** rather than against a bundle. Note what a
// codebase at 34% comments does to a scanner: the prose here quotes import
// statements, glob patterns and regex literals in roughly equal measure, and
// every one of them looks like code to a pattern.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const ROOT = process.cwd();

/**
 * Where application code lives.
 *
 * ⚠ `supabase/functions/` IS DELIBERATELY ABSENT. Those are **Deno** edge
 * functions with their own resolver and their own specifiers — `push-send`
 * imports `jsr:@supabase/supabase-js@2` — and `package.json` has no authority
 * over them at all. Checking them here would report a permanent, unfixable
 * failure for a runtime this file does not describe.
 */
const ROOTS = ['src', 'tests', 'scripts'];
const EXTENSIONS = /\.(ts|astro|mjs)$/;

/** Node's own modules, with and without the `node:` prefix. */
const BUILTIN = new Set(builtinModules);

/**
 * Specifiers that are resolved by the build rather than by npm.
 *
 * `astro:actions`, `astro:assets`, `astro:env/server`, `astro:middleware`,
 * `astro:transitions` — virtual modules Astro generates. `virtual:` is the
 * Vite convention for the same idea and is included so a future integration
 * does not need this file edited.
 */
const VIRTUAL = /^(astro:|virtual:)/;

/**
 * `… from 'x'`, bare `import 'x'`, and `import('x')`.
 *
 * ⚠ `from` DOES NOT NEED TO BE AT THE START OF A LINE, because a multi-line
 * import closes as `} from 'x'` and ten files here are written that way.
 * `.from('fragments')` cannot collide: a quote must follow `from` directly,
 * and PostgREST's builder puts a `(` there.
 *
 * ⚠ AND THERE IS NO `require()` PATTERN, DELIBERATELY. This tree is ESM
 * throughout — `"type": "module"`, and a search finds not one real `require(`
 * call. What it does find is `check-server-bundle.mjs` *quoting*
 * `__require("htmlparser2")` in the header where it explains the 2026-07-31
 * outage. A pattern with no true positives and one known false positive is
 * worse than no pattern.
 */
const SPECIFIER = [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s+['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g];

/**
 * A plausible npm specifier, and nothing else.
 *
 * ⚠ LIFTED FROM `check-server-bundle.mjs`, WHICH LEARNED IT THE SAME WAY THIS
 * FILE DID. Its note: *"bundled sources contain plenty of prose that trips a
 * naive scan… checking the shape of the capture is cheaper and steadier than
 * trying to write patterns that can't be fooled."*
 *
 * The first draft of this file had no shape guard and reported nine
 * "undeclared packages" with names like `, from.id);\n    fd.set(` — the
 * `from\s*['"]` pattern finding an ordinary `from` variable a few characters
 * before an unrelated string literal.
 */
const LOOKS_LIKE_A_PACKAGE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.-]+)*$/i;

/**
 * The lines of `src` that are code rather than commentary.
 *
 * ⚠ IT WORKS A LINE AT A TIME, AND THAT IS THE WHOLE POINT — TWO REGEX VERSIONS
 * OF THIS FAILED FIRST, EACH BY **SPLICING**.
 *
 *   1. Stripping every `//` not preceded by a colon: a regex literal holding
 *      `\/\/` takes the rest of its line with it, and deleting the rest of a
 *      line joins two unrelated fragments of code. That produced nine imaginary
 *      packages with names like `, from.id);\n    fd.set(`.
 *   2. Stripping `/*` … `*` `/` pairs with a non-greedy match: `fixtures.ts`
 *      declares `const ACTIONS = '`…`/_actions/`…`'`, and a glob ending in a
 *      slash-star opens a comment that ran on until the next close — swallowing
 *      that file's real `devalue` import, which is what this whole commit was
 *      about.
 *
 * A line filter cannot splice. The worst it can do is skip a line, so the
 * failure mode is a missed import — never an invented one, which is the kind
 * that makes a check untrustworthy.
 *
 * ⚠ THE BLOCK STATE IS TRACKED RATHER THAN PATTERN-MATCHED, because this
 * codebase writes block comments with unprefixed bodies:
 *
 *     /* ⚠ THE ✕, ESCAPE AND THE BACKDROP ALL MEAN "I WANT OUT" (ADR 0032).
 *        …prose that does not start with a star…
 *
 * so "skip lines beginning with a star" would read those bodies as code.
 */
function codeLines(src: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('//')) continue;
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    out.push(line);
  }
  return out;
}

/** `@scope/name/sub` → `@scope/name`; `name/sub?url` → `name`. */
function packageOf(spec: string): string {
  const clean = spec.split('?')[0];
  const parts = clean.split('/');
  return clean.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function sources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(full);
    return EXTENSIONS.test(e.name) ? [full] : [];
  });
}

/** `(package, one file that imports it)` for every bare specifier in the tree. */
function imported(): Map<string, string> {
  const out = new Map<string, string>();
  for (const root of ROOTS) {
    for (const file of sources(path.join(ROOT, root))) {
      const src = codeLines(fs.readFileSync(file, 'utf8')).join('\n');
      for (const re of SPECIFIER) {
        for (const [, spec] of src.matchAll(re)) {
          if (spec.startsWith('.') || spec.startsWith('/')) continue;
          if (spec.startsWith('node:') || BUILTIN.has(spec)) continue;
          if (VIRTUAL.test(spec)) continue;
          const pkg = packageOf(spec);
          if (!LOOKS_LIKE_A_PACKAGE.test(pkg)) continue;
          // First writer wins — the message only needs one place to look.
          if (!out.has(pkg)) out.set(pkg, path.relative(ROOT, file));
        }
      }
    }
  }
  return out;
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const DECLARED = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);

describe('every imported package is declared in package.json', () => {
  const found = imported();

  it('found the imports at all', () => {
    // ⚠ THE VACUOUS-PASS GUARD, the same one `comment-refs.test.ts` and
    // `e2e-read-only.test.ts` each open with. Every assertion below is
    // per-package, so a regex that quietly stops matching — or a `ROOTS` entry
    // that moved — turns this file green while checking nothing. The floor sits
    // well under the 26 counted on 2026-08-15, so ordinary deletions do not
    // trip it and a broken scanner does.
    expect(found.size).toBeGreaterThan(15);
  });

  it('every one of them resolves to a dependency we declared', () => {
    const undeclared = [...found]
      .filter(([name]) => !DECLARED.has(name))
      .map(([name, from]) => `${name}  ← imported by ${from}`);

    expect(
      undeclared,
      `These packages are imported but not in package.json. They resolve today only because ` +
        `something else depends on them — so the day that parent drops or majors them, the import ` +
        `breaks with nothing having warned:\n  ${undeclared.join('\n  ')}\n`,
    ).toEqual([]);
  });

  it('declares no dependency the tree never imports', () => {
    // ⚠ THE ALLOWLIST ROTS IN THE OTHER DIRECTION TOO — the same argument
    // `e2e-read-only.test.ts` makes about opt-outs that stopped needing one.
    //
    // The exemptions below are real and each is load-bearing: these are
    // packages the BUILD uses without any file naming them. Config-only
    // (astro.config.mjs is at the root, outside ROOTS), toolchain invoked by
    // npm scripts, type packages consumed by tsc, and font/icon data resolved
    // by an integration. A package that stops earning its place here should be
    // removed rather than sit in a permanent exemption nobody re-reads.
    const BUILD_ONLY = new Set([
      '@astrojs/check', // `astro check`
      '@astrojs/vercel', // astro.config.mjs
      '@eslint/js', // eslint.config.js
      '@iconify-json/ph', // icon data, resolved by astro-icon
      '@iconify-json/simple-icons',
      '@tailwindcss/vite', // astro.config.mjs
      // tsc only — and DECLARED EXPLICITLY SINCE 2026-08-19, having been an
      // accident before it. Nothing here ever asked for it: it arrived as a hard
      // dependency of @types/yauzl, under extract-zip, under @iconify/tools,
      // under astro-icon. vite and vitest want it too but only as an OPTIONAL
      // peer, so npm never installed it on their account. Bumping astro-icon to
      // 1.2.0 to clear GHSA-jmr9-qjv8-65gv dropped that chain and took the Node
      // globals with it — 75 `astro check` errors for `Buffer` and `node:fs`.
      // Pinned to ^22 to match `engines.node`, not the floating 26.x that the
      // old chain happened to resolve; the types should describe the runtime.
      '@types/node',
      '@types/sanitize-html', // tsc only
      'daisyui', // imported from app.css
      'eslint',
      'eslint-plugin-astro',
      'globals', // eslint.config.js
      'husky',
      'lint-staged',
      'prettier',
      'prettier-plugin-astro',
      'prettier-plugin-tailwindcss',
      'tailwindcss', // imported from app.css
      'typescript',
      'typescript-eslint',
    ]);

    const unused = [...DECLARED].filter((name) => !found.has(name) && !BUILD_ONLY.has(name)).sort();

    expect(
      unused,
      `These are declared but nothing under ${ROOTS.join('/, ')}/ imports them. Either they are ` +
        `dead and should be removed, or they are used by the build and belong in BUILD_ONLY here ` +
        `with the reason:\n  ${unused.join('\n  ')}\n`,
    ).toEqual([]);
  });
});
