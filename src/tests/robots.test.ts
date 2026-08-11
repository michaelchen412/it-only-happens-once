// `src/lib/robots.ts` decides whether the host being served may be indexed at
// all, and it is the fix for a defect that was live in production: the
// `.vercel.app` alias is crawlable, and `Social.astro` makes every page on it
// self-canonicalising, so the site had a complete indexable duplicate under a
// second hostname (plan 34 · §2).
//
// ⚠ THE ASSERTION THAT MATTERS IS THE CLOSED ONE. A later "cleanup" that
// widens `CANONICAL_HOSTS`, or drops the host check for a static file, would
// make that duplicate indexable again — and nothing about the site would look
// broken. This is a ratchet on a decision, not coverage of a function.
//
// A unit test rather than the e2e spec plan 34 · §2 sketched: `verify` is the
// gate that runs inside the Vercel build, the e2e suite deliberately is not
// (31 · §4), and the whole of this logic is pure. The e2e version would prove
// the route is wired up; this one proves the rule is right, and it proves it
// before a deploy rather than after.
import { describe, it, expect } from 'vitest';
import { robotsBody, CANONICAL_HOSTS } from '../lib/robots';

describe('robotsBody', () => {
  describe('on a host that is not canonical', () => {
    // The four that actually occur, rather than one representative: the
    // production alias is the live defect, previews are generated per commit,
    // and localhost is what every dev session hits.
    for (const host of [
      'it-only-happens-once.vercel.app',
      'it-only-happens-once-git-main-michaelchen412.vercel.app',
      'localhost:4321',
      '127.0.0.1:3000',
    ]) {
      it(`closes ${host} completely`, () => {
        const body = robotsBody(host, `https://${host}`);
        expect(body).toContain('Disallow: /\n');
        // ⚠ A `Sitemap:` line on a closed host would hand a crawler the full
        // list of URLs it was just told not to fetch — an index of the
        // duplicate, which is worse than saying nothing.
        expect(body).not.toContain('Sitemap:');
      });
    }
  });

  describe('on a canonical host', () => {
    const body = robotsBody('itonlyhappensonce.blog', 'https://itonlyhappensonce.blog');

    it('does not close the site', () => {
      // `Disallow: /` exactly — not `/admin`, which starts with the same slash.
      expect(body.split('\n')).not.toContain('Disallow: /');
    });

    it('advertises the sitemap absolutely, as the protocol requires', () => {
      expect(body).toContain('Sitemap: https://itonlyhappensonce.blog/sitemap.xml');
    });

    it('asks crawlers past the three private entrances', () => {
      expect(body).toContain('Disallow: /admin');
      expect(body).toContain('Disallow: /auth');
      expect(body).toContain('Disallow: /sign-in');
    });

    it('names no private path beyond those three', () => {
      // Politeness, not protection — RLS is the boundary. A robots.txt that
      // enumerates private rooms is a directory for anyone who reads it, so
      // the list staying short is the actual requirement.
      const disallows = body.split('\n').filter((l) => l.startsWith('Disallow:'));
      expect(disallows).toHaveLength(3);
    });
  });

  it('derives the sitemap origin from the request rather than a constant', () => {
    // The `www.` host is canonical too, and it must advertise ITS OWN sitemap —
    // a hardcoded origin here would send half the traffic cross-host.
    const body = robotsBody('www.itonlyhappensonce.blog', 'https://www.itonlyhappensonce.blog');
    expect(body).toContain('Sitemap: https://www.itonlyhappensonce.blog/sitemap.xml');
  });

  it('has not quietly grown a third canonical host', () => {
    // ⚠ Both entries are FALSE today — `itonlyhappensonce.blog` still resolves
    // to the old Squarespace blog — so every real host currently gets
    // `Disallow: /`, which is the correct answer while no host should be
    // indexed. Adding one is a deliberate act on the day DNS moves, and this
    // assertion is what makes it deliberate.
    expect([...CANONICAL_HOSTS].sort()).toEqual(['itonlyhappensonce.blog', 'www.itonlyhappensonce.blog']);
  });
});
