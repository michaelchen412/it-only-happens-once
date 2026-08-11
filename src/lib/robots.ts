/*
  robots.txt, as a rule rather than a file (plan 34 · §2).

  ⚠ THIS EXISTS TO CLOSE A LIVE DEFECT, NOT AS HOUSEKEEPING. Vercel sends
  `X-Robots-Tag: noindex` on PREVIEW deployments; it does not send it on the
  production `.vercel.app` alias. And `Social.astro` derives every canonical
  from `Astro.url.origin` — correctly, and for a reason its own header explains:
  `astro.config.mjs` sets no `site`, because `itonlyhappensonce.blog` still
  resolves to the old Squarespace blog, so hardcoding it would point every
  canonical on this site at somebody else's page.

  The two together mean the production alias is crawlable, indexable, and
  SELF-canonicalising: a complete duplicate of this site under a second
  hostname, with nothing anywhere telling a crawler which one is real. The day
  DNS moves to `.blog`, that copy is already established and competing with it.

  ── WHY A ROUTE AND NOT `public/robots.txt` ─────────────────────────────────

  A static file is one body for every host, and the whole problem is that the
  right answer DIFFERS BY HOST. So the answer is computed per request, from the
  host actually being served.

  *The alternative that lost:* a `<meta name="robots">` in `Base.astro`, keyed
  on host. Same logic, and it fails the one case that matters — a crawler asks
  for `/robots.txt` BEFORE it fetches any page, so the meta version only speaks
  after the crawl it was meant to prevent has already happened.

  ⚠ AND THE ONE HARDCODED DOMAIN IN THE PROJECT LIVES HERE, DELIBERATELY.
  `Social.astro` refuses to name a host because naming the wrong one there
  produces a WRONG CANONICAL on the live site. Naming it here produces, at
  worst, `Disallow: /` on a host nobody has pointed at yet — the failing-safe
  direction, and the reason the same refusal does not apply.

  **Today both entries below are false, so every host gets `Disallow: /`, and
  that is correct**: there is currently no host that should be indexed. This
  file starts earning the day DNS moves, and it is one line to switch.
*/

/**
 * The hosts this site may be indexed on.
 *
 * ⚠ `URL.host`, not `hostname` — it carries the port, so `localhost:4321` and
 * any preview alias fall through to the closed branch by construction rather
 * than by an exception someone has to remember to write.
 */
export const CANONICAL_HOSTS: ReadonlySet<string> = new Set(['itonlyhappensonce.blog', 'www.itonlyhappensonce.blog']);

/**
 * ⚠ POLITENESS, NOT PROTECTION — and the list is deliberately three entries.
 *
 * RLS and the middleware are the boundary; a `robots.txt` that enumerates
 * private paths is a directory for anyone who reads it. `/admin` is one segment
 * and reveals nothing `/sign-in` doesn't already. **Do not extend this to
 * `/admin/people`, `/admin/agenda` or anything else** — those are already
 * unreachable, and naming them turns a courtesy into a map.
 */
const DISALLOWED = ['/admin', '/auth', '/sign-in'];

/**
 * The body of `/robots.txt` for the host actually being served.
 *
 * @param host   `Astro.url.host` — hostname plus port.
 * @param origin `Astro.url.origin` — used to make the `Sitemap:` line absolute,
 *               which the protocol requires. Derived rather than configured,
 *               the same way `Social.astro` derives a canonical.
 */
export function robotsBody(host: string, origin: string): string {
  if (!CANONICAL_HOSTS.has(host)) {
    // Every non-canonical host: previews, the `.vercel.app` alias, localhost.
    return ['User-agent: *', 'Disallow: /', ''].join('\n');
  }

  return [
    'User-agent: *',
    ...DISALLOWED.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${new URL('/sitemap.xml', origin).href}`,
    '',
  ].join('\n');
}
