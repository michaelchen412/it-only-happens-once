// The two Cache-Control answers a public page gives — one place, because six
// rooms give them and they must not drift apart.
//
// ⚠ `max-age=60` IS FOR THE BROWSER, AND WITHOUT IT EVERY PREFETCH WAS WASTED
// (measured 2026-10-23, Chromium against production). Vercel's CDN consumes
// `s-maxage` and `stale-while-revalidate` and STRIPS them before the response
// leaves the edge, so the browser received a bare `public`: no lifetime, no
// validator, nothing it was allowed to reuse. The sky prefetches every suite on
// sight (`data-astro-prefetch="viewport"`), the router then fetched the same
// document again on the click — `fromPrefetchCache: false` on both, going in
// AND coming back out — and the bar crept across the top for a page that was
// already sitting in memory. That is "a loading bar for clicking in and out of
// constellations", and no amount of earlier or wider prefetching could fix it.
//
// ⚠ THE COST IS A MINUTE OF STALENESS IN ONE BROWSER, accepted 2026-10-23. A
// reader who already holds a page sees an edit up to 60s late. The CDN already
// imposed exactly that window on everyone, so this adds no new kind of
// staleness — it only lets the reader's own copy last as long as the edge's.
// The alternative that lost was an ETag: it makes the re-check cheaper but
// keeps the round trip, and the round trip is the delay being removed.
//
// ⚠ NEVER ON A PAGE THAT CAN CONTAIN A DRAFT OR A FAILED READ. Those take
// `PRIVATE_PAGE` — see the branch at each call site. A browser `max-age` on a
// failure would pin the empty room in that reader's cache the way `s-maxage`
// would pin it at the edge.
export const PUBLIC_PAGE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=86400';

export const PRIVATE_PAGE = 'private, no-store';
