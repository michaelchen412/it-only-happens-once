/**
 * An `<Icon>` for DOM that a script builds (plan 42 · §4.B.5).
 *
 * ⚠ THIS EXISTS BECAUSE §4.B.5 COUNTED THE MARKUP AND MISSED THE SCRIPTS. The
 * finding listed four `＋` call sites, all of them `.astro`; swapping those left
 * **two more still rendering the character**, both built at runtime —
 * `pair-browser.ts`'s rebuilt pair cell and `entity-combo.ts`'s "＋ Add «text»"
 * — so the same button came out as an SVG or as a font glyph depending on
 * whether the server or the browser had drawn it last. That is a worse split
 * than the one the finding set out to close, and it is invisible to a grep for
 * `<Icon`.
 *
 * ⚠ IT CLONES RATHER THAN WRITING SVG, and the reason is that astro-icon's
 * output is not ours to hardcode. The build emits
 * `<svg data-icon="ph:plus"><use href="#ai:ph:plus"/></svg>` against a
 * page-level `<symbol>` sprite — an id scheme that belongs to the integration
 * and can change with it. `entry-meta.ts` already established the idiom here
 * (it clones the kind glyph out of the button that owns it); this is that, with
 * a name.
 *
 * ⚠ AND THE ICON MUST ALREADY BE ON THE PAGE — which is the real constraint,
 * because the sprite only carries symbols something rendered. Every caller so
 * far rebuilds a control whose siblings are still on screen, so the source is
 * there by construction. When it is not, the fallback is deliberately NOT the
 * `＋` character: a lone glyph reintroduces exactly the split this closes.
 * Nothing is drawn, the button keeps its accessible name, and the control is
 * still a control.
 */
export function cloneIcon(name: string, className?: string): SVGElement | null {
  const source = document.querySelector<SVGElement>(`svg[data-icon="${name}"]`);
  if (!source) return null;
  const copy = source.cloneNode(true) as SVGElement;
  if (className !== undefined) copy.setAttribute('class', className);
  // A cloned glyph is decoration in its new home whatever it was in its old
  // one: every caller here sits inside a control that carries its own name.
  copy.setAttribute('aria-hidden', 'true');
  copy.removeAttribute('id');
  return copy;
}
