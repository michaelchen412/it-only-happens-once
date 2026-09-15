/**
 * The site's signature mark — the one shape, defined once (design.md §2/§8).
 *
 * A four-point star with CONCAVE arms and a deliberately uneven reach: the
 * vertical longer than the horizontal, the left tip a touch low. Struck once
 * rather than compass-drawn — which is the site's own thesis about a thing
 * that happens a single time. It replaced ✦ (U+2726), which was a typeface's
 * idea of a star rather than ours.
 *
 * `StarMark.astro` renders it in markup; `starMarkHtml()` exists for the one
 * place that builds a chip in JavaScript (the browser sheet's live placement),
 * so the path never gets copied.
 */
export const STAR_PATH = 'M12 1.4 Q12.9 9.8 22.6 12.3 Q13.1 13.9 12 22.6 Q10.9 14 1.4 11.7 Q11.1 10.2 12 1.4 Z';

export const STAR_VIEWBOX = '0 0 24 24';

/** The mark as a string, for markup assembled at runtime. Carries the same
 *  `width`/`height` attributes as the component, for the same reason — see
 *  `StarMark.astro`. */
export function starMarkHtml(className = ''): string {
  return (
    `<svg viewBox="${STAR_VIEWBOX}" width="1em" height="1em" class="star-mark${className ? ` ${className}` : ''}" ` +
    `aria-hidden="true" fill="none"><path d="${STAR_PATH}" fill="currentColor"/></svg>`
  );
}

/**
 * A constellation's own breathing phase, in seconds, as a negative offset.
 *
 * ⚠ SYNCHRONISED PULSING READS AS MACHINERY, which is the whole reason this
 * exists — `admin.css`'s `.sky-star` note puts it as *"a sky is alive without
 * asking to be watched"*. Every star runs the same 9s `star-breathe`, so
 * without a per-star delay a list of them beats like a cursor.
 *
 * ⚠ DERIVED FROM THE SLUG, NEVER RANDOM, and that is the load-bearing part: the
 * value has to be identical on the server and on the client, or the star would
 * jump on hydration — and identical across SURFACES, so a constellation
 * breathing in the sky and the same one in a search result are the same star
 * rather than two things wearing one name.
 *
 * Negative, so the animation starts mid-cycle rather than every star fading up
 * from its dimmest together on first paint.
 */
export function starPhase(slug: string): string {
  const sum = [...slug].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return `${-((sum % 90) / 10).toFixed(1)}s`;
}
