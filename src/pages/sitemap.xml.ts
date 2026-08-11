/*
  /sitemap.xml — the route (plan 34 · §4). The XML lives in `lib/sitemap.ts`,
  which explains why `@astrojs/sitemap` cannot do this job; this file is the
  gathering half.

  ── WHAT IS IN IT, AND WHAT IS DELIBERATELY NOT ─────────────────────────────

  In: `/`, `/blog`, `/about`, every published constellation, and every published
  writing and quote — the six URL shapes a reader can actually reach.

  Out, and each for its own reason rather than by oversight:

    • `/reading`, `/styleguide`, `/lab/*` — **dev-gated**. They are benches, not
      rooms, and `/reading` in particular was gated in 2026-08-09 precisely
      because a fabricated essay was indexable one route away from the real one.
      Plan 34 · §4 listed `/reading` in its sketch; that was written before this
      was checked, and it is wrong.
    • `/constellations` — a 301 to `/`. A sitemap lists canonical URLs; putting
      a redirect in one asks a crawler to discover the real page twice.
    • Songs — a `song` fragment has no permalink. `/blog/[slug]` resolves a
      writing or a quote and nothing else, so a song slug in here would be a
      404 with an invitation.
    • `/sign-in`, `/auth/*`, `/admin/*` — `robots.txt` already asks crawlers
      past them, and RLS is what actually stops them.
*/
import type { APIRoute } from 'astro';
import { buildSitemap, type SitemapEntry } from '../lib/sitemap';
import { listConstellations } from '../lib/constellations';

export const GET: APIRoute = async ({ url, locals }) => {
  const supabase = locals.supabase;

  const [constellations, { data: fragments }] = await Promise.all([
    // Reused rather than re-queried, and that is the point: this helper already
    // encodes "the public truth" — published only, and empty constellations
    // filtered out because one with no published placements is not in the sky
    // yet. A second query here would be a second definition of the same word.
    listConstellations(supabase),
    supabase
      .from('fragments')
      .select('slug, updated_at')
      .in('type', ['writing', 'quote'])
      /*
        ⚠ EXPLICIT, EVEN THOUGH RLS ALREADY SAYS SO — and plan 34 · §4 was
        wrong to argue otherwise. Its reasoning was "let RLS decide, so a draft
        cannot be listed by construction". True for a stranger. But this route
        runs under the CALLER's session, and Michael's session can read drafts:
        an admin who opened `/sitemap.xml` would generate a document containing
        unpublished slugs, and the cache header below would then be free to
        serve that document to everyone.

        `listConstellations` carries the same guard for the same reason, in its
        own words — *"the overview always shows the PUBLIC truth, even to the
        admin, whose session could otherwise see drafts."* One rule, stated
        twice, because the failure is silent both times.
      */
      .eq('status', 'published')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false }),
  ]);

  const entries: SitemapEntry[] = [
    // No `lastmod` on the three static rooms — see the type's own note. `/` and
    // `/about` genuinely cannot be dated from here, and one honest omission
    // beats three plausible guesses.
    { path: '/' },
    { path: '/blog' },
    { path: '/about' },
    ...constellations.map((c) => ({ path: `/${c.slug}` })),
    ...(fragments ?? []).map((f) => ({ path: `/blog/${f.slug}`, lastmod: f.updated_at })),
  ];

  return new Response(buildSitemap(url.origin, entries), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // The same register `/blog/[slug]` uses for a published piece. Safe to
      // share precisely because of the `status` filter above: every caller now
      // gets a byte-identical document, so there is no per-session variant for
      // the CDN to hand to the wrong person.
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
