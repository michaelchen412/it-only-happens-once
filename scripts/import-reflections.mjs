// One-off migration: Squarespace /reflections/ posts → `writing` fragments.
// docs/architecture.md §8. Run modes:
//   node scripts/import-reflections.mjs           → DRY RUN (writes previews to
//                                                    scratch, touches nothing)
//   node scripts/import-reflections.mjs --commit  → real import (later)
//
// Source of truth for dates is the Squarespace export (wp:post_date). Content is
// converted HTML→Markdown; the paired Spotify/YouTube embed is captured into
// details.media; images are rehosted to Supabase Storage on --commit.
import fs from 'node:fs';
import path from 'node:path';
import TurndownService from 'turndown';
import { createClient } from '@supabase/supabase-js';

const XML = 'legacy/Squarespace-Wordpress-Export-07-18-2026.xml';
const OUT = process.env.OUT_DIR || '/tmp/reflections-preview';
const COMMIT = process.argv.includes('--commit');

// --- tiny helpers ----------------------------------------------------------
const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const getTag = (s, tag) => {
  const m = s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : '';
};

// Spotify/YouTube embed URL → canonical share URL + provider.
function canonicalMedia(embedUrl) {
  try {
    const u = new URL(embedUrl);
    if (u.hostname.includes('spotify')) {
      const path = u.pathname.replace('/embed/', '/'); // /embed/playlist/ID → /playlist/ID
      return { provider: 'spotify', url: `https://open.spotify.com${path}` };
    }
    if (u.hostname.includes('youtube') || u.hostname.includes('youtu.be')) {
      const id = u.pathname.split('/').pop();
      return { provider: 'youtube', url: `https://www.youtube.com/watch?v=${id}` };
    }
    return { provider: 'other', url: embedUrl };
  } catch {
    return null;
  }
}

// --- turndown (clean, asterisk emphasis, atx headings) ---------------------
const td = new TurndownService({
  headingStyle: 'atx',
  emDelimiter: '*',
  strongDelimiter: '**',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});
td.remove(['iframe', 'img']); // embed → details.media; images dropped (per import decision)

function htmlToMarkdown(html) {
  // Strip images + embeds before conversion (embeds captured separately; images
  // dropped per import decision). Regex is more reliable than turndown.remove
  // for void <img> elements.
  const stripped = html.replace(/<img\b[^>]*>/gi, '').replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
  let md = td.turndown(stripped);
  return md
    .replace(/ /g, ' ') // nbsp → space
    .replace(/[ \t]+\n/g, '\n') // trailing spaces
    .replace(/\n{3,}/g, '\n\n') // collapse blank runs
    .trim();
}

// --- parse the export ------------------------------------------------------
const xml = fs.readFileSync(XML, 'utf8');
const items = xml.split('<item>').slice(1);
const posts = [];

for (const it of items) {
  if (getTag(it, 'wp:post_type') !== 'post') continue;
  if (!/<link>\/reflections\//.test(it)) continue;

  const title = getTag(it, 'title');
  const date = getTag(it, 'wp:post_date'); // "2023-04-19 15:01:00"
  const isoDate = new Date(date.replace(' ', 'T') + 'Z').toISOString();
  const rawHtml = (it.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) || [])[1] || '';

  // capture first embed as the paired media
  const iframeSrc = (rawHtml.match(/<iframe[^>]+src="([^"]+)"/) || [])[1];
  const media = iframeSrc ? canonicalMedia(iframeSrc) : null;

  // capture image srcs (rehosted on --commit; kept as-is in dry run)
  const images = [...rawHtml.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);

  const body = htmlToMarkdown(rawHtml);

  posts.push({
    title,
    slug: slugify(title),
    isoDate,
    date,
    media,
    images,
    body,
    words: body.split(/\s+/).filter(Boolean).length,
  });
}

// --- dry-run output --------------------------------------------------------
if (!COMMIT) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const dupes = {};
  for (const p of posts) dupes[p.slug] = (dupes[p.slug] || 0) + 1;

  for (const p of posts) {
    const front = `---\ntitle: ${p.title}\nslug: ${p.slug}\ndate: ${p.date}\nmedia: ${p.media ? p.media.provider + ' ' + p.media.url : '—'}\nimages: ${p.images.length}\n---\n\n`;
    fs.writeFileSync(path.join(OUT, `${p.slug || 'untitled'}.md`), front + p.body);
  }

  console.log(`Parsed ${posts.length} reflections → previews in ${OUT}\n`);
  console.log('slug'.padEnd(42), 'date'.padEnd(12), 'words', ' media');
  for (const p of posts.slice(0, 12)) {
    console.log(
      (p.slug || '(none)').slice(0, 40).padEnd(42),
      p.date.slice(0, 10).padEnd(12),
      String(p.words).padStart(5),
      ' ' + (p.media?.provider ?? '—'),
    );
  }
  const collisions = Object.entries(dupes).filter(([, n]) => n > 1);
  console.log('\nslug collisions:', collisions.length ? collisions : 'none');
  console.log('missing media:', posts.filter((p) => !p.media).length);
  console.log('missing date:', posts.filter((p) => !p.isoDate).length);
} else {
  // --- real import (service-role, bypasses RLS — server-side one-off) -------
  const url = process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing env. Run: node --env-file=.env.local scripts/import-reflections.mjs --commit');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 1) subjects from the reviewed taxonomy
  const { taxonomy, tags } = JSON.parse(fs.readFileSync('scripts/reflections-subjects.json', 'utf8'));
  const subjectRows = taxonomy.map((t) => ({ name: t.name, slug: slugify(t.name) }));
  const { error: subErr } = await sb.from('subjects').upsert(subjectRows, { onConflict: 'slug', ignoreDuplicates: true });
  if (subErr) throw subErr;
  const { data: subjectList, error: selErr } = await sb.from('subjects').select('id, slug');
  if (selErr) throw selErr;
  const subjectIdBySlug = Object.fromEntries(subjectList.map((s) => [s.slug, s.id]));

  // 2) each reflection → writing fragment (upsert by slug, idempotent)
  let inserted = 0;
  for (const p of posts) {
    const row = {
      type: 'writing',
      title: p.title,
      slug: p.slug,
      body: p.body,
      excerpt: null,
      status: 'published',
      occurred_at: p.isoDate,
      published_at: p.isoDate,
      date_precision: 'day',
      details: p.media ? { media: p.media } : {},
    };
    const { data: frag, error: fragErr } = await sb
      .from('fragments')
      .upsert(row, { onConflict: 'slug' })
      .select('id')
      .single();
    if (fragErr) {
      console.error(`✗ ${p.slug}:`, fragErr.message);
      continue;
    }

    // 3) subjects for this fragment (replace to stay idempotent)
    const names = tags[p.slug] ?? [];
    const links = names.map((n) => subjectIdBySlug[slugify(n)]).filter(Boolean).map((subject_id) => ({ fragment_id: frag.id, subject_id }));
    await sb.from('fragment_subjects').delete().eq('fragment_id', frag.id);
    if (links.length) {
      const { error: linkErr } = await sb.from('fragment_subjects').insert(links);
      if (linkErr) console.error(`  subjects for ${p.slug}:`, linkErr.message);
    }
    inserted++;
    process.stdout.write(`\r  imported ${inserted}/${posts.length}`);
  }
  console.log(`\n✓ Done. ${inserted}/${posts.length} reflections imported (published, original dates, subjects linked).`);
}
