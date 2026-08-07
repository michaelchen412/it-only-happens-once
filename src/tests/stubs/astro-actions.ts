/**
 * Test stub for `astro:actions`, aliased in vitest.config.ts.
 *
 * ⚠ IT IS NOT A FAKE. It re-exports Astro's OWN `ActionError` — the same class
 * the server constructs at runtime — reached by a deep path because
 * `astro:actions` is a Vite virtual module that only exists inside an Astro
 * build. The published entrypoint (`astro/actions/runtime/entrypoints/server.js`)
 * cannot be used here: it imports `virtual:astro:actions/options`, which is
 * another virtual module and is not resolvable outside that build.
 *
 * Faithful by construction, exactly as `astro-env-server.ts` is. A hand-written
 * `class ActionError extends Error` would have been stable and quietly wrong —
 * it is the real one that maps `FORBIDDEN` to 403 and `INTERNAL_SERVER_ERROR`
 * to 500, and those mappings are the thing worth asserting about
 * `src/actions/_shared.ts`'s `fail`.
 *
 * ⚠ THE COST IS A DEEP PATH, AND IT IS DELIBERATE. `astro/dist/**` is not in
 * Astro's exports map, so an upgrade that moves this file breaks the suite at
 * IMPORT time — loudly, on the next `npm run verify`, with a message naming
 * this file. That is the failure mode to want: the alternative is a local copy
 * that keeps passing while it drifts away from what production throws.
 */
export { ActionError, isActionError, isInputError } from '../../../node_modules/astro/dist/actions/runtime/client.js';
