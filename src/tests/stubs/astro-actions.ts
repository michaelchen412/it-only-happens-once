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

/**
 * The real `defineAction`, for the same reason and by the same deep path.
 *
 * ⚠ THIS IS WHAT MAKES A HANDLER TESTABLE AT ALL, and it was worth checking
 * before assuming otherwise: `runtime/server.js` imports nothing virtual (only
 * devalue, zod and Astro's own core modules), unlike the entrypoint above it.
 * So a unit test can drive the action a browser drives — input coercion, Zod,
 * the guard and the handler — instead of a hand-extracted copy of the handler's
 * body, which is the version that stays green while the real one rots.
 *
 * ⚠ HOW TO CALL ONE, because it is not obvious: the value `defineAction`
 * returns refuses to run unless `this` is an action context. Use
 * `action.orThrow.call(ctx, input)` — `orThrow` skips only the result
 * WRAPPING, so a refusal arrives as a thrown `ActionError` (which is what you
 * want to assert on) and everything before it still runs. `src/tests/
 * actions-vocabulary.test.ts` is the worked example.
 */
export { defineAction } from '../../../node_modules/astro/dist/actions/runtime/server.js';
