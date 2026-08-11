// The link-preview tags (components/Social.astro, plan 32 · §2).
//
// ⚠ THESE EXIST BECAUSE A MISSING META TAG HAS NO SYMPTOM ON THE PAGE IT IS
// MISSING FROM. Nothing renders wrong, nothing throws, no check goes red — you
// find out when a link you already sent someone shows up as a grey rectangle.
// That is the same class of silence as the slug bug in §1, and it wants the
// same answer: pin the rule where it can fail loudly.
//
// Astro components cannot be imported into vitest, so these assert the two
// rules that are pure logic and that a future edit is most likely to get wrong.
// The tags themselves are covered by the e2e suite, which can render a page.
//
// ⚠ THE CANONICAL RULE IS NOW IMPORTED, NOT RESTATED — changed 2026-08-10
// (plan 34 · §5). This file used to carry its own copy of the derivation, on
// the reasoning above, and that copy was the problem: the first time the real
// rule changed, the mirror kept passing against the version it had memorised.
// A test that cannot fail when the code changes is not a test. `canonicalHref`
// lives in `lib/canonical.ts` and `Social.astro` imports the same function.
import { describe, it, expect } from 'vitest';
import { canonicalHref as canonicalOf } from '../lib/canonical';

/** Social.astro's card choice. An image is the whole difference. */
const twitterCard = (image: string | null) => (image ? 'summary_large_image' : 'summary');

describe('the canonical URL', () => {
  it('DROPS THE QUERY STRING — the feed is one document, not forty', () => {
    // `?subject=`, `?q=` and `?page=` are the reader's filter state, not
    // different pages. Left in, every combination is indexed as a near-duplicate
    // of the same feed, and they compete with each other.
    const u = new URL('https://example.com/blog?view=quotes&subject=grief&page=3');
    expect(canonicalOf(u)).toBe('https://example.com/blog');
  });

  it('keeps the path exactly, including a permalink’s slug', () => {
    const u = new URL('https://example.com/blog/never-complain-never-explain');
    expect(canonicalOf(u)).toBe('https://example.com/blog/never-complain-never-explain');
  });

  it('STRIPS A TRAILING SLASH — the slashed form must not vouch for itself', () => {
    // This site answers both forms with a 200 (Astro's `trailingSlash` default
    // is `'ignore'`). Taken verbatim, `/blog/color/` emitted a canonical
    // pointing at ITSELF — two indexable pages, each declaring its own address
    // the real one. `@astrojs/rss` appends that slash by default, so the feed's
    // first build handed every essay a second self-declared canonical.
    expect(canonicalOf(new URL('https://example.com/blog/color/'))).toBe('https://example.com/blog/color');
    expect(canonicalOf(new URL('https://example.com/about/'))).toBe('https://example.com/about');
    // A path can arrive with more than one, from a naive join upstream.
    expect(canonicalOf(new URL('https://example.com/blog/color//'))).toBe('https://example.com/blog/color');
  });

  it('leaves the root alone — `/` is the one path whose slash IS the path', () => {
    // Stripping here would emit an empty canonical, which is worse than the
    // duplicate it was fixing.
    expect(canonicalOf(new URL('https://example.com/'))).toBe('https://example.com/');
  });

  it('still drops the query when the path also carries a slash', () => {
    // The two rules compose; each was added at a different time, and this is
    // the case neither one's own test would catch.
    const u = new URL('https://example.com/blog/?view=quotes&page=2');
    expect(canonicalOf(u)).toBe('https://example.com/blog');
  });

  it('follows the REQUEST’s origin rather than a hardcoded domain', () => {
    // astro.config sets no `site`, deliberately: `itonlyhappensonce.blog` still
    // resolves to the old Squarespace blog, so hardcoding it would point every
    // canonical on this site at somebody else's page. Deriving is always right
    // for the host actually serving, and starts producing the real domain by
    // itself the day DNS moves.
    expect(canonicalOf(new URL('https://it-only-happens-once.vercel.app/about'))).toBe(
      'https://it-only-happens-once.vercel.app/about',
    );
    expect(canonicalOf(new URL('http://localhost:4321/about'))).toBe('http://localhost:4321/about');
  });

  it('lets a page override it — the Reader means one essay has three URLs', () => {
    // `/blog/x`, `/blog#read=x` and `/{constellation}#read=x` are all legitimate
    // ways to reach one piece. Exactly one of them is its address.
    const u = new URL('https://example.com/conditions-not-character');
    expect(canonicalOf(u, 'https://example.com/blog/forgiveness')).toBe('https://example.com/blog/forgiveness');
  });
});

describe('the twitter card kind', () => {
  it('asks for the large card only when there is an image to be large about', () => {
    expect(twitterCard('https://example.com/og/x.png')).toBe('summary_large_image');
    expect(twitterCard(null)).toBe('summary');
  });
});
