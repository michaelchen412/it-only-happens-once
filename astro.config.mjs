// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
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
        ph: ['clock-light', 'magnifying-glass', 'x', 'caret-down', 'caret-left', 'caret-right', 'arrow-right', 'arrow-up', 'arrow-up-right', 'arrow-down', 'funnel', 'trash', 'plus', 'pencil-simple', 'sun', 'moon', 'moon-stars', 'list', 'stack', 'books', 'user-circle', 'image', 'note'],
        'simple-icons': ['github', 'astro', 'supabase', 'tailwindcss', 'daisyui', 'typescript', 'vercel'],
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
      noExternal: ['sanitize-html'],
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