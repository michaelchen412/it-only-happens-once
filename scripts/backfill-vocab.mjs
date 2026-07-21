// One-off backfill for the vocabulary-entities migration (0003):
//   • subjects.definition ← the reviewed taxonomy (scripts/reflections-subjects.json)
//   • authors            ← distinct fragment.attribution (real people)
//   • works              ← distinct details.source_title (quotes) / details.album (songs)
//   • fragments.author_id / work_id facets set to match
//   • SCRIPTURE (attribution like "Matthew 5:43-48") groups under one work
//     "The Bible" WITHOUT changing what's displayed — the display stays the
//     book+verse in `attribution`; only the query facet points at The Bible.
//
// Additive + idempotent: display fields (attribution, details.source_title) are
// never mutated; only the new facet columns + reference tables are populated.
//
//   node --env-file=.env.local scripts/backfill-vocab.mjs           (dry run)
//   node --env-file=.env.local scripts/backfill-vocab.mjs --commit
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.includes('--commit');
const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

// Scripture attributions carry a chapter:verse ("Matthew 5:43-48"); real author
// names never do. These group under The Bible but keep their own display string.
const isScripture = (attr) => /\d+\s*:\s*\d+/.test(attr || '');

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing env. Run with: node --env-file=.env.local scripts/backfill-vocab.mjs [--commit]');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// --- plan (dry) -------------------------------------------------------------
const { taxonomy } = JSON.parse(fs.readFileSync('scripts/reflections-subjects.json', 'utf8'));

const { data: frags, error } = await sb
  .from('fragments')
  .select('id, type, attribution, details')
  .in('type', ['quote', 'song']);
if (error) throw error;

const authorSet = new Map(); // slug → name
const workSet = new Map(); // slug → { title, authorSlug }
let scriptureCount = 0;

for (const f of frags) {
  const attr = (f.attribution || '').trim();
  const scripture = isScripture(attr);
  let authorSlug = null;
  if (attr && !scripture) {
    authorSlug = slugify(attr);
    authorSet.set(authorSlug, attr);
  }
  if (scripture) {
    scriptureCount++;
    workSet.set(slugify('The Bible'), { title: 'The Bible', authorSlug: null, kind: 'collection' });
  }
  const workTitle = f.type === 'song' ? f.details?.album : f.details?.source_title;
  if (workTitle && String(workTitle).trim()) {
    const t = String(workTitle).trim();
    const wSlug = slugify(t);
    if (!workSet.has(wSlug)) workSet.set(wSlug, { title: t, authorSlug, kind: f.type === 'song' ? 'album' : 'book' });
  }
}

console.log(`${frags.length} quote/song fragments`);
console.log(`→ ${authorSet.size} authors, ${workSet.size} works (incl. The Bible), ${scriptureCount} scripture verses grouped under The Bible`);
console.log(`→ ${taxonomy.length} subject definitions to set`);

if (!COMMIT) {
  console.log('\nauthors:', [...authorSet.values()].slice(0, 40).join(' · '));
  console.log('\nworks:', [...workSet.values()].map((w) => w.title).join(' · '));
  console.log('\n(dry run — pass --commit to write)');
  process.exit(0);
}

// --- commit -----------------------------------------------------------------
// 1) subject definitions
let defs = 0;
for (const t of taxonomy) {
  const { error } = await sb.from('subjects').update({ definition: t.definition }).eq('slug', slugify(t.name));
  if (error) console.error(`  def ${t.name}:`, error.message);
  else defs++;
}
console.log(`✓ ${defs}/${taxonomy.length} subject definitions set`);

// 2) authors
const authorRows = [...authorSet.entries()].map(([slug, name]) => ({ name, slug }));
if (authorRows.length) {
  const { error } = await sb.from('authors').upsert(authorRows, { onConflict: 'slug', ignoreDuplicates: true });
  if (error) throw error;
}
const { data: authorList } = await sb.from('authors').select('id, slug');
const authorIdBySlug = Object.fromEntries((authorList ?? []).map((a) => [a.slug, a.id]));

// 3) works (link to author where known)
const workRows = [...workSet.entries()].map(([slug, w]) => ({
  title: w.title,
  slug,
  kind: w.kind ?? null,
  author_id: w.authorSlug ? authorIdBySlug[w.authorSlug] ?? null : null,
}));
if (workRows.length) {
  const { error } = await sb.from('works').upsert(workRows, { onConflict: 'slug', ignoreDuplicates: true });
  if (error) throw error;
}
const { data: workList } = await sb.from('works').select('id, slug');
const workIdBySlug = Object.fromEntries((workList ?? []).map((w) => [w.slug, w.id]));

// 4) fragment facets
let linked = 0;
for (const f of frags) {
  const attr = (f.attribution || '').trim();
  const scripture = isScripture(attr);
  const patch = { author_id: null, work_id: null };
  if (attr && !scripture) patch.author_id = authorIdBySlug[slugify(attr)] ?? null;
  if (scripture) patch.work_id = workIdBySlug[slugify('The Bible')] ?? null;
  else {
    const workTitle = f.type === 'song' ? f.details?.album : f.details?.source_title;
    if (workTitle && String(workTitle).trim()) patch.work_id = workIdBySlug[slugify(String(workTitle).trim())] ?? null;
  }
  const { error } = await sb.from('fragments').update(patch).eq('id', f.id);
  if (error) console.error(`  facet ${f.id}:`, error.message);
  else linked++;
}
console.log(`✓ ${linked}/${frags.length} fragment facets set`);
console.log(`✓ ${authorRows.length} authors, ${workRows.length} works upserted`);
