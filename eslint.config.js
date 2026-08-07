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
// ESLint's own helper, which replaced `tseslint.config()` (deprecated upstream).
// The two differ in ONE way that could bite: when a block's `extends` overrides
// `files`, `tseslint.config` replaced the base list while `defineConfig`
// intersects it. Nothing here uses `extends` inside a block, so the swap is
// behaviour-for-behaviour identical — but that is why it was safe, not luck.
import { defineConfig } from 'eslint/config';

export default defineConfig(
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
      // `any` is a warning rather than an error: it is real debt, and it is
      // currently about a dozen sites, each one a boundary where the type
      // system genuinely runs out rather than a shortcut.
      //
      // ⚠ THIS LIST WAS WRONG ONCE — it named `src/lib/hq/relations.ts` as the
      // only home, and that file contains no `any` at all; it takes `unknown`
      // and argues in its own header that returning `any` "would have been
      // strictly worse". Corrected 2026-08-07 during a quality audit. In a
      // codebase where the comments are the design record, a comment that sends
      // you to the wrong file costs more than the debt it was describing, so
      // this one names shapes rather than a single address:
      //
      //   - `(document as any).fonts` ×3 — `FontFaceSet` is missing from the
      //     TS DOM lib at our target; the call is feature-detected anyway.
      //   - `fragment-query.ts` — a structural constraint over PostgREST's
      //     builder, which has no exported interface to name.
      //   - `action-error.ts` — formats a CAUGHT value, and a `catch` binding
      //     is genuinely unknown until it has been narrowed.
      //
      // Prefer `unknown` plus a narrow. Reach for `any` only at a boundary a
      // reader can see, and say which one in a comment beside it.
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
    // ── `no-undef` is off inside .astro frontmatter, and it is a BUG FIX ─────
    //
    // typescript-eslint turns this rule off for `.ts` (its `eslint-recommended`
    // override), on the grounds that TypeScript already does the job properly
    // and ESLint cannot. That override's glob does not cover `.astro`, so
    // frontmatter was the one place in this project still running it.
    //
    // The failure is not theoretical — it is why this block exists. Typing a
    // component prop as `keyof HTMLElementTagNameMap` errored with
    // "'HTMLElementTagNameMap' is not defined", because it is a TYPE-ONLY
    // interface: `globals.browser` lists the DOM's runtime constructors, and a
    // type that never existed at runtime is not among them. The rule was
    // reporting correct code, and the only way to satisfy it was to write a
    // worse type.
    //
    // Nothing is lost. A genuinely undefined identifier is still an error —
    // `astro check` reports it, and `astro check` is in `npm run verify`.
    files: ['**/*.astro'],
    rules: { 'no-undef': 'off' },
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
