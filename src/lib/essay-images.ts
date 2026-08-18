// The srcset half of plan 43 §5 — the part that needs `astro:assets`.
//
// LAYERING, because two halves live in two places on purpose: the sanitizer
// (markdown.ts) adds `loading`/`decoding`/`width`/`height` synchronously for
// EVERY rendered body — essays, notes, About — while this pass adds
// `srcset`/`sizes` only where PostArticle renders an essay, because it must
// await `getImage` and a sanitize-html transform cannot.
//
// ⚠ `getImage`, NOT HAND-BUILT `/_vercel/image?…` URLS. The About portrait
// already proved this exact path in both environments: the same call emits
// `/_image` URLs under `astro dev` (served by the sharp devImageService, with
// the same width snapping) and `/_vercel/image` URLs in production. A
// hand-built prod URL would have been dead in dev — either broken images or
// an untestable branch, and the imagesConfig note in astro.config.mjs exists
// because a dev/prod divergence in exactly this system already hid one bug.
//
// ⚠ `src` IS LEFT POINTING AT THE ORIGINAL STORAGE OBJECT. A browser that
// understands `srcset` never fetches it once candidates exist; one that
// doesn't gets the same full-size image it got before this pass existed.
// Degrading to yesterday is the right floor.
//
// Cost, stated: one `getImage` call per qualifying image per render — URL
// construction only (the dimensions ride in, so nothing is ever fetched to
// probe), behind every essay route's 60s edge cache.
import { getImage } from 'astro:assets';
import { READING_SIZES, imageDims, widthsFor } from './essay-image-attrs';

/** sanitize-html re-serializes every tag with double-quoted attributes, which
 *  is what makes a targeted match reliable here — this parses OUR sanitizer's
 *  output, not arbitrary HTML. */
const IMG_TAG = /<img\s[^>]*\/?>/g;
const SRC_ATTR = /\bsrc="([^"]*)"/;

const unescapeAttr = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * Add `srcset`/`sizes` to every sanitized essay `<img>` whose URL carries its
 * own dimensions. Tags without the convention (older bodies, hotlinks) pass
 * through byte-identical.
 */
export async function enhanceEssayImages(html: string): Promise<string> {
  if (!html.includes('<img')) return html;

  const jobs = new Map<string, Promise<string | null>>();
  for (const [tag] of html.matchAll(IMG_TAG)) {
    if (jobs.has(tag)) continue;
    const rawSrc = tag.match(SRC_ATTR)?.[1];
    const src = rawSrc ? unescapeAttr(rawSrc) : '';
    const dims = imageDims(src);
    const widths = dims ? widthsFor(dims.width) : [];
    jobs.set(
      tag,
      widths.length === 0
        ? Promise.resolve(null)
        : getImage({ src, width: dims!.width, height: dims!.height, widths })
            .then((image) =>
              image.srcSet.values.length < 2
                ? null
                : tag.replace(
                    /\s*\/?>$/,
                    ` srcset="${escapeAttr(image.srcSet.attribute)}" sizes="${escapeAttr(READING_SIZES)}" />`,
                  ),
            )
            // An optimizer refusal (domain not allowlisted, service quirk) must
            // never take the essay down with it — the un-enhanced tag already
            // works. Logged in the read path's own voice.
            .catch((e: unknown) => {
              console.error(`[read] essay image srcset — ${e instanceof Error ? e.message : String(e)}`);
              return null;
            }),
    );
  }

  let out = html;
  for (const [tag, job] of jobs) {
    const enhanced = await job;
    if (enhanced) out = out.replaceAll(tag, enhanced);
  }
  return out;
}
