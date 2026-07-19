import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../lib/supabase';

// OAuth (PKCE) return leg: Google → Supabase → here with a `code`. We exchange
// it for a session (which sets the auth cookies) and send the user onward.
export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/admin';

  if (code) {
    const supabase = createSupabaseServerClient(context);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return context.redirect(next);
  }

  return context.redirect('/sign-in?error=auth');
};
