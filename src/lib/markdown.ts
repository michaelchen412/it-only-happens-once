// Render stored Markdown → HTML for public display.
//
// `fragments.body` and `pages` content are contractually Markdown (data-model
// §4, ADR-0003), authored through the TipTap composer by the single admin
// account. Even so, we sanitize the rendered HTML as defense-in-depth: `marked`
// passes raw HTML through untouched and this output is injected with `set:html`,
// so the whole site's safety shouldn't rest on one uncontrolled sink — a stray
// <script>/onerror/`javascript:` must never reach a reader. Callers wrap the
// output in `.reading` so it picks up the article typography from app.css.
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({ gfm: true, breaks: false });

// Allowlist tuned to what `marked` emits from Markdown: prose, links, images,
// code, and tables. Everything else — scripts, iframes, event-handler attrs,
// `javascript:` URLs — is dropped. Image srcs may be remote or data: URIs.
const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
  allowedAttributes: {
    a: ['href', 'title', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    code: ['class'],
  },
  allowedClasses: { code: ['language-*', 'lang-*'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
};

/** Markdown string → sanitized HTML string (for `set:html`). Empty in → empty out. */
export function renderMarkdown(md: string | null | undefined): string {
  if (!md || !md.trim()) return '';
  const html = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(html, SANITIZE);
}

/**
 * Markdown → a single flat line of plain text — for excerpts, meta descriptions,
 * and word counts. Renders to HTML first (so entities/formatting resolve the same
 * way they will on the page), then strips tags and collapses whitespace. Block
 * boundaries become spaces so paragraphs don't run together.
 */
export function toPlainText(md: string | null | undefined): string {
  const html = renderMarkdown(md);
  if (!html) return '';
  return html
    .replace(/<\/(p|h[1-6]|li|blockquote|div|pre|tr)>/gi, ' ') // block ends → space
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '') // drop remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A short plain-text lede from Markdown, cut on a word boundary with an ellipsis.
 * Used for the blog feed cards; `line-clamp` handles the visual trim, so this
 * only needs to supply enough text to fill a few lines.
 */
export function excerpt(md: string | null | undefined, max = 400): string {
  const text = toPlainText(md);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:—–-]+$/, '') + '…';
}

/** Estimated minutes to read a Markdown body, at ~220 wpm (min 1). */
export function readingMinutes(md: string | null | undefined): number {
  const text = toPlainText(md);
  if (!text) return 1;
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}
