/*
  /rss.xml — the feed (plan 34 · §5).

  Of everything plan 34 found, this is the one a reader would *feel* rather than
  audit: a site whose shape is essays, quotes and music had no feed at all, and
  the audience for a site like this is disproportionately people who still run a
  reader.

  ── WRITING ONLY, AND THAT IS THE DECISION THIS FILE CARRIES ────────────────

  The container has to match the thing, which is the same argument plan 33 makes
  about feelings and subjects.

    • **An essay is a feed item.** Title, date, body, and a reason to arrive in
      somebody's reader.
    • **A quote is not.** It has no title of its own — `blog/[slug].astro` has
      to MANUFACTURE one from its opening 70 characters just to fill a tab and a
      card. Seventy-seven published quotes arriving as seventy-seven untitled
      items would bury the essays inside the essays' own feed, and a reader who
      unsubscribes over that loses both.
    • **A song is not either.** Its content is an embed, and ADR-0009's
      annotation is dead by plan 33's finding — so a song here is a link to
      Spotify with no words around it.

  ⚠ **If quotes are ever wanted in a feed, they want their own — `/quotes.xml`.**
  Two feeds is a real answer; one mixed feed is the answer that makes both
  worse. Written down so it is a decision next time rather than a flag on this
  one.

  ── EXCERPT, NOT FULL CONTENT ───────────────────────────────────────────────

  Two reasons, and the second is the real one. An essay here is *typeset* — the
  Reader, the paired song, the constellation it sits in — and a feed reader
  renders none of it; the feed's job is to say *there is a new one, and here is
  how it opens*. And sending the whole body means every later edit either
  silently diverges from what was delivered or re-notifies everybody.
*/
import type { APIRoute } from 'astro';
import rss from '@astrojs/rss';
import { excerpt } from '../lib/markdown';
import { noted } from '../lib/read-log';
import { publicSupabase } from '../lib/supabase';

/**
 * ⚠ Twenty, not everything. A feed is a recent-items protocol, not an archive —
 * the archive is `/blog`, which the feed links into. Shipping 120 essays every
 * time a reader polls is bandwidth spent to tell them nothing new.
 */
const FEED_SIZE = 20;

/**
 * How long the edge may answer for the feed.
 *
 * ⚠ THIS IS THE ONE PUBLIC ROUTE THAT QUERIES THE DATABASE ON EVERY REQUEST,
 * and it is the worst one to leave that way — a feed is not visited, it is
 * POLLED. Every reader who subscribes installs a client that asks for this
 * document on a schedule, forever, whether or not anything has changed, and
 * unsubscribing is the only thing that stops it. Every other reader-facing
 * route already carries `s-maxage` (`/`, `/blog`, `/blog/[slug]`, `/{slug}`,
 * `/about`, `/sitemap.xml`); this one was simply never given one.
 *
 * Ten minutes rather than the sitemap's hour, and the difference is what the
 * document is FOR: a sitemap is a map a crawler consults, while this is the
 * channel a new essay actually arrives on. `stale-while-revalidate` means the
 * ceiling is the same either way — the origin is asked at most once per window
 * and every other poll is answered from the edge — so the shorter number costs
 * nothing and buys promptness on the one axis a subscriber can feel.
 */
const EDGE_TTL = 600;

export const GET: APIRoute = async (context) => {
  const { data, error } = await publicSupabase()
    .from('fragments')
    .select('slug, title, excerpt, body, occurred_at')
    .eq('type', 'writing')
    // Explicit, and belt to braces since 2026-08-27: this used to run under the
    // CALLER's session, whose drafts the filter was here to exclude. It reads
    // session-free now, so the document cannot vary by viewer rather than
    // merely being filtered until it doesn't — see `publicSupabase`.
    .eq('status', 'published')
    .is('deleted_at', null)
    /*
      ⚠ `occurred_at`, WHICH IS THE PIECE'S OWN DATE — matching `listWriting`,
      so the feed and the blog agree about what "latest" means. A feed ordered
      differently from the room it points into is a feed that reads as broken.

      *The alternative that lost:* `created_at`, so that publishing a backdated
      piece surfaces it at the top of everyone's reader. It buys discoverability
      for the legacy import and pays for it with a permanent disagreement
      between two orderings of the same corpus — and `updated_at`, the third
      option, is worse still: it would re-surface an essay as new every time a
      typo was fixed.
    */
    .order('occurred_at', { ascending: false })
    .limit(FEED_SIZE)
    // A failed read here is an EMPTY feed served with a 200 and a 600s edge
    // cache — a reader's app would say "no posts" with nothing logged anywhere
    // to disagree (plan 43 §4).
    .then(noted('rss: writing'));

  const res = await rss({
    title: 'It Only Happens Once',
    description: 'Essays, gathered into constellations — ways of seeing rather than topics.',
    // Derived from the request, never configured — `astro.config.mjs` sets no
    // `site`. See `components/Social.astro` for why, and `lib/robots.ts` for
    // what stops this being advertised on a host that should not be indexed.
    site: context.url.origin,
    /*
      ⚠ FALSE, AND IT IS A CORRECTNESS FIX RATHER THAN A STYLE PREFERENCE.
      `@astrojs/rss` appends a trailing slash by default, so the first build of
      this file emitted `/blog/color/` — and this site serves BOTH forms with a
      200 while `Social.astro` derives its canonical from `Astro.url.pathname`,
      which preserves whatever slash it was given. So the feed's URL would have
      answered, and then declared ITSELF canonical.

      That is §2's `.vercel.app` defect wearing a different costume: a second
      indexable address for every essay, each one vouching for itself. Caught by
      loading the route, not by `verify` — nothing in the gate can see it.

      ⚠ The narrow fix is here because the FEED must emit canonical URLs. The
      wider hole — that any inbound trailing-slash link still self-canonicalises
      — is NOT closed by this line and is recorded in plan 34 as a finding.
    */
    trailingSlash: false,
    items: (data ?? []).map((p) => ({
      title: p.title ?? 'Untitled',
      link: `/blog/${p.slug}`,
      pubDate: new Date(p.occurred_at),
      // The authored excerpt when there is one, the opening otherwise — the
      // same rule `listWriting` applies for a card, so the feed shows what the
      // blog shows rather than a second summary that can drift from it.
      description: (p.excerpt ?? '').trim() || excerpt(p.body, 400),
    })),
  });

  /*
    ⚠ SET ON THE WAY OUT, NOT PASSED IN, because `rss()` builds the `Response`
    itself and takes no header option. Mutating it is safe — a `Response` from
    the constructor has a mutable header guard, unlike one handed back by
    `fetch` — and it is the only seam this helper leaves.

    Safe to mark `public` for exactly the reason `sitemap.xml.ts` spells out at
    length: the query above filters `status = 'published'` EXPLICITLY rather
    than leaning on RLS, so Michael's session and a stranger's produce a
    byte-identical document. There is no per-session variant here for the CDN to
    hand to the wrong person — which is the property that makes a shared cache
    entry correct, and the one that would have to be re-checked if a field ever
    started varying by viewer.
  */
  /*
    ⚠ AND NOT WHEN THE READ FAILED (2026-08-27) — which is the case the comment
    at that query has described since plan 43 without anything acting on it:
    *"a failed read here is an EMPTY feed served with a 200 and a 600s edge
    cache — a reader's app would say 'no posts'."* Logging it made the failure
    visible; this is what stops the edge from repeating it to every subscriber
    who polls for the next ten minutes, and for the day of
    `stale-while-revalidate` after that. An empty feed is not a feed anyone
    should be able to cache.
  */
  res.headers.set(
    'Cache-Control',
    error ? 'private, no-store' : `public, s-maxage=${EDGE_TTL}, stale-while-revalidate=86400`,
  );
  return res;
};
