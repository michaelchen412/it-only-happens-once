-- Recovered 2026-07-30 from supabase_migrations.schema_migrations: this ran
-- against the live database on 2026-07-23 but was never written to this folder.
-- It is the source of the drift docs/plans/README.md warned about — the
-- constellations.status / score_url columns and the draft-hiding RLS.

-- Constellation lifecycle: drafts ("piles") never reach the public sky.
alter table constellations
  add column status text not null default 'draft'
    check (status in ('draft','published')),
  add column score_url text;

-- The four live constellations stay live.
update constellations set status = 'published';

-- RLS: anon sees only published constellations and their placements.
-- (Authenticated = the admin; sees everything, including drafts, which is
-- what makes /{slug} a free draft preview.)
drop policy constellations_select_all on constellations;
create policy constellations_select_public on constellations
  for select to anon using (status = 'published');
create policy constellations_select_admin on constellations
  for select to authenticated using (true);

drop policy fc_select_public on fragment_constellations;
create policy fc_select_public on fragment_constellations
  for select to anon using (
    exists (select 1 from constellations c
            where c.id = constellation_id and c.status = 'published')
  );
