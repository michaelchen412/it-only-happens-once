// One-off migration: legacy/Quotes/*.md → `quote` fragments.
// Companion to import-reflections.mjs. Run modes:
//   node scripts/import-quotes.mjs                         → DRY RUN (parse only;
//                                                            preview to scratch)
//   node --env-file=.env.local scripts/import-quotes.mjs --commit  → real import
//
// The source files are hand-written and WILDLY inconsistent (em/en/bar dashes,
// bold wrappers, curly-quote wrappers, #hashtag sources vs. #hashtag themes,
// inline (Book x:y) / (page) citations). This parser normalizes all of that into
// a clean {body, attribution, work, citation, page, themes} shape. Subjects are
// curated separately in scripts/quotes-subjects.json, keyed by the body slug the
// dry run prints (same split as the reflections import).
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const DIR = 'legacy/Quotes';
const OUT = process.env.OUT_DIR || '/tmp/quotes-preview';
const COMMIT = process.argv.includes('--commit');
const THIS_YEAR = 2026; // "Added" year (occurred_at, year precision) — these aren't dated works.

const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const firstWords = (s, n) => s.replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' ');
const keyOf = (body) => slugify(firstWords(body, 8));

// #hashtag → canonical source. Anything not here is treated as a *theme* hint.
const SOURCE_TAGS = {
  meditations: { author: 'Marcus Aurelius', work: 'Meditations' },
  onearthwerebrieflygorgeous: { author: 'Ocean Vuong', work: 'On Earth We’re Briefly Gorgeous' },
  songofsignificance: { author: 'Seth Godin', work: 'The Song of Significance' },
  sethgodin: { author: 'Seth Godin', work: 'The Song of Significance' },
};

const stripEmphasis = (s) => s.replace(/\*\*/g, '').replace(/(?<!\w)\*(?!\s)([^*]+?)\*(?!\w)/g, '$1');
const stripWrapQuotes = (s) => {
  const t = s.trim();
  if (/^[“"].*[”"]$/s.test(t)) return t.slice(1, -1).trim();
  return t;
};

// A line whose first non-space glyph is a dash is an attribution line.
const isAttrLine = (line) => /^\s*[—―–‐-]\s*\S/.test(line);

// Pull a trailing "(...)" off an attribution/work → { text, cite }.
function splitTrailingParen(s) {
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return m ? { text: m[1].trim(), cite: m[2].trim() } : { text: s.trim(), cite: '' };
}

// One raw block of lines → a structured quote (or null if empty).
function parseBlock(lines) {
  // 1) strip a single leading "> " (blockquote marker) from each line
  const clean = lines.map((l) => l.replace(/^\s*>\s?/, ''));

  // 2) collect ALL hashtags in the block, classify source vs theme
  const tags = (clean.join(' ').match(/#[A-Za-z][\w]*/g) || []).map((t) => t.slice(1).toLowerCase());
  const themes = [];
  let src = null;
  for (const t of tags) {
    if (SOURCE_TAGS[t]) src = src || SOURCE_TAGS[t];
    else themes.push(t);
  }

  // 3) find an explicit dash-attribution line (last such line wins)
  let attrIdx = -1;
  for (let i = clean.length - 1; i >= 0; i--) {
    if (isAttrLine(clean[i]) && clean[i].replace(/^\s*[—―–‐-]\s*/, '').trim()) {
      attrIdx = i;
      break;
    }
  }

  let author = '';
  let work = '';
  let citation = '';
  let page;

  if (attrIdx !== -1) {
    let attr = clean[attrIdx].replace(/^\s*[—―–‐-]\s*/, '').trim();
    attr = attr.replace(/#[A-Za-z][\w]*/g, '').trim(); // drop theme tags on the attr line
    attr = stripEmphasis(attr);
    const tp = splitTrailingParen(attr);
    attr = tp.text;
    if (tp.cite) citation = tp.cite;
    // "Author, Work" → split on the first comma
    const comma = attr.indexOf(',');
    if (comma !== -1) {
      author = attr.slice(0, comma).trim();
      work = attr.slice(comma + 1).trim();
    } else {
      author = attr.trim();
    }
  }

  // 4) hashtag source fills gaps (esp. Meditations, which has no dash line)
  if (src) {
    if (!author) author = src.author;
    if (!work) work = src.work;
  }

  // 5) body = everything that isn't the attribution line
  const bodyLines = clean.filter((_, i) => i !== attrIdx);
  let body = bodyLines.join('\n');
  // strip inline "#tag ... (cite)" and bare hashtags from the body; capture the cite
  body = body.replace(/#[A-Za-z][\w]*\s*(\(([^)]+)\))?/g, (_m, _p, c) => {
    if (c && !citation) citation = c.trim();
    return '';
  });
  // a leftover trailing "(Book x:y)" / "(34)" attached to the body → citation
  {
    const tp = splitTrailingParen(body.replace(/\n+$/, ''));
    if (tp.cite && !citation) {
      citation = tp.cite;
      body = tp.text;
    }
  }
  body = stripEmphasis(body);
  body = body
    .split('\n')
    .map((l) => stripWrapQuotes(l).replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  body = stripWrapQuotes(body);

  // 6) numeric citation → a page number (Ocean Vuong 4/34/62/174…); Book/Letter refs stay text
  if (/^\d+$/.test(citation)) {
    page = Number(citation);
    citation = '';
  }

  if (!body) return null;
  return { body, attribution: author, work, citation, page, themes };
}

// Split a file into blocks: a fully-blank line separates quotes; a dash line with
// no ">" is still part of the preceding quote (no blank precedes it).
function parseFile(text) {
  const blocks = [];
  let cur = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      if (cur.length) blocks.push(cur), (cur = []);
    } else {
      cur.push(line);
    }
  }
  if (cur.length) blocks.push(cur);
  return blocks.map(parseBlock).filter(Boolean);
}

// --- parse every file ------------------------------------------------------
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();
const all = [];
const seen = new Map(); // body-key → index in `all` (dedupe; merge source folders)

for (const f of files) {
  const folder = f.replace(/\.md$/, '').replace(/^On (the )?/, '');
  const quotes = parseFile(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const q of quotes) {
    const key = keyOf(q.body);
    if (seen.has(key)) {
      all[seen.get(key)].folders.push(folder);
      continue;
    }
    seen.set(key, all.length);
    all.push({ key, ...q, folders: [folder] });
  }
}

// --- dry run ---------------------------------------------------------------
if (!COMMIT) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'quotes.json'), JSON.stringify(all, null, 2));

  // a skeleton curation file: body-key → [] (to be filled with subjects)
  const skeleton = Object.fromEntries(all.map((q) => [q.key, []]));
  fs.writeFileSync(path.join(OUT, 'subjects-skeleton.json'), JSON.stringify(skeleton, null, 2));

  console.log(`Parsed ${all.length} unique quotes from ${files.length} files → ${OUT}\n`);
  for (const q of all) {
    const attr = [q.attribution, q.work && `*${q.work}*`, q.citation && `(${q.citation})`, q.page != null && `p.${q.page}`]
      .filter(Boolean)
      .join(' ');
    console.log(`• [${q.key}]`);
    console.log(`    ${firstWords(q.body, 14)}${q.body.split(/\s+/).length > 14 ? '…' : ''}`);
    console.log(`    — ${attr || '(no attribution)'}${q.themes.length ? `   themes: ${q.themes.join(', ')}` : ''}`);
    console.log(`    folders: ${[...new Set(q.folders)].join(', ')}`);
  }
  const noAttr = all.filter((q) => !q.attribution);
  console.log(`\n${noAttr.length} without attribution:`, noAttr.map((q) => q.key).join(', ') || 'none');
  const dupKeys = all.filter((q) => q.folders.length > 1);
  console.log(`${dupKeys.length} appeared in multiple folders:`, dupKeys.map((q) => q.key).join(', ') || 'none');
} else {
  // --- real import (service-role; server-side one-off) ----------------------
  const url = process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing env. Run: node --env-file=.env.local scripts/import-quotes.mjs --commit');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const subjectsByKey = JSON.parse(fs.readFileSync('scripts/quotes-subjects.json', 'utf8'));

  // 1) ensure every subject named in the curation file exists (reuse existing slugs).
  //    Only array values are subject lists; string keys like "_note" are ignored.
  const allNames = [...new Set(Object.values(subjectsByKey).filter(Array.isArray).flat())];
  const subjectRows = allNames.map((n) => ({ name: n, slug: slugify(n) }));
  if (subjectRows.length) {
    const { error } = await sb.from('subjects').upsert(subjectRows, { onConflict: 'slug', ignoreDuplicates: true });
    if (error) throw error;
  }
  const { data: subjectList, error: selErr } = await sb.from('subjects').select('id, slug');
  if (selErr) throw selErr;
  const subjectIdBySlug = Object.fromEntries(subjectList.map((s) => [s.slug, s.id]));

  // 2) each quote → a `quote` fragment (upsert by slug, idempotent)
  let done = 0;
  for (const q of all) {
    const details = {};
    if (q.work) details.source_title = q.work;
    if (q.citation) details.citation = q.citation;
    if (q.page != null) details.page = q.page;
    const slug = slugify(`${q.attribution ?? ''} ${firstWords(q.body, 6)}`).slice(0, 80) || q.key;
    const row = {
      type: 'quote',
      title: null,
      slug,
      body: q.body,
      attribution: q.attribution || null,
      source_url: null,
      details,
      status: 'published',
      occurred_at: `${THIS_YEAR}-01-01T00:00:00Z`,
      date_precision: 'year',
    };
    const { data: frag, error: fragErr } = await sb.from('fragments').upsert(row, { onConflict: 'slug' }).select('id').single();
    if (fragErr) {
      console.error(`✗ ${q.key}:`, fragErr.message);
      continue;
    }
    const names = subjectsByKey[q.key] ?? [];
    const links = names
      .map((n) => subjectIdBySlug[slugify(n)])
      .filter(Boolean)
      .map((subject_id) => ({ fragment_id: frag.id, subject_id }));
    await sb.from('fragment_subjects').delete().eq('fragment_id', frag.id);
    if (links.length) {
      const { error } = await sb.from('fragment_subjects').insert(links);
      if (error) console.error(`  subjects for ${q.key}:`, error.message);
    }
    done++;
    process.stdout.write(`\r  imported ${done}/${all.length}`);
  }
  console.log(`\n✓ Done. ${done}/${all.length} quotes imported (published, subjects linked).`);
}
