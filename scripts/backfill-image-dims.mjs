// Backfill `?w=&h=` onto every essay image uploaded before the uploader
// carried dimensions (plan 43 §5, tier three).
//
// ⚠⚠ THIS WRITES TO PRODUCTION CONTENT. Same rule as the 21-row occurred_at
// backfill on the board: running it with --write is MICHAEL'S CALL, not a
// session's. Without --write it is a dry run that prints exactly what it
// would do and touches nothing.
//
// ⚠ A SIDE EFFECT TO KNOW BEFORE SAYING YES: updating a fragment's body may
// bump its `updated_at`, so every essay with an old image gains a fresh
// "Edited" stamp. The feed cannot resurface anything (rss.xml.ts orders by
// `occurred_at`, deliberately), but the stamp is reader-visible. If that
// matters, it is an argument for running this once, soon, rather than in
// dribs.
//
// WHAT IT DOES: for every fragment whose body embeds a bare public-storage
// image URL (no query string), download the object once, read its pixel size
// with sharp — honouring EXIF orientation, because browsers do — and rewrite
// the URL in place to `…?w=W&h=H`. That is the whole convention the renderer
// reads (src/lib/essay-image-attrs.ts): with the params present, the page
// reserves the image's box (no layout shift) and offers a srcset (a phone
// stops downloading desktop bytes). Idempotent: a URL already carrying `?` is
// skipped, so re-running after a partial write is safe.
//
// Run:  node --env-file=.env.local scripts/backfill-image-dims.mjs          (dry run)
//       node --env-file=.env.local scripts/backfill-image-dims.mjs --write  (the real thing)
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local');
  process.exit(1);
}
const WRITE = process.argv.includes('--write');
const sb = createClient(url, key, { auth: { persistSession: false } });

/** A bare public `site`-bucket object URL — no query string yet. */
const BARE_URL = new RegExp(
  String.raw`https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/site/[^\s)"'<>?]+`,
  'g',
);

/** Displayed pixels: what the stored pixels become once EXIF orientation is
 *  applied, because that is the box the browser will actually draw. */
async function displayedDims(buf) {
  const m = await sharp(buf).metadata();
  if (!m.width || !m.height) return null;
  return (m.orientation ?? 1) >= 5 ? { w: m.height, h: m.width } : { w: m.width, h: m.height };
}

const { data: rows, error } = await sb
  .from('fragments')
  .select('id, slug, type, status, body')
  .like('body', '%/storage/v1/object/public/site/%');
if (error) {
  console.error('read failed:', error.message);
  process.exit(1);
}

const dimsByUrl = new Map();
let updated = 0;

for (const row of rows ?? []) {
  // Every row matched the LIKE filter, but a body can still have zero BARE
  // urls — e.g. all its images already carry `?w=` from an earlier run.
  const bare = [...new Set((row.body ?? '').match(BARE_URL) ?? [])];
  if (bare.length === 0) continue;
  let body = row.body;
  for (const imgUrl of bare) {
    if (!dimsByUrl.has(imgUrl)) {
      try {
        const res = await fetch(imgUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        dimsByUrl.set(imgUrl, await displayedDims(Buffer.from(await res.arrayBuffer())));
      } catch (e) {
        console.error(`  ✗ ${imgUrl}: ${e.message}`);
        dimsByUrl.set(imgUrl, null);
      }
    }
    const dims = dimsByUrl.get(imgUrl);
    if (!dims) continue;
    // Exact-URL replace, refusing a URL that continues (a `?` it already has,
    // or a longer path sharing this prefix — content-hashed names make the
    // second impossible in practice, and the lookahead makes it impossible in
    // principle).
    body = body.replace(
      new RegExp(imgUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + String.raw`(?![-\w./?#%])`, 'g'),
      `${imgUrl}?w=${dims.w}&h=${dims.h}`,
    );
  }
  if (body === row.body) continue;

  console.log(`${WRITE ? '✎' : '·'} ${row.type} ${row.status} ${row.slug} — ${bare.length} image(s)`);
  if (WRITE) {
    const { error: upErr } = await sb.from('fragments').update({ body }).eq('id', row.id);
    if (upErr) {
      console.error(`  ✗ update failed: ${upErr.message}`);
      continue;
    }
  }
  updated += 1;
}

console.log(
  `\n${WRITE ? 'updated' : 'would update'} ${updated} fragment(s); ${dimsByUrl.size} unique image(s) probed.` +
    (WRITE ? '' : ' Re-run with --write to apply.'),
);
