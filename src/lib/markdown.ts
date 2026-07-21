// Render stored Markdown → HTML for public display.
//
// `fragments.body` and `pages` content are contractually Markdown (data-model
// §4, ADR-0003), authored through the TipTap composer by the single admin
// account. That trust model is why we don't ship a heavyweight sanitizer here;
// the input isn't user-generated. Callers wrap the output in `.reading` so it
// picks up the article typography from app.css.
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

/** Markdown string → HTML string (for `set:html`). Empty in → empty out. */
export function renderMarkdown(md: string | null | undefined): string {
  if (!md || !md.trim()) return '';
  return marked.parse(md, { async: false }) as string;
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
