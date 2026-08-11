/*
  The sitemap's XML, as a pure function (plan 34 · §4).

  ⚠ `@astrojs/sitemap` CANNOT DO THIS JOB HERE, and the reason is worth stating
  because installing it is what every guide says. Two independent blockers:

    1. It requires `site` in `astro.config.mjs`, which this project deliberately
       does not set — see `components/Social.astro`, which explains why naming
       `itonlyhappensonce.blog` today would point every canonical on the site at
       the old Squarespace blog that still answers there.

    2. **Nothing on this site is prerendered.** `output: 'server'` plus the
       Vercel adapter means every content URL — every essay, every quote, every
       constellation — comes out of Supabase at REQUEST time, while the
       integration walks the routes known at BUILD time. It would emit a
       technically valid sitemap listing `/`, `/blog`, `/about` and a handful of
       `[slug]` patterns it cannot expand: a file that looks like coverage and
       contains none of the corpus.

  So the sitemap is a route, and this file is the half of it that can be tested
  without a database.
*/

/** One URL in the sitemap. `path` is root-relative; the origin is added late. */
export interface SitemapEntry {
  /** Root-relative, e.g. `/blog/forgiveness`. */
  path: string;
  /**
   * ISO 8601, or null to omit `<lastmod>` entirely.
   *
   * ⚠ Omitting beats guessing. A `lastmod` a crawler catches being wrong is
   * worse than none at all — Google's documented behaviour is to stop trusting
   * the signal for the whole file, so the three static rooms below carry no
   * date rather than today's.
   */
  lastmod?: string | null;
}

/**
 * ⚠ THE PROJECT'S "no UTC on screen" RULE DOES NOT APPLY HERE, and this is the
 * one place that is true. That rule is about what a *viewer* reads; `<lastmod>`
 * is a wire format read by machines, and the W3C Datetime the protocol requires
 * is UTC. Rendering it in Michael's zone would be the one timestamp on this
 * site that is wrong for its audience.
 */
function lastmodOf(iso: string): string {
  return new Date(iso).toISOString();
}

/**
 * XML text escaping.
 *
 * Slugs are produced by `slugify` and cannot currently contain any of these —
 * which is exactly why this is here rather than skipped. The escaping is a
 * property of the format, not of today's data, and a sitemap that breaks the
 * day a slug rule loosens would break silently: an unparseable file is one a
 * crawler drops whole, with no error surfacing anywhere on this side.
 */
function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the sitemap document.
 *
 * @param origin `Astro.url.origin` — derived from the request, never
 *   configured, the same way `Social.astro` derives a canonical. This is what
 *   makes the file correct on every host without knowing which host it is on;
 *   `robots.txt` is what decides where it gets advertised.
 *
 * ⚠ NO `<changefreq>` AND NO `<priority>`. Google ignores both and has said so
 * publicly; emitting them is cargo, and each one is a second thing to keep
 * plausible. Note also that the 50,000-URL / 50MB ceiling is three orders of
 * magnitude away for a corpus in the low hundreds — **a sitemap index is not
 * wanted here**, recorded so nobody adds one for completeness.
 */
export function buildSitemap(origin: string, entries: SitemapEntry[]): string {
  const urls = entries.map((e) => {
    const loc = xml(new URL(e.path, origin).href);
    const mod = e.lastmod ? `\n    <lastmod>${lastmodOf(e.lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${loc}</loc>${mod}\n  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
