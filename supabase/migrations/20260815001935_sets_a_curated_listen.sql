-- A SET — one Spotify playlist, one quote, one description (plan 40 §3).
--
-- A set is not a fragment and not a constellation. A fragment is text with
-- subjects, placeable in a constellation, readable at a URL; a set is none of
-- those. A constellation is where an idea is worked out; a set is where a
-- feeling is isolated, and it exists to be SAVED into somebody else's Spotify
-- library rather than read here.
--
-- Shaped after `constellations` because that is its nearest sibling — name,
-- description, status, sort — minus `color` (no Sky) and minus placed items.
create table public.sets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  -- An utterance, not a label. Also the Spotify playlist's own name, which is
  -- why the open pane renders no heading: the index carries the title so it is
  -- printed once in our type rather than twice.
  title text not null,
  description text not null default '',
  -- Exactly one playlist. Canonical, no `?si=` — an assortment of media cannot
  -- be saved, and being saveable is the whole proposition.
  playlist_url text not null,
  -- ⚠ EXACTLY ONE QUOTE, OR NONE, AND THAT IS WHY IT IS A COLUMN RATHER THAN A
  -- JOIN TABLE. Decided 2026-08-14 after a bench showed three: "it starts to get
  -- cluttered both from the perspective of ideas and visually." A scalar is a
  -- rule the schema keeps; a capped join table is a rule someone has to
  -- remember. If a set ever wants two, this column becomes a join and that is
  -- the correct amount of work for reversing a design decision.
  --
  -- ⚠ THE FK CANNOT CONSTRAIN `type = 'quote'` — Postgres cannot express that
  -- against another row's column. The action layer refuses anything else, the
  -- same way `songs.pair` refuses a non-writing.
  quote_fragment_id uuid references public.fragments(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.sets enable row level security;

-- Policies mirror `constellations` exactly, including the `(select is_admin())`
-- wrapping — GROUND-RULES records that `constellations_select_admin` was once
-- the outlier here (`TO authenticated USING (true)`) and was fixed on
-- 2026-08-08 to match its peers. This table starts matching.
create policy sets_select_public on public.sets
  for select to anon, authenticated using (status = 'published');
create policy sets_select_admin on public.sets
  for select to authenticated using ((select is_admin()));
create policy sets_insert_admin on public.sets
  for insert to authenticated with check ((select is_admin()));
create policy sets_update_admin on public.sets
  for update to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy sets_delete_admin on public.sets
  for delete to authenticated using ((select is_admin()));

comment on table public.sets is
  'A curated listen: one Spotify playlist, one quote, one description. Plan 40 §3. Not a fragment — see the plan for why the exceptions were the proof.';
