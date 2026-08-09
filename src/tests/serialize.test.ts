// `jsonForScript` — the escaping that keeps a `<script type="application/json">`
// block from being broken out of (27 · §4).
//
// ⚠ THIS IS A SECURITY PROPERTY WITH THREE ASSERTIONS, and it had none until
// now. The function is one line, which is exactly why it is worth pinning: a
// future edit "simplifying" it back to `JSON.stringify` would look harmless in
// review, break nothing visible, and reopen a script-injection hole in every
// page that embeds data this way.
//
// The corpus is the reason it is not theoretical. Fragment bodies are prose
// Michael wrote, and prose about the web contains `</script>` and `<!--` as
// ordinary text — so the hostile string here is also just a thing somebody
// might one day quote in an essay.
import { describe, expect, it } from 'vitest';
import { jsonForScript } from '../lib/serialize';

describe('jsonForScript', () => {
  it('leaves no character that can close the tag it is embedded in', () => {
    // The attack in one value: `JSON.stringify` passes `<` and `>` through
    // untouched, so this string ends the <script> element and starts an <img>.
    const hostile = { body: '</script><img src=x onerror="alert(1)">' };
    const out = jsonForScript(hostile);

    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('</script');
    // `&` too, so the value cannot be reinterpreted through HTML entities in
    // any context that decodes them before the JSON parser sees it.
    expect(jsonForScript({ body: 'Tom & Jerry' })).not.toContain('&');
  });

  it('survives the HTML comment opener, which closes a script block just as well', () => {
    // `<!--` inside a script starts an HTML comment in the old parsing rules and
    // can swallow the rest of the block. It is the half of this that gets
    // forgotten, because it does not look like a tag.
    const out = jsonForScript({ note: '<!-- not a comment -->' });
    expect(out).not.toContain('<!--');
    expect(out).not.toContain('-->');
  });

  it('parses back to the identical value — the escaping costs nothing', () => {
    // The whole argument for `\\u003c` over stripping or entity-encoding: it is
    // still valid JSON and still the same string once parsed. If this ever
    // fails, the fix broke the data rather than the hole.
    const value = {
      title: 'On <script> tags & other <em>markup</em>',
      body: '</script>   — a line separator, an em dash, "quotes"',
      nested: { list: ['<a>', '&amp;', '>'] },
      n: 42,
      nil: null,
    };
    expect(JSON.parse(jsonForScript(value))).toEqual(value);
  });
});
