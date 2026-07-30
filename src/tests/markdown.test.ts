// `renderMarkdown` is the one uncontrolled sink on the public site: its output
// is injected with `set:html` on every essay, quote and song annotation. The
// bodies are authored by one admin through TipTap, so this sanitizer is
// defense-in-depth (added in the 2026-07-22 security audit) — which is exactly
// the kind of property that breaks silently during an unrelated refactor.
// These tests pin it.
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../lib/markdown';

describe('renderMarkdown — what must never survive', () => {
  it('strips script tags', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> there');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/alert\(1\)/);
  });

  it('strips event-handler attributes', () => {
    expect(renderMarkdown('<img src="x" onerror="alert(1)">')).not.toMatch(/onerror/i);
  });

  it('drops javascript: URLs while keeping the link text', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toMatch(/click me/);
  });

  it('strips iframes — the embed is rendered by us, never by an author', () => {
    expect(renderMarkdown('<iframe src="https://evil.example"></iframe>')).not.toMatch(/<iframe/i);
  });
});

describe('renderMarkdown — what must survive', () => {
  it('keeps ordinary prose formatting', () => {
    const html = renderMarkdown('A *stressed* word and a [link](https://example.com).');
    expect(html).toMatch(/<em>stressed<\/em>/);
    expect(html).toMatch(/href="https:\/\/example\.com"/);
  });

  it('keeps paragraphs separate and turns a hard break into <br>', () => {
    expect(renderMarkdown('one\n\ntwo')).toMatch(/<p>one<\/p>\s*<p>two<\/p>/);
    // TipTap serializes a Shift+Enter as a backslash line-break.
    expect(renderMarkdown('line one\\\nline two')).toMatch(/<br\s*\/?>/);
  });

  it('is empty for empty input, so callers can test truthiness', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown('   ')).toBe('');
  });
});
