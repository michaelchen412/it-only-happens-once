import { defineMiddleware } from 'astro:middleware';
import { createSupabaseServerClient } from './lib/supabase';

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createSupabaseServerClient(context);

  // Validate/refresh the session against Supabase. Returns null cheaply when
  // there is no auth cookie, so public traffic isn't penalized.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  context.locals.supabase = supabase;
  context.locals.user = user;

  // Protect the admin area: require the admin role (Michael only).
  if (context.url.pathname.startsWith('/admin')) {
    if (!user) return context.redirect('/sign-in');
    if (user.app_metadata?.role !== 'admin') {
      return context.redirect('/sign-in?denied=1');
    }
  }

  return next();
});
