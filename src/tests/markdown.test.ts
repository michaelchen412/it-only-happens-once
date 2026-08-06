// `renderMarkdown` is the one uncontrolled sink on the public site: its output
// is injected with `set:html` on every essay, quote and song annotation. The
// bodies are authored by one admin through TipTap, so this sanitizer is
// defense-in-depth (added in the 2026-07-22 security audit) — which is exactly
// the kind of property that breaks silently during an unrelated refactor.
// These tests pin it.
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../lib/markdown';
import { stripMarkdown } from '../lib/markdown-plain';

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

// The notes pile renders with `breaks: true` (docs/admin.md §5b). What makes
// that safe is that BOTH spellings of a line break collapse to one `<br>`: the
// bare newlines in every dump typed before the editor was rich, and the
// `\`-terminated breaks TipTap writes now. If these ever disagree, the pile
// starts double-spacing the old jottings.
describe('renderMarkdown — the notes pile’s line breaks', () => {
  it('turns a lone newline into a break only when asked', () => {
    expect(renderMarkdown('call mom\nbuy milk')).not.toMatch(/<br/);
    expect(renderMarkdown('call mom\nbuy milk', { breaks: true })).toMatch(/<br\s*\/?>/);
  });

  it('renders a backslash break as ONE break under either setting', () => {
    const plain = renderMarkdown('call mom\\\nbuy milk');
    const broken = renderMarkdown('call mom\\\nbuy milk', { breaks: true });
    expect(plain.match(/<br\s*\/?>/g)).toHaveLength(1);
    expect(broken.match(/<br\s*\/?>/g)).toHaveLength(1);
  });

  it('still separates paragraphs rather than breaking them', () => {
    expect(renderMarkdown('one\n\ntwo', { breaks: true })).toMatch(/<p>one<\/p>\s*<p>two<\/p>/);
  });
});

describe('stripMarkdown — the words, for a field that cannot render them', () => {
  it('unwraps inline marks', () => {
    expect(stripMarkdown('**call** the *dentist* about ~~the~~ `thing`')).toBe('call the dentist about the thing');
  });

  it('keeps a link’s text and drops an image whole', () => {
    expect(stripMarkdown('ask [Sam](https://example.com) first')).toBe('ask Sam first');
    expect(stripMarkdown('![A snowy road at dusk](/x.jpg)the errand')).toBe('the errand');
  });

  it('drops block marks and keeps the line structure', () => {
    expect(stripMarkdown('## Groceries\n- milk\n- bread')).toBe('Groceries\nmilk\nbread');
    expect(stripMarkdown('> she said it twice')).toBe('she said it twice');
  });

  it('drops the backslash TipTap uses to spell a hard break', () => {
    expect(stripMarkdown('call mom\\\nbuy milk')).toBe('call mom\nbuy milk');
  });

  it('leaves a jotting with no syntax in it exactly as it was', () => {
    const plain = 'dinner with Ada — 7pm, the place on 4th';
    expect(stripMarkdown(plain)).toBe(plain);
  });
});
