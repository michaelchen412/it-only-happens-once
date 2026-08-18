// Plan 43 §5 — the URL-carried-dimensions convention, and what the sanitizer
// does with it. The srcset half (essay-images.ts) needs astro:assets and is
// exercised by the composer's e2e spec plus a real page; everything below is
// the pure layer both halves stand on.
import { describe, expect, it } from 'vitest';
import { imageDims, widthsFor } from '../lib/essay-image-attrs';
import { renderMarkdown } from '../lib/markdown';

const STORED = 'https://deodwnoztppvtrnehwzg.supabase.co/storage/v1/object/public/site/essays/abc/deadbeef.jpg';

describe('imageDims', () => {
  it('reads the convention off a public-storage URL', () => {
    expect(imageDims(`${STORED}?w=1600&h=1067`)).toEqual({ width: 1600, height: 1067 });
  });

  it('refuses everything else: no params, junk params, foreign hosts', () => {
    expect(imageDims(STORED)).toBeNull();
    expect(imageDims(`${STORED}?w=0&h=100`)).toBeNull();
    expect(imageDims(`${STORED}?w=abc&h=100`)).toBeNull();
    expect(imageDims(`${STORED}?w=1.5&h=100`)).toBeNull();
    // A hotlink's `?w=` could mean a CDN resize — never our convention.
    expect(imageDims('https://example.com/photo.jpg?w=800&h=600')).toBeNull();
    expect(imageDims('not a url')).toBeNull();
    expect(imageDims(undefined)).toBeNull();
  });
});

describe('widthsFor', () => {
  it('offers every ladder width up to the intrinsic one', () => {
    expect(widthsFor(1600)).toEqual([640, 750, 828, 1080, 1200]);
  });

  it('never asks the optimizer to upscale', () => {
    expect(widthsFor(830)).toEqual([640, 750, 828]);
  });

  it('a small image gets no srcset at all — one candidate is no choice', () => {
    expect(widthsFor(640)).toEqual([]);
    expect(widthsFor(400)).toEqual([]);
  });
});

describe('the sanitizer’s img transform', () => {
  it('every image loads lazily and decodes async, dims or not', () => {
    const html = renderMarkdown(`![a photo](https://example.com/p.jpg)`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).not.toContain('width=');
  });

  it('an uploaded image’s URL params become its width/height box', () => {
    const html = renderMarkdown(`![dusk](${STORED}?w=1600&h=1067)`);
    expect(html).toContain('width="1600"');
    expect(html).toContain('height="1067"');
    // The src keeps the params — the enhancer reads them from the sanitized
    // tag, and Supabase ignores them when the fallback is actually fetched.
    expect(html).toContain('w=1600');
  });

  it('authored raw-HTML attributes are kept, not clobbered', () => {
    // `loading="eager"` is the escape hatch if a piece ever leads with its
    // image (LCP) — the transform must defer to it.
    const html = renderMarkdown(`<img src="${STORED}?w=1600&h=1067" alt="x" loading="eager" width="10" height="5">`);
    expect(html).toContain('loading="eager"');
    expect(html).toContain('width="10"');
    expect(html).toContain('height="5"');
  });
});
