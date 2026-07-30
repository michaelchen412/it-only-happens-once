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
});
