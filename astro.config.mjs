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
  adapter: vercel(),
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
