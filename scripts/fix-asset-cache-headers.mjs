// Move the adapter's `_astro` immutable cache rule ABOVE Vercel's filesystem
// handler, where it can actually reach the files it names.
//
// THE BUG IS UPSTREAM AND IT IS SILENT. @astrojs/vercel builds its route list
// as `[...redirects, ...finalRoutes]`, where `finalRoutes[0]` is
//
//     { src: '^/_astro/(.*)$', headers: { 'cache-control': '…immutable' }, continue: true }
//
// and `redirects` comes from `@vercel/routing-utils`' getTransformedRoutes(),
// which — the moment ANY redirect exists — appends `{ handle: 'filesystem' }`
// to close the phase (routing-utils/dist/index.js, `routes.push({ handle:
// "filesystem" })`). Vercel's phases mean routes after that handle are consulted
// only when the filesystem MISSED. A hashed asset never misses. So the rule sits
// there, syntactically perfect, matching nothing.
//
// astro.config declares three `/admin/*` redirects, which is what trips it. The
// symptom is invisible locally and has no error anywhere: production simply
// serves every `/_astro/*` file — the render-blocking stylesheet and all six
// preloaded woff2 — as `public, max-age=0, must-revalidate`, Vercel's default
// for static files. Measured 2026-08-21: every repeat visitor paid seven
// conditional round-trips (~75ms each) and got seven 304s, with the CSS one
// blocking render. Lighthouse never sees it, because Lighthouse audits a cold
// load.
//
// ⚠ UPGRADING THE ADAPTER DOES NOT FIX THIS. Checked against 11.0.7 (latest on
// 2026-08-21): identical construction. Delete this script when upstream emits
// the rule before the handle — the assertions below will tell you when, by
// failing.
//
// ⚠ AND `vercel.json` IS NOT THE ESCAPE HATCH. A project built through the
// Build Output API is configured by `.vercel/output/config.json`; a `headers`
// block in vercel.json does not merge into it. Patching the built artifact is
// the only place the fix can land.
import { readFileSync, writeFileSync } from 'node:fs';

const CONFIG = '.vercel/output/config.json';

const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const routes = config.routes;

if (!Array.isArray(routes)) {
  console.error(`✗ ${CONFIG} has no \`routes\` array — the adapter's output shape changed.`);
  process.exit(1);
}

const isImmutableAssetRule = (r) =>
  r && typeof r.src === 'string' && /immutable/.test(r.headers?.['cache-control'] ?? '');

const ruleIndex = routes.findIndex(isImmutableAssetRule);
const handleIndex = routes.findIndex((r) => r?.handle === 'filesystem');

if (ruleIndex === -1) {
  console.error(`
✗ No immutable cache-control rule found in ${CONFIG}.

  @astrojs/vercel has always emitted one for the configured assets dir (default _astro).
  Its absence means the adapter changed shape, and every hashed asset is now
  being served with whatever Vercel defaults to. Re-read the adapter's route
  construction before deleting this check.
`);
  process.exit(1);
}

if (handleIndex === -1) {
  // No filesystem phase at all — every route is in the first phase, so the
  // rule already applies. Nothing to move, and nothing wrong.
  console.log('✓ asset cache headers: no filesystem phase; immutable rule already applies');
  process.exit(0);
}

if (ruleIndex < handleIndex) {
  // Either upstream fixed it or the redirects were removed. Either way this
  // script has no work left — and that is the signal to delete it.
  console.log('✓ asset cache headers: immutable rule already precedes the filesystem handler');
  process.exit(0);
}

const [rule] = routes.splice(ruleIndex, 1);
routes.splice(handleIndex, 0, rule);
writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);

console.log(
  `✓ asset cache headers: hoisted \`${rule.src}\` above the filesystem handler ` + `(${rule.headers['cache-control']})`,
);
