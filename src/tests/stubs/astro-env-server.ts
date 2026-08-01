/**
 * Test stub for `astro:env/server`, aliased in vitest.config.ts.
 *
 * Faithful by construction: for secrets that aren't declared in an env schema —
 * which is all of them here, the config has no `env` block — Astro's real
 * `getSecret` reads the runtime environment, which is exactly this. So a test
 * that sets `process.env.SPOTIFY_CLIENT_ID` exercises the same branch
 * production does.
 */
export function getSecret(key: string): string | undefined {
  return process.env[key];
}
