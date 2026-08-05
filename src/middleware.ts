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

    // Admin HTML is database-backed, per-user, and was never revalidated on
    // the server's instruction — so the browser was free to hand back a
    // snapshot on a soft reload, and bfcache would restore one wholesale on
    // Back. That is why the workshop needed a HARD refresh to see a
    // constellation you had just made: the request the reload should have sent
    // was never sent at all.
    //
    // Three things this buys, in descending order of how often they matter:
    // reloads stop lying, Back stops restoring a stale workshop, and admin HTML
    // stops sitting in the disk cache after sign-out.
    //
    // ⚠ THE COST IS bfcache, DELIBERATELY. `no-store` disables it for the whole
    // admin area, so pressing Back re-runs the page's queries rather than
    // restoring a live DOM. That is the intent — a restored workshop is a lying
    // workshop — and it is affordable here precisely because this is one
    // signed-in user on their own data. Do NOT copy this rule to the public
    // side, where bfcache is doing real work for real readers.
    const res = await next();
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  return next();
});
