import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../lib/supabase';

// OAuth (PKCE) return leg: Google → Supabase → here with a `code`. We exchange
// it for a session (which sets the auth cookies) and send the user onward.

/**
 * Only allow same-origin, root-relative redirect targets — never an absolute or
 * protocol-relative URL (`//evil.com`, `/\evil.com`). Prevents `?next=` from
 * being turned into an open redirect. Falls back to `/admin`.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return '/admin';
  }
  return raw;
}

export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));

  if (code) {
    const supabase = createSupabaseServerClient(context);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return context.redirect(next);
  }

  return context.redirect('/sign-in?error=auth');
};
