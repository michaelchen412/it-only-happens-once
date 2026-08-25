// Markdown → the words, for a plain `<input>` or `<textarea>`.
//
// ⚠ ITS OWN MODULE BECAUSE `lib/markdown.ts` MUST NOT REACH THE BROWSER. That
// one is the real renderer — `marked` plus `sanitize-html` — and importing it
// for this would put a sanitizer in every admin bundle to turn `**call mom**`
// into `call mom`. This is dependency-free on purpose.
//
// WHY IT EXISTS AT ALL: the notes editors are rich (2026-08-06), so a dump's
// body is now genuinely Markdown. The pile renders it, but triage hands the
// same text to surfaces that CANNOT: a task's title is an `<input>`, a log
// entry's body is a `<textarea>`. Sending `**` into those is the marks leaking
// out of the one place that understands them.
//
// ⚠ DELIBERATELY NOT A PARSER. It reads a jotting, not a document, and every
// case it misses degrades to a stray character in a field you are looking at
// and can edit. A real Markdown parser here would be a dependency and a
// correctness claim, in service of a task title.

/** Strip Markdown syntax, keeping the words and the line structure. */
export function stripMarkdown(md: string): string {
  return (
    md
      // A picture is not a task title. Dropped whole — alt text and all,
      // because "A snowy road at dusk" as the name of an errand is worse than
      // nothing. Before links, or the `!` would be left behind.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      /*
        Block marks, at the start of a line only.

        ⚠ `[ \t]`, NEVER `\s`, AND THIS COST A PARAGRAPH (2026-08-25). These
        read `\s{0,3}` — "up to three spaces of indentation" — but `\s` matches
        a NEWLINE, and with the `m` flag `^` sits immediately after one. So on
        `care.\r\n\r\n### Part Two`, the three-character allowance happily ate
        the `\r\n` that was the blank LINE, and the heading's words were left
        joined to the end of the paragraph above it: `care.\rPart Two`.

        It surfaced as a jot with headings arriving in a log entry one paragraph
        short, and it is worth being exact about what was wrong: not the
        stripping, which did its job, but the boundary the marker was also
        carrying. CommonMark's allowance is horizontal space, and so is this.
      */
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
      .replace(/^[ \t]{0,3}([-*+]|\d+[.)])[ \t]+/gm, '')
      .replace(/^[ \t]{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/gm, '')
      // Inline marks. `~~` before `*`/`_` so a struck **bold** unwraps cleanly.
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
      .replace(/(\*|_)(?=\S)([\s\S]*?\S)\1/g, '$2')
      .replace(/`([^`]+)`/g, '$1')
      // The hard break TipTap writes — the newline is the break, the backslash
      // is only how Markdown spells it.
      .replace(/\\$/gm, '')
      // Anything that was escaped to survive the round trip is now just itself.
      .replace(/\\([\\`*_{}[\]()#+\-.!~>])/g, '$1')
      .trim()
  );
}
