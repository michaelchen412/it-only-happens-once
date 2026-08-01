// One-off backfill for paired media (docs/plans/04 Piece 3, ADR-0009):
//   • every essay carrying `details.media` gets a real `song` fragment
//   • `fragments.paired_song_id` points the essay at it
//
// WHY A SCRIPT AND NOT AN ACTION: this runs once against 50 rows that arrived
// from Squarespace years ago. It is not a second write path — nothing here is
// reachable from the app, and `details.media` keeps working untouched for the
// rows this cannot promote.
//
// WHAT IT CANNOT PROMOTE, and deliberately leaves alone:
//   • 2 Spotify PLAYLISTS. ADR-0009: a playlist belongs to a constellation as
//     its score, never to a song. These keep rendering from `details.media`.
// The 3 YouTube videos ARE promoted — they're songs, just not on Spotify, and
// YouTube's oEmbed names the channel, which is more than Spotify's gives us.
//
// DEDUPED BY URL, which is not a nicety: two tracks in this corpus are each
// paired to two different essays (internet-drama + the-problem-with-google, and
// a-life-well-lived + no-dont-ask-me-to-vote). One song row, two essays
// pointing at it.
//
// IDEMPOTENT: an essay that already has `paired_song_id` is skipped, and a song
// whose `source_url` already exists is reused rather than duplicated. Safe to
// run twice; the second run reports 0 created.
//
// SERVICE ROLE, which is allowed HERE and nowhere in request-handling code
// (the standing ground rule) — this is an operator tool run from a shell.
//
//   node --env-file=.env.local scripts/backfill-paired-songs.mjs            (dry run)
//   node --env-file=.env.local scripts/backfill-paired-songs.mjs --commit
import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.includes('--commit');

// --- duplicated from src/lib/, per the precedent set by backfill-vocab.mjs ---
// A .mjs script can't import a .ts module, and the alternative (a build step for
// a one-off) costs more than these fifteen lines.
const slugify = (s) =>
  (s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const YT_ID = '([A-Za-z0-9_-]{11})';
/** Mirror of parseSongRef in src/lib/media.ts — kept in step by media.test.ts. */
function parseSongRef(url) {
  const t = (url || '').trim();
  if (!t) return null;
  const yt =
    t.match(new RegExp(`youtu\\.be/${YT_ID}`)) ??
    t.match(new RegExp(`youtube\\.com/(?:watch\\?(?:[^#]*&)?v=|embed/|shorts/|live/|v/)${YT_ID}`));
  if (yt) return { provider: 'youtube', kind: 'video', id: yt[1] };
  const uri = t.match(/^spotify:(track|album):([A-Za-z0-9]+)$/);
  if (uri) return { provider: 'spotify', kind: uri[1], id: uri[2] };
  const web = t.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album)\/([A-Za-z0-9]+)/);
  if (web) return { provider: 'spotify', kind: web[1], id: web[2] };
  return null;
}
const songRefUrl = (ref) =>
  ref.provider === 'youtube'
    ? `https://www.youtube.com/watch?v=${ref.id}`
    : `https://open.spotify.com/${ref.kind}/${ref.id}`;

// --- env ---------------------------------------------------------------------
const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing Supabase env. Run with: node --env-file=.env.local scripts/backfill-paired-songs.mjs [--commit]');
  process.exit(1);
}
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  // Without these the 45 Spotify tracks would be promoted with no artist at
  // all — worse than not promoting them, because the rows would then look done.
  console.error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET.');
  console.error('The Spotify tracks have NO artist stored; the Web API is the only thing that knows. Refusing to run.');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// --- Spotify Web API ---------------------------------------------------------
let token = null;
async function accessToken() {
  if (token) return token;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Spotify token failed: ${res.status} ${await res.text()}`);
  token = (await res.json()).access_token;
  return token;
}

const pickImage = (images, want) => {
  const sized = (images ?? []).filter((i) => i.url && typeof i.width === 'number');
  if (!sized.length) return images?.[0]?.url ?? null;
  const big = sized.filter((i) => i.width >= want).sort((a, b) => a.width - b.width)[0];
  return (big ?? sized.sort((a, b) => b.width - a.width)[0]).url;
};
const yearOf = (d) => {
  const y = Number((d ?? '').slice(0, 4));
  return Number.isInteger(y) && y > 1000 ? y : null;
};

async function lookup(ref) {
  if (ref.provider === 'youtube') {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(songRefUrl(ref))}`,
      { headers: { accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const d = await res.json();
    return {
      title: d.title ?? '',
      artist: d.author_name ?? null,
      album: null,
      releaseYear: null,
      thumbnailUrl: d.thumbnail_url ?? null,
      artistIds: [],
      albumId: null,
    };
  }
  const res = await fetch(`https://api.spotify.com/v1/${ref.kind}s/${ref.id}`, {
    headers: { authorization: `Bearer ${await accessToken()}` },
  });
  if (!res.ok) return null;
  const d = await res.json();
  const artists = (d.artists ?? []).filter((a) => a.name);
  const isTrack = ref.kind === 'track';
  return {
    title: d.name ?? '',
    artist: artists.length ? artists.map((a) => a.name).join(', ') : null,
    album: isTrack ? (d.album?.name ?? null) : null,
    releaseYear: yearOf(isTrack ? d.album?.release_date : d.release_date),
    thumbnailUrl: pickImage(isTrack ? d.album?.images : d.images, 300),
    artistIds: artists.map((a) => a.id).filter(Boolean),
    albumId: isTrack ? (d.album?.id ?? null) : ref.id,
  };
}

// --- vocabulary facets (same shape as saveSong's resolveAuthor/resolveWork) ---
async function resolveAuthor(name) {
  const n = (name || '').trim();
  if (!n) return null;
  const slug = slugify(n);
  if (!COMMIT) return `(author:${slug})`;
  await sb.from('authors').upsert({ name: n, slug }, { onConflict: 'slug', ignoreDuplicates: true });
  const { data } = await sb.from('authors').select('id').eq('slug', slug).single();
  return data?.id ?? null;
}
async function resolveWork(title, authorId) {
  const t = (title || '').trim();
  if (!t) return null;
  const slug = slugify(t);
  if (!COMMIT) return `(work:${slug})`;
  await sb.from('works').upsert({ title: t, slug, author_id: authorId }, { onConflict: 'slug', ignoreDuplicates: true });
  const { data } = await sb.from('works').select('id').eq('slug', slug).single();
  return data?.id ?? null;
}

/** Unique across ALL fragments (data-model.md §6). Tracks slugs claimed in-run. */
const claimed = new Set();
async function uniqueSlug(base) {
  const root = base || 'untitled';
  for (let i = 0; i < 60; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    if (claimed.has(candidate)) continue;
    const { data } = await sb.from('fragments').select('id').eq('slug', candidate).limit(1);
    if (!data || data.length === 0) {
      claimed.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not find a free slug from "${root}"`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- run ---------------------------------------------------------------------
console.log(COMMIT ? '── COMMITTING ──' : '── DRY RUN (pass --commit to write) ──');

const { data: essays, error } = await sb
  .from('fragments')
  .select('id, slug, title, occurred_at, details, paired_song_id')
  .eq('type', 'writing')
  .is('deleted_at', null)
  .order('occurred_at');
if (error) throw error;

const withMedia = (essays ?? []).filter((e) => e.details?.media?.url);
console.log(`${withMedia.length} essays carry details.media\n`);

// Group essays by the canonical URL of what they cite, so a shared track
// becomes one song row.
const groups = new Map();
const skipped = [];
for (const e of withMedia) {
  const ref = parseSongRef(e.details.media.url);
  if (!ref) {
    skipped.push({ essay: e.slug, url: e.details.media.url });
    continue;
  }
  const canonical = songRefUrl(ref);
  if (!groups.has(canonical)) groups.set(canonical, { ref, essays: [] });
  groups.get(canonical).essays.push(e);
}

console.log(`${groups.size} distinct songs to promote · ${skipped.length} left on the details.media path\n`);

let created = 0;
let reused = 0;
let linked = 0;
let failed = 0;

for (const [canonical, { ref, essays: paired }] of groups) {
  // Already promoted? Reuse rather than duplicate — this is what makes a second
  // run a no-op.
  const { data: existing } = await sb
    .from('fragments')
    .select('id, title, attribution')
    .eq('type', 'song')
    .eq('source_url', canonical)
    .is('deleted_at', null)
    .limit(1);

  let songId = existing?.[0]?.id ?? null;
  let label = existing?.[0] ? `${existing[0].title} — ${existing[0].attribution}` : null;

  if (songId) {
    reused++;
    console.log(`  ↺ reuse   ${label}`);
  } else {
    const meta = await lookup(ref);
    if (!meta || !meta.title) {
      failed++;
      console.log(`  ✗ LOOKUP  ${canonical}  (no metadata — left on details.media)`);
      continue;
    }
    const artist = meta.artist ?? 'Unknown artist';
    label = `${meta.title} — ${artist}`;

    // occurred_at on a song means the year it was ADDED (plans/04 open qs).
    // These were added when the essay was written, so take the earliest essay
    // that cites it — not 2026, which would be a lie about a 2023 pairing.
    const year = Math.min(...paired.map((e) => new Date(e.occurred_at).getUTCFullYear()));

    const details = ref.provider === 'youtube' ? { youtube_id: ref.id } : { spotify_id: ref.id };
    if (meta.album) details.album = meta.album;
    if (meta.thumbnailUrl) details.thumbnail_url = meta.thumbnailUrl;
    if (meta.releaseYear) details.release_year = meta.releaseYear;
    if (meta.albumId) details.spotify_album_id = meta.albumId;
    if (meta.artistIds.length) details.spotify_artist_ids = meta.artistIds;

    const authorId = await resolveAuthor(artist);
    const workId = await resolveWork(meta.album, authorId);
    const slug = COMMIT ? await uniqueSlug(slugify(`${meta.title} ${artist}`)) : slugify(`${meta.title} ${artist}`);

    const row = {
      type: 'song',
      title: meta.title,
      slug,
      // No annotation. ADR-0009 calls a song without one "a link, not a
      // fragment" — but here the ESSAY is the annotation, which is the whole
      // idea of a pairing. `body` stays null until Michael writes one.
      body: null,
      attribution: artist,
      source_url: canonical,
      details,
      author_id: authorId,
      work_id: workId,
      status: 'published',
      occurred_at: new Date(`${year}-01-01T12:00:00Z`).toISOString(),
      date_precision: 'year',
      published_at: new Date(`${year}-01-01T12:00:00Z`).toISOString(),
    };

    if (COMMIT) {
      const { data: ins, error: insErr } = await sb.from('fragments').insert(row).select('id').single();
      if (insErr) {
        failed++;
        console.log(`  ✗ INSERT  ${label}: ${insErr.message}`);
        continue;
      }
      songId = ins.id;
    }
    created++;
    console.log(`  + create  ${label}${meta.releaseYear ? ` (${meta.releaseYear})` : ''} → added ${year}`);
    // Spotify's limit is a rolling 30s window; a small delay keeps a 46-call
    // burst comfortably inside it. Cheap insurance on a one-time script.
    await sleep(120);
  }

  for (const e of paired) {
    if (e.paired_song_id) {
      console.log(`      · ${e.slug} already paired — left alone`);
      continue;
    }
    if (COMMIT) {
      const { error: upErr } = await sb.from('fragments').update({ paired_song_id: songId }).eq('id', e.id);
      if (upErr) {
        failed++;
        console.log(`      ✗ link ${e.slug}: ${upErr.message}`);
        continue;
      }
    }
    linked++;
    console.log(`      → ${e.slug}`);
  }
}

console.log('\n── summary ──');
console.log(`songs created : ${created}`);
console.log(`songs reused  : ${reused}`);
console.log(`essays linked : ${linked}`);
console.log(`failures      : ${failed}`);
if (skipped.length) {
  console.log(`\nleft on details.media (${skipped.length}) — a song may not cite these:`);
  for (const s of skipped) console.log(`  ${s.essay}  ${s.url}`);
}
if (!COMMIT) console.log('\nNothing was written. Re-run with --commit.');
