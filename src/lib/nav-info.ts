/*
  Names for router navigations that are not page changes — passed as `info` to
  `navigate()` from `astro:transitions/client`, and read back off every event
  the router dispatches for that navigation (`e.info`).

  ⚠ A CONSTANT IN A MODULE OF ITS OWN, AND THAT IS THE POINT OF THE FILE. Two
  scripts must agree on the string — the one that starts the navigation and the
  ones that treat it differently — and a typo in either is a silent no-op: the
  search would simply light the progress bar again. A shared import cannot be
  mistyped. It lives in `lib/` rather than beside `blog-feed.ts` because
  `route-progress.ts` runs on every public page, and importing the feed script
  to read one string would ship the feed everywhere.
*/

/**
 * A live search on /blog (scripts/blog-feed.ts). The router owns the URL and the
 * fetch; the swap is ours and replaces only the feed and the rail's filters, so
 * the field being typed into is never moved. No view transition, and no
 * progress bar — the dimmed feed is the feedback, as it always was.
 */
export const NAV_FEED_SEARCH = 'blog:feed-search';
