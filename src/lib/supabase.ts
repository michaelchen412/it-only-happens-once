import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import type { Database } from './database.types';

// ⚠ These two can no longer be absent at runtime: astro.config.mjs declares
// them as required client env (plan 43 §3.1), so a deploy missing either is a
// failed build — never a site where this file hands `undefined` to
// `createServerClient` and middleware 500s every route, which is what the
// bare reads below would otherwise permit.
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/**
 * Server-side Supabase client, bound to a single request's cookies.
 *
 * Used in middleware, SSR pages, and API routes. Reads the auth session from
 * the incoming request cookies and writes any refreshed session cookies back
 * onto the response. Typed against our generated Database types.
 *
 * The browser side (sign-in, sign-out, storage uploads) uses `createBrowserClient`
 * from `@supabase/ssr` directly inside a client <script>, so no server code is
 * pulled into the browser bundle. It is deliberately NOT re-exported from here
 * — see docs/auth.md §4 for the three sites and why each imports it itself.
 */
export function createSupabaseServerClient(context: { request: Request; cookies: AstroCookies }) {
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(context.request.headers.get('Cookie') ?? '').map(({ name, value }) => ({
          name,
          value: value ?? '',
        }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => context.cookies.set(name, value, options));
      },
    },
  });
}

/**
 * The session-free client, for reads whose answer is the same for everybody.
 *
 * ⚠ IT EXISTS BECAUSE A SIGNED-IN VIEWER'S OWN TOKEN CAN FAIL A PUBLIC READ
 * (2026-08-27). The front door showed Michael "The sky is being composed." with
 * eleven constellations sitting in the database. `/` ran its two reads on the
 * request-bound client above — which carries HIS access token — and the two
 * straddled a refresh: one went out with the rotated token and came back 200,
 * the other with the revoked one and came back 401. Supabase's edge logs
 * recorded the rotation and both requests in the same second, and it was the
 * only non-2xx the project returned all day.
 *
 * A query that wants the public truth has no use for an identity, and an
 * identity it does not use is one that can only cost it. `listConstellations`
 * had said so in a comment — *"the overview always shows the PUBLIC truth, even
 * to the admin"* — since it was written; this is that sentence made structural,
 * so the guarantee no longer depends on every future caller reading it.
 *
 * ⚠ NO COOKIES IN, NO COOKIES OUT — that is the entire mechanism, and it works
 * because of what `createServerClient` already does: it sets
 * `skipAutoInitialize`, so the session is loaded lazily from the cookie storage
 * adapter on the first `getSession`/`getUser`/`getClaims`, and it sets
 * `autoRefreshToken: false`. An empty jar therefore means there is never a
 * session to attach, to expire, or to rotate. Requests carry the anon key and
 * nothing else, and the public RLS policies are the only thing deciding.
 *
 * ⚠ SHARED, AND DELIBERATELY. It holds no per-request state, so minting one per
 * request would allocate on the hottest public route to buy nothing. The price
 * of sharing is that **`.auth` is off limits on it**: it has no session, and no
 * response to write refreshed cookies back to. Anything that needs to know who
 * is asking wants `createSupabaseServerClient` instead.
 */
let sharedPublicClient: ReturnType<typeof createSupabaseServerClient> | null = null;

export function publicSupabase(): ReturnType<typeof createSupabaseServerClient> {
  return (sharedPublicClient ??= createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: () => {} },
  }));
}
