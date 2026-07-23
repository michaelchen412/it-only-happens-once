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
        ph: ['clock-light', 'magnifying-glass', 'x', 'caret-down', 'caret-left', 'caret-right', 'arrow-right', 'arrow-up', 'arrow-up-right', 'arrow-down', 'funnel', 'trash', 'plus', 'sun', 'moon', 'moon-stars', 'list', 'stack', 'books', 'user-circle', 'image'],
        'simple-icons': ['github', 'astro', 'supabase', 'tailwindcss', 'daisyui', 'typescript', 'vercel'],
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
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