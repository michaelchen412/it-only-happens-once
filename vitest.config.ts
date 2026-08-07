import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The unit-test harness. It arrived with the offline outbox (removed 2026-07-30,
// ADR-0010) and stays without it, because the lesson that outlived that work is
// that compile-and-build is not verification — see docs/plans/README.md.
// Tests live in src/tests/**/*.test.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // Astro's virtual modules don't exist outside an Astro build, so a lib
      // that reads a secret was untestable until now. The stub is faithful:
      // with no `env` schema in astro.config.mjs, the real getSecret reads the
      // runtime environment too. Added for src/lib/media.ts (plans/04 Piece 4).
      'astro:env/server': fileURLToPath(new URL('./src/tests/stubs/astro-env-server.ts', import.meta.url)),
      // Same reason, one layer deeper: `astro:actions` is virtual too, and the
      // actions' shared validation/authorization layer (`src/actions/_shared.ts`)
      // was untestable without it. The stub re-exports Astro's REAL ActionError
      // rather than imitating one — see the file for why that matters and what
      // it costs. Added 2026-08-07 (quality audit).
      'astro:actions': fileURLToPath(new URL('./src/tests/stubs/astro-actions.ts', import.meta.url)),
    },
  },
});
