// `src/lib/sitemap.ts` builds the document a crawler uses to find the corpus.
// Pinned because every failure mode here is silent: an unparseable sitemap is
// dropped whole with no error surfacing on this side, and a sitemap listing the
// wrong origin is a sitemap for somebody else's site (plan 34 · §4).
import { describe, it, expect } from 'vitest';
import { buildSitemap } from '../lib/sitemap';

const ORIGIN = 'https://itonlyhappensonce.blog';

describe('buildSitemap', () => {
  it('makes every path absolute against the request origin', () => {
    // The origin is derived per request rather than configured, because
    // `astro.config.mjs` sets no `site` — so the same corpus has to produce a
    // correct document on whatever host is answering.
    const xml = buildSitemap('https://preview.example.com', [{ path: '/blog/forgiveness' }]);
    expect(xml).toContain('<loc>https://preview.example.com/blog/forgiveness</loc>');
  });

  it('emits lastmod as a W3C datetime when given one, and omits the tag otherwise', () => {
    const xml = buildSitemap(ORIGIN, [{ path: '/blog/a', lastmod: '2026-08-09T14:23:11.482Z' }, { path: '/about' }]);
    expect(xml).toContain('<lastmod>2026-08-09T14:23:11.482Z</lastmod>');
    // The entry without a date must carry no empty tag — an empty <lastmod> is
    // a parse error, not a shrug.
    expect(xml).toContain('<loc>https://itonlyhappensonce.blog/about</loc>\n  </url>');
  });

  it('escapes XML metacharacters in a path', () => {
    // `slugify` cannot currently produce these, which is exactly why this is
    // asserted: the escaping is a property of the format, so it has to survive
    // a future loosening of the slug rule that nobody thinks to re-check here.
    const xml = buildSitemap(ORIGIN, [{ path: '/blog/tom-&-jerry' }]);
    expect(xml).toContain('&amp;');
    expect(xml).not.toMatch(/<loc>[^<]*[^&]&[^a-z]/);
  });

  it('emits no changefreq and no priority', () => {
    // Google ignores both. They are two more things to keep plausible and zero
    // things gained — recorded as an assertion so a future "completeness" pass
    // has to argue with a red test rather than with a comment.
    const xml = buildSitemap(ORIGIN, [{ path: '/', lastmod: '2026-08-10T00:00:00.000Z' }]);
    expect(xml).not.toContain('changefreq');
    expect(xml).not.toContain('priority');
  });

  it('is a well-formed urlset with the sitemaps.org namespace', () => {
    const xml = buildSitemap(ORIGIN, [{ path: '/' }]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('survives an empty corpus without emitting a malformed document', () => {
    // Reachable: RLS returns nothing to a caller it does not trust, and a
    // first-run database has no rows at all.
    const xml = buildSitemap(ORIGIN, []);
    expect(xml).toContain('<urlset');
    expect(xml).toContain('</urlset>');
    expect(xml).not.toContain('<url>');
  });
});
