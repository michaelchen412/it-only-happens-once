/**
 * Serialize a value as JSON that is safe to embed inside an HTML `<script>`
 * element (e.g. `<script type="application/json">` read via `set:html` and
 * parsed client-side with `JSON.parse(el.textContent)`).
 *
 * `JSON.stringify` does not escape `<`, `>`, or `&`, so a value containing the
 * literal `</script>` (or `<!--`) would break out of the tag. Escaping those
 * three to unicode sequences keeps the JSON valid and identical once parsed,
 * while making tag/comment breakout impossible.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
