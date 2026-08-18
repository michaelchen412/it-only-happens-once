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
