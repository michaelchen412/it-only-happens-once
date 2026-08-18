/**
 * Test stub for `astro:env/server`, aliased in vitest.config.ts.
 *
 * Faithful by construction: for secrets that aren't declared in an env schema —
 * which is still all of them; the `env` block astro.config.mjs gained in plan
 * 43 §3.1 declares only the two PUBLIC client keys, never a server secret —
 * Astro's real `getSecret` reads the runtime environment, which is exactly
 * this. So a test that sets `process.env.SPOTIFY_CLIENT_ID` exercises the same
 * branch production does. If a server secret is ever ADDED to that schema,
 * this stub stops being faithful for it and must learn the schema's answer.
 */
export function getSecret(key: string): string | undefined {
  return process.env[key];
}
