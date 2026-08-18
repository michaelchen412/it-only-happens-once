// The pure half of plan 43 §5 — everything about an essay image's attributes
// that can be decided from its URL alone, kept free of astro:assets so the
// unit suite can reach it (the enhancer that needs `getImage` is next door in
// essay-images.ts).
//
// THE CONVENTION THESE FUNCTIONS READ: an uploaded image's markdown embeds its
// own intrinsic size in the URL — `…/site/essays/<id>/<hash>.jpg?w=1600&h=1067`.
// The uploader has known both numbers all along (it decoded the bitmap to
// downscale it) and used to throw them away; carrying them in the URL means no
// schema change, no probe at render time, and a value that survives every
// round-trip the body makes (export, backup, the composer's own markdown
// view). Supabase Storage ignores query params on a public object URL.
import { IMAGE_WIDTHS } from '../../image-widths.mjs';

/** Only a Supabase public-storage URL is trusted to carry our convention —
 *  on a hotlinked image `?w=` could mean anything, including a CDN resize. */
const STORAGE_PUBLIC_PATH = '/storage/v1/object/public/';

export interface ImageDims {
  width: number;
  height: number;
}

/** The `?w=&h=` an uploaded image carries, or null for any other src. */
export function imageDims(src: string | undefined): ImageDims | null {
  if (!src) return null;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (!url.pathname.includes(STORAGE_PUBLIC_PATH)) return null;
  const width = Number(url.searchParams.get('w'));
  const height = Number(url.searchParams.get('h'));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Which ladder widths an essay image should offer: every allowlisted width up
 * to its own — the optimizer never upscales, so asking past the intrinsic
 * width would only add candidates that all serve the same original bytes.
 * Floor of 640 because the reading column never renders narrower than a phone
 * screen, and 224/448 exist for the About portrait's float, not for prose.
 *
 * Fewer than two candidates means a srcset is not worth emitting (one entry
 * offers the browser no choice); callers treat [] as "leave the tag alone".
 */
export function widthsFor(intrinsicWidth: number): number[] {
  const ladder = IMAGE_WIDTHS.filter((w) => w >= 640 && w <= intrinsicWidth);
  return ladder.length >= 2 ? ladder : [];
}

/**
 * What the browser should assume the image will RENDER at, per viewport —
 * `srcset` is inert without it. The reading column is `.prose-measure`
 * (68ch of 1.15rem Newsreader ≈ 640px); below that the image is the viewport
 * minus the page padding, approximated as 100vw. An approximation is fine
 * here — a candidate one rung off costs kilobytes, not correctness — but it
 * must err WIDE, because `sizes` smaller than the truth makes the browser
 * pick an image it then has to stretch.
 */
export const READING_SIZES = '(min-width: 704px) 640px, 100vw';
