// Render stored Markdown → HTML for public display.
//
// `fragments.body` and `pages` content are contractually Markdown (data-model
// §4, ADR-0003), authored through the TipTap composer by the single admin
// account. Even so, we sanitize the rendered HTML as defense-in-depth: `marked`
// passes raw HTML through untouched and this output is injected with `set:html`,
// so the whole site's safety shouldn't rest on one uncontrolled sink — a stray
// <script>/onerror/`javascript:` must never reach a reader. Callers wrap the
// output in `.reading` so it picks up the article typography from app.css.
import { Marked, marked, type RendererObject, type Tokens } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { countWords, minutesForWords } from './reading';
import { MIN_SEARCH, highlight } from './search-highlight';

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
    // The search highlight below, and only that — `allowedClasses` pins the
    // value, so an authored `<mark class="anything-else">` still loses it.
    mark: ['class'],
  },
  allowedClasses: { code: ['language-*', 'lang-*'], mark: ['hl'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  transformTags: {
    /**
     * A link that opens a new tab hands that tab a `window.opener` back to this
     * page, and the opened site can then navigate its opener somewhere else —
     * reverse tabnabbing. `noopener` severs that reference.
     *
     * ⚠ ONLY WHEN `target` IS SET, and that is the whole shape of this. Markdown
     * cannot emit `target`, so this can only ever fire on raw HTML written into
     * a body — which makes it defense-in-depth exactly like the allowlist above,
     * and means the ordinary link every essay is full of stays untouched rather
     * than carrying an attribute it has no use for.
     *
     * ⚠ `noopener` AND NOT `noreferrer`, WHICH IS A DECISION RATHER THAN AN
     * OMISSION. `noreferrer` additionally strips the `Referer` header, and this
     * site already answers that question one layer up: `src/middleware.ts` sets
     * `Referrer-Policy: strict-origin-when-cross-origin` on every response, on
     * the stated reasoning that a reader arriving at Spotify from a
     * constellation should hand over the origin and not the path. Quietly making
     * a subset of links stricter than the site's own policy would put the answer
     * in two places and let them disagree.
     *
     * Any `rel` the author wrote is kept — this adds to the set rather than
     * replacing it, so `rel="nofollow"` survives with `noopener` beside it.
     */
    a: (tagName, attribs) => {
      if (!attribs.target) return { tagName, attribs };
      const rel = new Set((attribs.rel ?? '').split(/\s+/).filter(Boolean));
      rel.add('noopener');
      return { tagName, attribs: { ...attribs, rel: [...rel].join(' ') } };
    },
  },
};

export interface RenderOptions {
  /**
   * Treat a lone newline as a line break, the way the notes pile needs.
   *
   * ⚠ OFF for an essay, and that is the whole reason this is an option rather
   * than a setting. In prose a wrapped source line is not a break, and turning
   * every one into a `<br>` would shred fifty imported essays. A **jotting** is
   * the opposite case: its line breaks are its structure, and the pile has to
   * render the plain text typed before the editor was rich exactly as it looks
   * in the box. Both forms land in the same place — a `\`-terminated hard break
   * (what TipTap serializes) renders as one `<br>` either way.
   */
  breaks?: boolean;
  /**
   * Wrap every occurrence of this term in `<mark class="hl">` — the same markup
   * `Highlighted.astro` emits, so a highlighted body and a highlighted
   * attribution read as one result. Below `MIN_SEARCH` it is ignored, which
   * matches the DB filter and the client debounce.
   *
   * ⚠ WHY THIS LIVES INSIDE THE RENDERER AND NOT AFTER IT. The obvious shape is
   * to render first and mark the HTML afterwards, and it is wrong twice over:
   * the offsets you would be slicing at are in ENCODED space, so a match beside
   * an entity cuts `&amp;` in half, and a naive text-node walk has to un-escape
   * and re-escape user text — the one thing `Highlighted` was built never to do
   * ("only the `<mark>` element is real markup"). Marking at the token level
   * keeps both properties: the offsets come from the RAW text, where they are
   * honest, and each segment is escaped on its own, so no author's characters
   * ever pass through a decode step.
   *
   * The cost, stated: a match that straddles a mark boundary — `treat` across
   * `*treat* others` — is two tokens and highlights as neither. That is the
   * same limit every HTML-aware highlighter has, and it fails by showing you an
   * unmarked hit rather than by breaking the markup.
   */
  highlight?: string;
}

/** Marked's own escaping rule, applied per segment (see `highlight` above). */
const escapeText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * A `text` renderer that marks `term` and otherwise behaves exactly like the
 * stock one — the two guard clauses are Marked v18's own (`Renderer.prototype
 * .text`), and dropping either would swallow every inline child token.
 */
function markingRenderer(term: string): RendererObject {
  return {
    text(token: Tokens.Text | Tokens.Escape): string {
      if ('tokens' in token && token.tokens) return this.parser.parseInline(token.tokens);
      if ('escaped' in token && token.escaped) return token.text;
      return highlight(token.text, term)
        .map((s) => (s.hit ? `<mark class="hl">${escapeText(s.text)}</mark>` : escapeText(s.text)))
        .join('');
    },
  };
}

/** Markdown string → sanitized HTML string (for `set:html`). Empty in → empty out. */
export function renderMarkdown(md: string | null | undefined, opts: RenderOptions = {}): string {
  if (!md || !md.trim()) return '';
  const breaks = opts.breaks ?? false;
  const term = opts.highlight?.trim() ?? '';
  // ⚠ A FRESH INSTANCE PER HIGHLIGHTED CALL, never `marked.use(…)`. `use` is
  // global and permanent: one search would leave its own term marking every
  // essay rendered by every later request this server handles.
  const html =
    term.length >= MIN_SEARCH
      ? (new Marked({ gfm: true, breaks }).use({ renderer: markingRenderer(term) }).parse(md, {
          async: false,
        }) as string)
      : (marked.parse(md, { async: false, breaks }) as string);
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

/** Estimated minutes to read a Markdown body, at ~220 wpm (min 1). The rule
 *  itself lives in ./reading, dependency-free, so the writing composer's live
 *  gauge can share it without pulling this module into the client bundle. */
export function readingMinutes(md: string | null | undefined): number {
  return minutesForWords(countWords(toPlainText(md)));
}
