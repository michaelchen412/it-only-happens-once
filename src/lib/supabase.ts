import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import type { Database } from './database.types';

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/**
 * Server-side Supabase client, bound to a single request's cookies.
 *
 * Used in middleware, SSR pages, and API routes. Reads the auth session from
 * the incoming request cookies and writes any refreshed session cookies back
 * onto the response. Typed against our generated Database types.
 *
 * The browser side (sign-in, sign-out, passkeys) uses `createBrowserClient`
 * from `@supabase/ssr` directly inside a client <script>, so no server code is
 * pulled into the browser bundle.
 */
export function createSupabaseServerClient(context: {
  request: Request;
  cookies: AstroCookies;
}) {
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(context.request.headers.get('Cookie') ?? '').map(
          ({ name, value }) => ({ name, value: value ?? '' })
        );
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          context.cookies.set(name, value, options)
        );
      },
    },
  });
}
