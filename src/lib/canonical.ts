/*
  One page, one address (plan 34 · §5).

  ⚠ THIS LIVED IN `components/Social.astro` AND WAS MIRRORED BY HAND IN
  `src/tests/social-meta.test.ts`, whose own header explains why: Astro
  components cannot be imported into vitest, so the test restated the rule
  rather than exercising it. That was fine while the rule never changed — and
  the first time it did (the trailing-slash fix below) the mirror would have
  gone on passing against the *old* logic, green and meaningless.

  So the rule moved here and both sides import it. One owner per fact, which is
  plan 29's whole argument applied to the one derivation that had two.
*/

/**
 * The canonical URL for a request.
 *
 * @param url      `Astro.url`.
 * @param override A page that is reachable at several addresses declaring which
 *   one is its own. The Reader is why this exists: `/blog/x`, `/blog#read=x`
 *   and `/{constellation}#read=x` are all legitimate ways to reach one essay,
 *   and exactly one of them is its address.
 */
export function canonicalHref(url: URL, override?: string): string {
  return override ?? new URL(canonicalPath(url.pathname), url.origin).href;
}

/**
 * Path only, with no trailing slash.
 *
 * ⚠ **The query string is dropped.** `?subject=`, `?q=` and `?page=` are the
 * reader's filter state, not different documents — left in, every combination
 * is indexed as a near-duplicate of the same feed, competing with it and with
 * each other.
 *
 * ⚠ **And the trailing slash is stripped, which is a BUG FIX.** This site
 * answers both `/blog/color` and `/blog/color/` with a 200 — Astro's
 * `trailingSlash` default is `'ignore'`, and nothing here had ever asked the
 * question. Taking the pathname verbatim meant the slashed form emitted a
 * canonical pointing AT ITSELF: not one page with one canonical, but two
 * indexable pages each vouching for its own address.
 *
 * It was not hypothetical. `@astrojs/rss` appends a trailing slash by default,
 * so the feed's first working build handed every essay a second self-declared
 * canonical. That call now passes `trailingSlash: false`, which fixes the feed;
 * this is what closes the same hole for every OTHER inbound link — an old
 * bookmark, a pasted URL, a referrer that normalises differently.
 *
 * *The alternative that lost:* `trailingSlash: 'never'` in `astro.config.mjs`,
 * which makes the slashed form 404 outright. Stricter, and it turns every
 * existing link wearing a slash into a dead end for a *reader* as well as a
 * crawler — a correctness fix that costs real people real pages. Answering both
 * and naming one is precisely what a canonical tag is for.
 */
export function canonicalPath(pathname: string): string {
  // `(.)` guards the root: `/` is the one path whose slash IS the path.
  return pathname.replace(/(.)\/+$/, '$1');
}
