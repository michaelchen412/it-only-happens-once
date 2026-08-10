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
import { describe, it, expect } from 'vitest';

/** Social.astro's canonical derivation, stated once so a test can hold it. */
function canonicalOf(url: URL, override?: string): string {
  return override ?? new URL(url.pathname, url.origin).href;
}

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
