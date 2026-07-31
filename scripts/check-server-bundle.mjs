// Fail the build when the server bundle references a package the deployed
// function doesn't actually contain.
//
// Why this exists: on 2026-07-31 the production site returned 500 on every
// request with `Cannot find module 'htmlparser2'`. The cause was subtle and
// completely invisible to `astro check`, `npm run build`, `astro preview` and
// the whole test suite — because locally the missing packages ARE on disk in
// ./node_modules, so every local check resolves them happily. Only the deployed
// function, which ships its own pruned node_modules, could tell the difference.
//
// The mechanism, worth knowing before touching astro.config's `noExternal`:
// bundling a package removes it from the dependency graph Vercel's tracer
// walks, so it stops being copied into the function — while Rollup leaves any
// of ITS dependencies that aren't also bundled as bare `require()` calls. The
// two effects together produce requires that resolve nowhere.
//
// Usage:
//   node scripts/check-server-bundle.mjs              # verify .vercel/output
//   node scripts/check-server-bundle.mjs --closure X  # print X's dep closure,
//                                                     # to regenerate noExternal
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const FUNC = '.vercel/output/functions/_render.func';
const ROOT = process.cwd();

/**
 * Resolve a package the way Node does: nearest node_modules, walking up.
 *
 * `stopAt` is load-bearing and was learned the hard way — the first version of
 * this check passed against a bundle that was provably broken in production.
 * Walking up from inside `.vercel/output/...` reaches the REPO's node_modules,
 * where every missing package happily exists. That upward walk is precisely the
 * illusion that hid the original bug, so a checker without a boundary
 * reproduces the bug instead of catching it.
 */
function pkgDir(name, from, stopAt = null) {
  let dir = resolve(from);
  const boundary = stopAt ? resolve(stopAt) : null;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (boundary && dir === boundary) return null; // never escape the function
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// --- `--closure <pkg>`: what noExternal must list to bundle <pkg> whole ------
if (process.argv[2] === '--closure') {
  const target = process.argv[3];
  if (!target) {
    console.error('usage: --closure <package>');
    process.exit(2);
  }
  const seen = new Map();
  (function walk(name, from) {
    if (seen.has(name)) return;
    const dir = pkgDir(name, from);
    if (!dir) return void seen.set(name, { version: 'NOT FOUND', esmOnly: false });
    const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const esmOnly = p.type === 'module' && !(p.exports?.['.']?.require || p.main?.endsWith('.cjs'));
    seen.set(name, { version: p.version, esmOnly });
    for (const d of Object.keys(p.dependencies ?? {})) walk(d, dir);
  })(target, ROOT);
  console.log(`Closure of ${target} — ${seen.size} packages. All of these belong in noExternal:\n`);
  for (const [name, info] of [...seen].sort()) {
    console.log(`  ${name.padEnd(24)} v${info.version}${info.esmOnly ? '  [ESM-ONLY]' : ''}`);
  }
  console.log(`\n${[...seen.keys()].sort().map((n) => `'${n}',`).join('\n')}`);
  process.exit(0);
}

// --- default: verify the built function ------------------------------------
if (!existsSync(FUNC)) {
  console.error(`✗ ${FUNC} not found — run \`npm run build\` first.`);
  process.exit(1);
}

const BUILTIN = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
  'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
  'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8',
  'vm', 'wasi', 'worker_threads', 'zlib',
]);

/**
 * A plausible npm specifier, and nothing else. Bundled sources contain plenty
 * of prose that trips a naive scan — postcss has `!("from" in this._opts)`,
 * which the `from "x"` pattern reads as an import of ` in this._opts)) warnOnce(`.
 * Checking the shape of the capture is cheaper and steadier than trying to
 * write patterns that can't be fooled.
 */
const LOOKS_LIKE_A_PACKAGE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.-]+)*$/i;

/** "@scope/name/sub" → "@scope/name"; "pkg/sub" → "pkg". */
const packageOf = (spec) => {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

function* walkFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue; // shipped deps, not our output
      yield* walkFiles(full);
    } else if (/\.(m?js|cjs)$/.test(entry)) {
      yield full;
    }
  }
}

const serverDir = join(FUNC, 'dist', 'server');
if (!existsSync(serverDir)) {
  console.error(`✗ ${serverDir} not found — did the adapter change its output layout?`);
  process.exit(1);
}

// Static `require("x")`, `from "x"`, `import("x")` with a literal specifier.
//
// The `_*` prefix is not decoration. Rolldown emits its CommonJS interop as
// `__require("htmlparser2")`, and `\brequire` cannot match that: `_` is a word
// character, so there is no word boundary between the underscores and the name.
// Without this, the check reported a clean bundle while production was
// returning 500 on every request.
const PATTERNS = [
  /\b_*require\(\s*["']([^"'./][^"']*)["']\s*\)/g,
  /\bfrom\s*["']([^"'./][^"']*)["']/g,
  /\b_*import\(\s*["']([^"'./][^"']*)["']\s*\)/g,
];

const referenced = new Map(); // package -> Set of files referencing it
for (const file of walkFiles(serverDir)) {
  const src = readFileSync(file, 'utf8');
  for (const re of PATTERNS) {
    for (const [, spec] of src.matchAll(re)) {
      if (spec.startsWith('node:') || BUILTIN.has(spec)) continue;
      if (!LOOKS_LIKE_A_PACKAGE.test(spec)) continue;
      const pkg = packageOf(spec);
      if (!referenced.has(pkg)) referenced.set(pkg, new Set());
      referenced.get(pkg).add(file.replace(FUNC + '/', ''));
    }
  }
}

// Resolve each against the FUNCTION's node_modules — not the repo's, which is
// exactly the difference that made this invisible locally.
const missing = [];
for (const [pkg, files] of [...referenced].sort()) {
  if (!pkgDir(pkg, serverDir, FUNC)) missing.push([pkg, [...files]]);
}

if (missing.length) {
  console.error(`\n✗ ${missing.length} package(s) referenced by the server bundle are NOT in the deployed function.\n`);
  for (const [pkg, files] of missing) {
    console.error(`  ${pkg}`);
    for (const f of files.slice(0, 3)) console.error(`      ← ${f}`);
    if (files.length > 3) console.error(`      … and ${files.length - 3} more`);
  }
  console.error(`
  Every request that reaches this code would fail with MODULE_NOT_FOUND.

  Usual cause: astro.config's \`vite.ssr.noExternal\` bundles a package but not
  its dependencies. Bundling drops the package from Vercel's dependency trace,
  so its subtree is no longer shipped, while Rollup leaves the un-bundled
  dependencies as bare requires. Add the whole closure:

      node scripts/check-server-bundle.mjs --closure <package>
`);
  process.exit(1);
}

console.log(`✓ server bundle: all ${referenced.size} referenced packages resolve inside the function`);
