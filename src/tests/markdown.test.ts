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

// A link that opens a new tab hands it a `window.opener` back to this page, and
// the opened site can navigate its opener elsewhere — reverse tabnabbing.
// Markdown cannot emit `target`, so this only ever fires on raw HTML in a body,
// which is the same defense-in-depth argument as the allowlist above.
describe('renderMarkdown — a link that opens a tab cannot reach back', () => {
  it('adds rel="noopener" to an anchor that sets target', () => {
    const html = renderMarkdown('<a href="https://example.com" target="_blank">out</a>');
    expect(html).toMatch(/rel="[^"]*noopener/);
  });

  it('leaves an ordinary link alone — no target, nothing to sever', () => {
    // The case every essay is full of. A rel here would be noise on hundreds of
    // links to buy nothing.
    expect(renderMarkdown('[out](https://example.com)')).not.toMatch(/rel=/);
  });

  it('keeps a rel the author already wrote, rather than replacing it', () => {
    const html = renderMarkdown('<a href="https://example.com" target="_blank" rel="nofollow">out</a>');
    expect(html).toMatch(/nofollow/);
    expect(html).toMatch(/noopener/);
  });

  it('does not add noreferrer — Referrer-Policy owns that, in middleware', () => {
    // ⚠ Deliberate, and pinned so a later "harden it further" edit has to argue
    // with this line: the site answers the referrer question once, for every
    // response, as `strict-origin-when-cross-origin`. Making a subset of links
    // stricter here would put that answer in two places.
    const html = renderMarkdown('<a href="https://example.com" target="_blank">out</a>');
    expect(html).not.toMatch(/noreferrer/);
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

// A quote body is Markdown too (data-model §4), and for a long time the three
// public quote surfaces printed it raw instead — which is how the corpus's one
// TipTap-authored hard break shipped a visible `\` to the blog. The rule these
// pin is the one that was missing: the BACKSLASH IS THE SPELLING, NEVER THE
// TEXT. It has to hold for the CRLF the July import carries as well as for the
// bare newline the editor writes today.
describe('renderMarkdown — a quote body reaches the page as words', () => {
  it('never leaves the hard break’s backslash in the output', () => {
    for (const src of [
      'treat yourself.\\\nThe internal golden rule.',
      'treat yourself.\\\r\nThe internal golden rule.',
    ]) {
      const html = renderMarkdown(src, { breaks: true });
      expect(html).not.toMatch(/\\/);
      expect(html.match(/<br\s*\/?>/g)).toHaveLength(1);
    }
  });

  it('resolves the escapes TipTap writes around ordinary punctuation', () => {
    // The serializer escapes anything that could read as syntax. Printed raw,
    // these reached the reader as backslashes too — the same bug, quieter.
    expect(renderMarkdown('a literal \\* star', { breaks: true })).toMatch(/a literal \* star/);
    expect(renderMarkdown('snake\\_case', { breaks: true })).toMatch(/snake_case/);
  });
});

// The feed's quote card is the ONE surface that renders a full body and
// highlights a search term in it (an essay card highlights its `lede`, which is
// already flattened). Marking has to happen inside the render for the reasons
// `RenderOptions.highlight` gives; these pin what that buys and what it costs.
describe('renderMarkdown — search highlighting', () => {
  const hl = (md: string, term: string) => renderMarkdown(md, { breaks: true, highlight: term });

  it('marks every hit with the same markup Highlighted.astro emits', () => {
    const html = hl('The golden rule, and the internal rule', 'rule');
    expect(html.match(/<mark class="hl">rule<\/mark>/g)).toHaveLength(2);
  });

  it('marks across a hard break and around emphasis', () => {
    expect(hl('the rule\\\nanother rule', 'rule').match(/<mark/g)).toHaveLength(2);
    const em = hl('treat *others* as you would treat yourself', 'treat');
    expect(em).toMatch(/<em>others<\/em>/);
    expect(em.match(/<mark/g)).toHaveLength(2);
  });

  it('escapes each segment on its own, so a body cannot smuggle markup past it', () => {
    const html = hl('rule <img src=x onerror=alert(1)> rule', 'rule');
    expect(html).not.toMatch(/onerror/i);
    expect(html.match(/<mark/g)).toHaveLength(2);
  });

  it('leaves an entity beside a hit intact — the case that breaks marking HTML after the fact', () => {
    // `&` must still be an entity, and both apostrophes must be INSIDE their
    // mark. Slicing the rendered HTML at raw-text offsets cuts `&amp;` in half;
    // marking at the token level never sees an encoded string at all.
    const html = hl("don't & won't", "n'");
    expect(html).toMatch(/&amp;/);
    expect(html.match(/<mark class="hl">n'<\/mark>/g)).toHaveLength(2);
  });

  it('ignores a term below MIN_SEARCH, matching the DB filter and the debounce', () => {
    expect(hl('a rule', 'r')).not.toMatch(/<mark/);
    expect(hl('a rule', '  ')).not.toMatch(/<mark/);
  });

  // ⚠ THE REGRESSION THIS FILE EXISTS FOR. `marked.use()` is global and
  // permanent, so building the marking renderer that way would leave one
  // reader's search term highlighted in every essay the server rendered
  // afterwards. A fresh instance per call is what makes that impossible.
  it('does not leak the term into the next render', () => {
    hl('the rule', 'rule');
    expect(renderMarkdown('the rule', { breaks: true })).not.toMatch(/<mark/);
  });
});

// ⚠ A GOAL'S NOTES LEAN ON THIS, so it stops being incidental and becomes a
// promise. `goals.notes` is where a routine gets written down, and a routine
// written down is one keystroke from `- [ ]` — which would put a checklist on
// the one surface built to refuse progress (ADR-0013). GFM emits a disabled
// `<input>` for that syntax and the allowlist has never carried `input`, so it
// arrives as a plain bullet. That is the rule enforced by the pipeline instead
// of by discipline, and this test is what keeps it that way if the allowlist is
// ever widened for some unrelated tag.
describe('renderMarkdown — a task list is not a task', () => {
  it('renders GFM checkboxes as plain bullets, with nothing to tick', () => {
    const html = renderMarkdown('- [ ] brush teeth\n- [x] read the day\n- move', { breaks: true });
    expect(html).not.toMatch(/<input/i);
    expect(html).not.toMatch(/checkbox/i);
    // The words survive; only the control is gone.
    expect(html).toMatch(/brush teeth/);
    expect(html).toMatch(/read the day/);
    expect(html.match(/<li>/g)).toHaveLength(3);
  });
});

describe('stripMarkdown — the words, for a field that cannot render them', () => {
  /*
    ⚠ THE BLANK LINE IS PART OF THE WORDS. `\s{0,3}` allowed three characters of
    "indentation" before a block marker — and `\s` matches a newline, so with
    the `m` flag the allowance reached back across the blank LINE and deleted
    it. A jot with headings then arrived in a log entry a paragraph short, its
    heading run onto the end of the paragraph above.

    Both endings are asserted because the body that found this was pasted, and
    pasted text is where `\r\n` comes from.
  */
  it('⚠ keeps the blank line before a heading — both line endings', () => {
    expect(stripMarkdown('One.\n\n## Two\n\nThree.')).toBe('One.\n\nTwo\n\nThree.');
    expect(stripMarkdown('One.\r\n\r\n## Two\r\n\r\nThree.')).toBe('One.\r\n\r\nTwo\r\n\r\nThree.');
  });

  it('keeps the blank line before a quote, a list and a rule too', () => {
    expect(stripMarkdown('One.\n\n> Two\n\nThree.')).toBe('One.\n\nTwo\n\nThree.');
    expect(stripMarkdown('One.\n\n- Two\n\nThree.')).toBe('One.\n\nTwo\n\nThree.');
    expect(stripMarkdown('One.\n\n---\n\nThree.')).toBe('One.\n\n\n\nThree.');
  });

  it('still allows the three spaces of indentation CommonMark does', () => {
    expect(stripMarkdown('   ### Indented')).toBe('Indented');
    expect(stripMarkdown('   - item')).toBe('item');
  });

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
