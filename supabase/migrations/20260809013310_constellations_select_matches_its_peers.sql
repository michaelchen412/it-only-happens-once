-- ============================================================================
-- The Sky's read policies stop being the exception
-- Plan: docs/plans/26 · §3 rider · Flagged in docs/plans/GROUND-RULES.md
--
-- `constellations_select_admin` was `TO authenticated USING (true)` where every
-- peer policy in the schema uses `is_admin()`. Not exploitable — sign-up is
-- Google-only behind an allowlist hook and there is one account — but it is the
-- shape a future namespace gets copied from, and `push_subscriptions` already
-- had to write a comment explaining why it was NOT following it.
--
-- ⚠ TIGHTENING THE ADMIN POLICY ALONE WOULD HAVE BEEN THE WRONG HALF OF THE
-- FIX, and this is the part the one-line description missed. `is_admin()` on
-- the admin policy makes a signed-in non-admin match no SELECT policy at all,
-- because the public policy here is `TO anon` — so the Sky would go blank for
-- them rather than showing what a stranger sees. The peer this is being brought
-- in line with does not have that hole: `fragments_select_published` is
-- `TO anon, authenticated`. Both halves, or the outlier just moves.
--
-- `fragment_constellations` gets the same treatment for the same reason — it is
-- the other half of the same feature, and a `pg_policies` sweep found these two
-- and only these two carrying the anon-only shape.
-- ============================================================================

drop policy if exists constellations_select_admin on public.constellations;
create policy constellations_select_admin on public.constellations
  for select to authenticated using ((select public.is_admin()));

drop policy if exists constellations_select_public on public.constellations;
create policy constellations_select_public on public.constellations
  for select to anon, authenticated using (status = 'published');

drop policy if exists fc_select_public on public.fragment_constellations;
create policy fc_select_public on public.fragment_constellations
  for select to anon, authenticated using (
    exists (
      select 1 from public.constellations c
       where c.id = fragment_constellations.constellation_id
         and c.status = 'published'
    )
  );
