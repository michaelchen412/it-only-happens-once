// ESLint, flat config (plan 00 · Piece 10).
//
// ⚠ DELIBERATELY PERMISSIVE, AND THAT IS THE DESIGN. A config that fires four
// hundred times on its first run gets `--no-verify`'d within a week, and a
// bypassed hook is worse than no hook because it manufactures confidence. So
// this turns on the rules that catch *bugs* and the ones that catch *a11y
// regressions*, and leaves style entirely to Prettier — there is no formatting
// rule here, on purpose, and adding one would put two tools in charge of one
// question.
//
// Type-aware linting (`recommendedTypeChecked`) is NOT on. It is the obvious
// next step and it is genuinely slower; turn it on when the rules below are
// clean and staying clean, not before.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';

export default tseslint.config(
  {
    // Generated, vendored, or built. `database.types.ts` is regenerated from
    // the live schema and must never be hand-edited to satisfy a linter.
    ignores: [
      'dist/**',
      '.astro/**',
      '.vercel/**',
      'node_modules/**',
      'legacy/**',
      'docs/**',
      'src/lib/database.types.ts',
      // Deno, not Node (21 · Phase 2). Supabase Edge Functions use `Deno.*` and
      // `jsr:` specifiers; this config's parser and globals are the browser/Node
      // ones, so every line here would be a false positive. Prettier still
      // formats them — it needs no runtime to do that.
      'supabase/functions/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  // The a11y rules are the half of this config that earns its keep: plan 00
  // found an `aria-pressed` on an `<a>` by reading, and reading does not scale.
  ...astro.configs['jsx-a11y-recommended'],

  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // An unused import is usually a half-finished move. `_`-prefixed args are
      // the documented way to say "required by the signature, not used here".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // `any` is a warning rather than an error: it is real debt, but the
      // Supabase relation boundary genuinely needs a few, and they are confined
      // to `src/lib/hq/relations.ts` where a comment explains why.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // ── Three rules tuned to this codebase rather than fought ────────────
      // Each was flagged on the first run, each was read, and each turned out
      // to be an existing idiom rather than a defect. Tuning is recorded here
      // so nobody re-tightens one and then silences it file-by-file.

      // `cond ? doThis() : doThat()` for effect, used consistently across the
      // scripts (back-to-top, fragment-panel, the constellation editor). It is
      // terse and it is deliberate; banning it would mean rewriting working
      // code to satisfy a style preference Prettier does not share.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],

      // The empty blocks are all `catch {}` around `localStorage` in the theme
      // bootstrap, where throwing (private mode, blocked storage) must fall
      // through to the default that is already assigned. An empty catch is a
      // smell in general and is the correct answer there.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // The one irregular-whitespace hit is a literal U+00A0 *inside a regex*
      // in the reflections importer — where matching an nbsp is the entire
      // purpose of the line. Skipping regexes keeps the rule useful for the
      // case it is actually for: a stray nbsp in code, pasted from a document.
      'no-irregular-whitespace': ['error', { skipRegExps: true }],

      // ⚠ OFF, AND FOR A REASON WORTH KEEPING. It fires on
      // `let x = null; try { x = await … } catch {}` — flagging the initialiser
      // as dead because it cannot see that the catch path leaves it null. That
      // pattern is exactly how this codebase survives a dead network
      // (writing-sheet.ts, calendar.ts), so the rule would be pushing code
      // toward the bug it spent two days removing.
      'no-useless-assignment': 'off',
    },
  },

  {
    // Scripts under `scripts/` are one-off Node tooling run by hand with the
    // service-role key. They print, and printing is their entire interface.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  {
    // Playwright specs and Vitest files.
    files: ['tests/**/*.ts', 'src/tests/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
