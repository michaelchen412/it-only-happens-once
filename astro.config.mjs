// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  // The two routes 13 · Pieces 1 and 2 shipped at, before Piece 4 gathered all
  // three surfaces into the Agenda room (10-hq.md §9). They existed for half a
  // day, which is long enough for a bookmark.
  redirects: {
    '/admin/tasks': '/admin/agenda/tasks',
    '/admin/goals': '/admin/agenda/goals',
    '/admin/goals/[slug]': '/admin/agenda/goals/[slug]',
  },
  // SSR + edge caching for DB-backed content; the admin renders on demand.
  // See docs/adr/0001. Static pages opt back in with `export const prerender = true`.
  output: 'server',
  adapter: vercel({
    // Vercel's Image Optimization API, behind `<Image>`. Turned on 2026-08-10 for
    // exactly one image — the About portrait — but the reason generalises to every
    // reader-facing photo we serve out of Supabase storage.
    //
    // The uploader downscales to a 1600px edge and stops there (scripts/upload.ts),
    // which is right for an essay's inline figure and roughly ten times too much
    // for the About page's 224px float: 291 KB of JPEG to paint a thumbnail, over
    // a `cache-control: no-cache` object, so every visit paid it again. That is
    // what "the portrait loads in after the page" actually was — not a scheduling
    // problem, a payload problem, and prefetching it earlier would only have moved
    // the same 291 KB onto every other page.
    //
    // ⚠ SUPABASE'S OWN TRANSFORM ENDPOINT IS NOT THE ANSWER HERE, and it is the
    // first thing you will reach for. `/storage/v1/render/image/public/…?width=`
    // returns 403 FeatureNotEnabled on this project — image transformation is a
    // paid Storage add-on, confirmed off (`imageTransformation.enabled: false`).
    // Enabling it would buy the resizing and none of the AVIF negotiation.
    //
    // Cost is a real consideration and was weighed: optimized derivatives are
    // billed per *source* image per month, and one portrait against Hobby's 1000
    // is noise. Anything that puts a large, reader-supplied gallery through
    // `<Image>` is a different arithmetic problem — do it deliberately.
    imageService: true,
    // Dev has no Vercel API to call, so this swaps in a local sharp-backed service
    // that applies the SAME width snapping as production. That last part is the
    // reason to set it: a local preview that quietly used different widths than
    // the deploy would hide exactly the bug documented below.
    devImageService: 'sharp',
    // ⚠ THIS LIST IS AN ALLOWLIST, NOT A HINT, AND `widths` ARE SILENTLY DISCARDED
    // AGAINST IT. Vercel only serves widths named here; the adapter enforces that
    // by snapping `width` to the nearest entry and *filtering* every `<Image
    // widths={…}>` down to entries it contains — and when that filter empties the
    // array it falls back to the single snapped width. So the About portrait,
    // asking for [224, 448, 672, 953] against the adapter's default ladder (which
    // starts at 640), got a one-entry srcset at 640w. Not an error, not a warning:
    // a correct-looking `<img>` that had thrown the responsive part away.
    //
    // The default ladder is built for hero images and has nothing below 640, which
    // is 3× more than a 224px float can use. 224 and 448 are here so that float can
    // be served at 1× and 2×; the rest is Vercel's own ladder, kept so a future
    // full-width image still has the range it needs.
    //
    // Adding a width costs nothing by itself — entries are permissions, not work.
    // Only the widths a real browser actually requests are ever generated or billed.
    imagesConfig: {
      sizes: [224, 448, 640, 750, 828, 1080, 1200, 1920, 2048, 3840],
      // ⚠ THIS IS LOAD-BEARING, AND THE REASON IS THE UPSTREAM, NOT THIS SITE.
      // Vercel derives an optimized image's own Cache-Control from the origin it
      // fetched, floored by this. Supabase Storage serves our objects
      // `cache-control: no-cache`, so with the 60s default a reader would
      // re-request the portrait on essentially every visit — the exact complaint
      // that started this, merely 30× cheaper each time.
      //
      // A long floor is safe here because the URL already carries `?v=` keyed to
      // the About page's `updated_at` (pages/about.astro): replacing the portrait
      // necessarily bumps that, so a changed photo is always a changed URL and can
      // never be masked by a cached copy. If that bust is ever removed, this number
      // becomes a bug — the two are a pair.
      minimumCacheTTL: 2592000, // 30 days
    },
  }),
  image: {
    // The allowlist `imageService` optimizes through. There are really TWO gates —
    // Astro's, which decides whether to rewrite the tag at all, and the one the
    // adapter writes into `.vercel/output/config.json`, which is what the deployed
    // `/_vercel/image` endpoint enforces. This single entry feeds both.
    //
    // ⚠ USE `domains`, NOT `remotePatterns`, AND BOTH REASONS ONLY BITE IN
    // PRODUCTION — dev renders correctly either way.
    //   · @astrojs/vercel 11 drops any remotePattern that names a protocol. Its
    //     filter reads `protocol !== 'http' || protocol !== 'https'`, which no
    //     string can fail, so `{protocol:'https', hostname:…}` is discarded on the
    //     way to the build output. Verified: it emitted `"remotePatterns": []`,
    //     which is a deployed 400 on an image that works perfectly locally.
    //   · The two sides also disagree on what a hostname IS. Astro reads glob
    //     (`**.example.com`); Vercel reads an unanchored RegExp, where an
    //     innocent-looking hostname has `.` as a wildcard and no anchors — so it
    //     would also match hosts an attacker controls, and our optimizer becomes
    //     theirs. No single string is correct in both languages. `domains` is
    //     exact-match on both sides and has no such gap.
    //
    // Hardcoded rather than derived from PUBLIC_SUPABASE_URL because astro.config
    // is evaluated before Vite loads `.env.local` — the var reads as undefined
    // here, and the allowlist would quietly empty itself. Not a secret;
    // `.env.example` commits the same URL.
    domains: ['deodwnoztppvtrnehwzg.supabase.co'],
  },
  // Iconography: Phosphor (thin/light weights) for functional UI icons.
  // Signature marks in the Sky (✦ ♪ ” ▤) stay as hand-chosen glyphs.
  // Simple Icons (monochrome brand marks) power the footer colophon; rendered in
  // muted ink, never their brand colors — see design.md §3 (a colophon, not a badge).
  integrations: [
    icon({
      include: {
        ph: [
          'clock-light',
          'magnifying-glass',
          'x',
          // The share mark (components/ShareMark.astro). ⚠ Chosen over
          // `ph:export`, whose tray is the idiom most readers are trained to
          // read as *share* — this one's dominant convention is "opens
          // elsewhere". Picked knowingly: the link does leave for somewhere
          // else, and the tooltip and aria-label carry the verb.
          'arrow-square-out',
          'caret-down',
          'caret-left',
          'caret-right',
          'arrow-right',
          'arrow-counter-clockwise',
          'arrow-up',
          'arrow-up-right',
          'arrow-down',
          'funnel',
          'trash',
          'plus',
          'pencil-simple',
          'sun',
          'moon',
          'moon-stars',
          'list',
          'stack',
          'books',
          'user-circle',
          'image',
          'note',
          'eye',
          'footprints',
          // HQ (docs/plans/10-hq.md). Zone marks + the check-in's own controls.
          // `sun-horizon` is the Today room in the sidebar — deliberately not
          // `sun`, which the theme toggle already owns two blocks below it.
          'sun-horizon',
          'star',
          'star-fill',
          'warning',
          'calendar-blank',
          'users-three',
          'pen-nib',
          'cake',
          'check-circle',
          'circle',
          'chat-circle',
          'phone',
          'lock-simple',
          'target',
          // The one goal kept on the Morning card (2026-08-11). A pin, and it is
          // the same glyph pressed and unpressed — `aria-pressed` carries the
          // state, so there is no second icon to keep in sync with it.
          'push-pin',
          // The agenda (13): a recurrence rule, disposition, and the effort meter.
          'arrows-clockwise',
          'dots-three',
          'check',
          'skip-forward',
          // Today's brief (13 · Piece 5): "Log an entry". Its own glyph rather
          // than `note` — which already means the `note` interaction KIND on a
          // timeline row — or `pencil-simple`, which already means Edit.
          'note-pencil',
          // People (12 · Piece 2): the interaction kinds. `gift` is its own mark
          // rather than reusing `cake` — a cake already means a birthday on the
          // roster, and one glyph meaning two things is how a timeline stops
          // being scannable.
          'gift',
          // People (12 · Piece 3): the Shared shelf, where the glyph carries
          // what KIND of corpus row this is — the same job TypeMark does in the
          // fragment manager, done with icons because the shelf is a rail.
          'book-open',
          'quotes',
          'music-notes',
          'article',
          // Push (21 · Phase 2). `bell` is the control that grants the building
          // standing permission to interrupt; `bell-slash` is the same control
          // saying it currently cannot. Deliberately NOT `warning` for the
          // refused state — a device that was never asked is not an error.
          'bell',
          'bell-slash',
        ],
        'simple-icons': [
          'github',
          'astro',
          'supabase',
          'tailwindcss',
          'daisyui',
          'typescript',
          'vercel',
          // HQ: marks a mirrored calendar event as Google's, without a word of chrome.
          'google',
        ],
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      // sanitize-html is CommonJS but (since 2.17.6) depends on htmlparser2 v12,
      // which is ESM-only. Left external, the server does a real `require()` of
      // an ES module at runtime — legal only on a Node that supports
      // `require(esm)`. Local Node does; Vercel's launcher patches
      // `Module._load` and does not, so every request died with ERR_REQUIRE_ESM
      // while `dev`, `build` and `preview` were all green.
      //
      // Bundling it lets Rollup rewrite that `require` into a static import at
      // build time, so no runtime require-of-ESM exists to fail. We do NOT pin
      // either package back: 2.17.6 is the fix for GHSA-jxwj-j7wr-gfrw
      // (mutation-XSS via <textarea>/<xmp>) and its escaping assumes
      // htmlparser2 >= 11 decodes entities inside <textarea>.
      //
      // BUILD ONLY, and the asymmetry is the point. `astro dev` has no Rollup
      // pass: Vite hands the module to its dev SSR runtime instead, which gives
      // CommonJS no `require` — so bundling it there turned every page that
      // renders Markdown into a 500 (`require is not defined`, sanitize-html
      // index.js:1). Dev doesn't need the fix anyway: it runs on local Node,
      // which supports require(esm) natively. Left external in dev, bundled in
      // build, each environment gets the form it can actually execute.
      //
      // THE WHOLE SUBTREE, not just sanitize-html. Bundling one package removes
      // it from the graph Vercel's dependency tracer walks, so `node_modules/
      // sanitize-html` — and everything nested under it — stops being copied
      // into the function. Rollup meanwhile leaves any dependency NOT listed
      // here as a bare `require()`. Listing only sanitize-html left seven such
      // requires pointing at packages no longer shipped, and every request died
      // on the first one: `Cannot find module 'htmlparser2'`.
      //
      // Regenerate this list after any sanitize-html upgrade:
      //   node scripts/check-server-bundle.mjs --closure sanitize-html
      // The same script runs after every build and fails it if an unresolvable
      // require survives, so a stale list is a red build, not a 500.
      noExternal:
        process.env.NODE_ENV === 'production'
          ? [
              'sanitize-html',
              // ESM-only, which is what started all this
              'htmlparser2',
              'domhandler',
              'domutils',
              'domelementtype',
              'dom-serializer',
              'entities',
              // ordinary CJS, but they go the same way once the parent is bundled
              'deepmerge',
              'escape-string-regexp',
              'is-plain-object',
              'parse-srcset',
              'launder',
              'dayjs',
              'postcss',
              'nanoid',
              'picocolors',
              'source-map-js',
            ]
          : [],
    },
  },
  fonts: [
    {
      // Long-form reading + display. Warm, literary, optical sizing.
      provider: fontProviders.google(),
      name: 'Newsreader',
      cssVariable: '--font-newsreader',
      weights: [300, 400, 500, 600],
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      fallbacks: ['Georgia', 'serif'],
    },
    {
      // UI chrome. Designed by the Braille Institute for maximum legibility.
      provider: fontProviders.google(),
      name: 'Atkinson Hyperlegible',
      cssVariable: '--font-atkinson',
      weights: [400, 700],
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
  ],
});
