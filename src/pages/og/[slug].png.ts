// The link-preview card (plan 32 · §7).
//
// FOR AN ESSAY, SHARING IS A LINK. FOR A QUOTE, THE CARD *IS* THE QUOTE — which
// is why this exists at all and why it comes before the share button. A share
// control that emits a bare grey rectangle into iMessage publishes the weakest
// possible self-portrait of a site whose whole argument is typographic care.
//
// ⚠ THE FONT IS THE HARD PART, AND NOT FOR THE USUAL REASON. Astro's font API
// hands back the exact bytes the page serves — the obvious right answer, and it
// was built that way first. It does not work: satori cannot read woff2, and the
// file underneath is a VARIABLE font its opentype fork throws on. The account is
// in `newsreader()`, along with what that costs.
//
// ⚠ AND `sharp` REACHING THE VERCEL RUNTIME WAS VERIFIED, NOT ASSUMED — the
// plan gated this section on a spike for exactly that reason. `sharp` being in
// node_modules is a different question from it being traced into the deployed
// function, and this repo has a script (`check-server-bundle.mjs`) that exists
// because that distinction once returned 500 on every request in production.
// Checked against `.vercel/output/functions/_render.func/node_modules`: `sharp`
// is there, with `@img/sharp-linux-x64` and its libvips. It is already traced
// because Astro's image service uses it. If a future build ever prunes it, the
// fallback is `@vercel/og` (satori + resvg-wasm, built for this runtime).
import type { APIRoute } from 'astro';
// ⚠ STATIC INSTANCES, FROM @fontsource, AND NOT THE FONT THE PAGE USES — see
// `newsreader()` below for why that is forced rather than chosen. `?url` makes
// these real build assets, so Vite emits them and Vercel's tracer sees them;
// reading out of node_modules at runtime would not survive the function's
// pruned dependency tree.
import w300 from '@fontsource/newsreader/files/newsreader-latin-300-normal.woff2?url';
import w400 from '@fontsource/newsreader/files/newsreader-latin-400-normal.woff2?url';
import satori from 'satori';
import sharp from 'sharp';
import { decompress } from 'wawoff2';
import { toPlainText } from '../../lib/markdown';
import { STAR_PATH, STAR_VIEWBOX } from '../../lib/star-mark';

export const prerender = false;

const W = 1200;
const H = 630;

// ⚠ THE DUSK THEME'S OWN VALUES, CONVERTED TO sRGB, because satori cannot read
// a CSS variable or parse `oklch()`. This is a real duplication of app.css and
// the only honest mitigation is to say so: if the theme's ink moves, these move
// with it. Taken 2026-08-10 from the live `--color-*` on a rendered page.
//
// Dark only, and that is ADR-0021 rather than laziness — dark is this site's own
// default, not a concession to a preference, so a card in paper would be showing
// strangers a version of the site most of them will never see.
const INK = '#e8e0d4'; // --color-base-content
const PAPER = '#1a1511'; // --color-base-100
const RULE = '#312a23'; // --color-base-300
const LAMP = '#e1a35c'; // --color-primary

/**
 * The type ramp.
 *
 * ⚠ QUOTES ARE "SET WHOLE, NEVER TRUNCATED" ON THE SITE, so the card SHRINKS
 * rather than cuts — but a card has a floor where the page does not, and 9 of 77
 * published quotes are over 400 characters (the longest is 843). Past the floor
 * something has to give, and it is better that the card carries an opening and
 * the page carries the rest than that the line is set at a size nobody reads in
 * a chat window.
 *
 * The numbers are the measure, not a guess: ~980px of text width, and at 30px
 * Newsreader averages ~15px a character, so ~65 to a line and ~8 lines in the
 * space Card B leaves above its footer. That is the ~520 characters below.
 */
function ramp(len: number): { size: number; cut: number } {
  if (len < 90) return { size: 64, cut: 999 };
  if (len < 220) return { size: 48, cut: 999 };
  if (len < 400) return { size: 38, cut: 999 };
  return { size: 30, cut: 520 };
}

/** Satori has no `font-variant: all-small-caps`, so the register is approximated
 *  — uppercase, tracked out, and set smaller than the line above it. */
const smallCaps = (s: string) => s.toUpperCase();

/**
 * Newsreader, as satori can read it.
 *
 * ⚠ **THIS DOES NOT USE THE PAGE'S OWN FONT FILE, AND THAT IS UPSTREAM, NOT A
 * SHORTCUT.** The first build did — `fontData` + `experimental_getFontFileURL`
 * hand back exactly the bytes the site is serving, which is the whole appeal of
 * Astro's font API for a card like this. Two walls, in order:
 *
 *   1. Astro serves **woff2** and satori cannot parse it (`Unsupported OpenType
 *      signature wOF2`, from opentype.js). Solvable — `wawoff2` decompresses it
 *      to TrueType in a few milliseconds, and that worked.
 *   2. The decompressed file is a **VARIABLE font**. Google's Newsreader ships
 *      `fvar`/`gvar`/`avar`/`HVAR`, and satori's opentype.js fork throws
 *      `Cannot read properties of undefined (reading '256')` inside
 *      `parseFvarAxis`. Not fixable from this side.
 *
 * So the card is set from STATIC per-weight instances of the same typeface
 * (@fontsource, a devDependency, `?url`-imported so they become build assets).
 * Verified: no `fvar`, and satori renders.
 *
 * ⚠ THE COST IS A SECOND SOURCE OF TRUTH FOR WHAT THIS SITE IS SET IN. If
 * `astro.config`'s font block ever changes family, the page changes and the card
 * does not, silently. Both name Newsreader today; anyone changing one must
 * change the other. That is the trade satori's variable-font support forces, and
 * it is worth re-testing the direct path whenever satori updates.
 *
 * ⚠ AND THE WEIGHT/STYLE PAIR IS LOAD-BEARING. `fontData` lists ITALICS FIRST,
 * so the earlier lookup-by-weight quietly returned 300-italic and would have set
 * every card in italic — a wrongness with no error attached to it. The static
 * filenames say `-normal` for the same reason: it has to be stated.
 *
 * Cached in module scope, so a warm lambda decompresses once rather than per card.
 */
const faces = new Map<string, Promise<ArrayBuffer>>();
function newsreader(href: string, origin: URL): Promise<ArrayBuffer> {
  const hit = faces.get(href);
  if (hit) return hit;
  const load = (async () => {
    const woff2 = await fetch(new URL(href, origin)).then((r) => r.arrayBuffer());
    const ttf = await decompress(new Uint8Array(woff2));
    return ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer;
  })();
  faces.set(href, load);
  return load;
}

export const GET: APIRoute = async (context) => {
  const slug = context.params.slug;
  if (!slug) return new Response('Not found', { status: 404 });

  // The middleware's anon client, like every other public read. RLS is the trust
  // boundary; the explicit `status` filter below is the belt.
  const { data: row } = await context.locals.supabase
    .from('fragments')
    .select('type, title, body, excerpt, attribution')
    .eq('slug', slug)
    // ⚠ PUBLISHED ONLY, AND THIS IS THE SECURITY LINE OF THE WHOLE FEATURE.
    // `/blog/[slug]` serves a draft to the admin behind `private, no-store`;
    // an image endpoint has no session to check against a CDN and no way to
    // vary on one, so a draft rendered here would become a PUBLIC, CACHEABLE
    // PNG of unpublished writing. There is no admin branch here on purpose:
    // the preview of a draft is the page, never the card.
    .eq('status', 'published')
    .is('deleted_at', null)
    .maybeSingle();

  if (!row) return new Response('Not found', { status: 404 });

  const isQuote = row.type === 'quote';
  const text = toPlainText(isQuote ? (row.body ?? '') : (row.title ?? ''));
  const { size, cut } = isQuote ? ramp(text.length) : { size: 60, cut: 140 };
  const shown = text.length > cut ? text.slice(0, cut).trimEnd() + '…' : text;
  // An essay's second line is its excerpt; a quote's is who said it.
  const under = isQuote ? (row.attribution ?? '') : toPlainText(row.excerpt ?? '').slice(0, 110);

  // ⚠ `context.url` rather than a constant: the asset lives under the
  // deployment's OWN origin, and a hardcoded one is right locally and wrong on
  // every preview deploy.
  const [light, regular] = await Promise.all([newsreader(w300, context.url), newsreader(w400, context.url)]);

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: W,
          height: H,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: PAPER,
          padding: '84px 110px',
          fontFamily: 'Newsreader',
        },
        children: [
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', flexGrow: 1 },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      color: INK,
                      fontSize: size,
                      fontWeight: 300,
                      lineHeight: 1.34,
                      // The site preserves a quote's line breaks; so does the card.
                      whiteSpace: 'pre-wrap',
                    },
                    children: shown,
                  },
                },
                under && {
                  type: 'div',
                  props: {
                    style: {
                      marginTop: 34,
                      color: '#8b8479',
                      fontSize: isQuote ? 28 : 26,
                      letterSpacing: isQuote ? '0.06em' : '0',
                    },
                    children: isQuote ? `— ${smallCaps(under)}` : under,
                  },
                },
              ].filter(Boolean),
            },
          },
          // ⚠ CARD B — signed. Michael's call, 2026-08-10, over the unsigned
          // version. The whole reason the share verb is a LINK rather than
          // copied text is that the sharer wants the recipient to come and look
          // around; a card that never names the place it came from argues
          // against that in the one moment somebody is deciding whether to.
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                borderTop: `1px solid ${RULE}`,
                paddingTop: 30,
              },
              children: [
                // ⚠ THE DRAWN MARK, NOT THE GLYPH. `✦` (U+2726) was tried and
                // rendered as TOFU: Newsreader has no glyph for it, and satori
                // has no fallback font to reach for. Using StarMark's own path
                // is not a workaround for that — it is the correct thing and the
                // failure only made it obvious. design.md §8: the mark is drawn
                // rather than borrowed, and the card should carry the same one
                // the Sky does rather than the nearest thing in Unicode.
                {
                  type: 'svg',
                  props: {
                    width: 26,
                    height: 26,
                    viewBox: STAR_VIEWBOX,
                    fill: 'none',
                    children: { type: 'path', props: { d: STAR_PATH, fill: LAMP } },
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { color: '#6f6961', fontSize: 24, letterSpacing: '0.1em' },
                    children: 'IT ONLY HAPPENS ONCE',
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: W,
      height: H,
      fonts: [
        { name: 'Newsreader', data: light, weight: 300, style: 'normal' },
        { name: 'Newsreader', data: regular, weight: 400, style: 'normal' },
      ],
    },
  );

  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      // Long at the edge, because rendering one is not free and a card changes
      // only when its fragment does. `stale-while-revalidate` means an edit
      // shows up on the second request rather than blocking the first.
      'Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400',
    },
  });
};
