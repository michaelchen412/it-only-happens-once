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
