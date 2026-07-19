-- Switch the admin predicate from the (removed) Clerk `user_role` claim to
-- Supabase Auth's native `app_metadata.role`. app_metadata is only settable
-- server-side (service role), so it's safe to trust in RLS. See docs/auth.md.
--
-- The RLS policies are unchanged — they call public.is_admin(); only the body
-- of the function changes. Until Michael's user is granted the role, this
-- returns false for everyone, so all writes stay closed.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;
