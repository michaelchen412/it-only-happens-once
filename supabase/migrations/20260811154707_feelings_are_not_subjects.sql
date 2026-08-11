-- ============================================================================
-- A feeling is not a subject, and gets its own table
-- Plan: docs/plans/33 · §1, §2 · Rulings 5 and 6
--
-- ⚠ WHY THIS IS NOT A DISCRIMINATOR COLUMN ON `subjects`. A subject is what a
-- piece is ABOUT; a feeling is what a song DOES TO YOU. Same register, opposite
-- direction. One table with a `kind` column would be the obvious saving and
-- would invite exactly the category error this corpus already made once, when a
-- song got filed under the subject `jazz` — a genre label, in a taxonomy of 22
-- words about living, attached to nothing else. Two tables make that mistake
-- impossible to spell.
--
-- THE MIRROR IS `subjects` / `fragment_subjects`, DELIBERATELY AND NOT
-- `constellations` / `fragment_constellations`. Plan 26's rider found those two
-- were the only tables carrying an anon-only SELECT, which left a signed-in
-- non-admin matching no policy at all; both were fixed 2026-08-08. Copying the
-- nearest join table without checking is how that shape comes back.
--
-- TWO DELIBERATE DEVIATIONS FROM THE MIRROR, so nobody later "aligns" them:
--   1. `feelings` has a UNIQUE INDEX ON lower(name); `subjects` does not.
--      The name is renameable (ruling 6) and the room prints the word itself,
--      so `Tender` and `tender` existing at once would show the same shelf
--      twice. Subjects can tolerate that; a room built out of its vocabulary
--      cannot.
--   2. `feelings` has NO `definition` column, where `subjects` does. §1's whole
--      claim is that a small shared vocabulary does the work with no gloss
--      attached — a feeling that needs a definition is a feeling that needs a
--      different word. Add one later if tagging proves otherwise; do not add it
--      pre-emptively, because a nullable prose field is an invitation.
-- ============================================================================

create table public.feelings (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- FROZEN once created. §7 puts this in the URL (`?feeling=regretful`), so it
  -- is something people send each other, and plan 32 §1 found that moving a
  -- slug hard-404s every old link. A rename changes the name and leaves this
  -- alone, so `remorseful` may live at `?feeling=regretful` forever — accepted,
  -- because the link keeps working, which is the part that matters.
  slug       text not null unique,
  -- NOT COSMETIC. The field is ordered dark -> light (grieving … ecstatic)
  -- rather than alphabetically, and that ordering is a claim about the
  -- spectrum. Claims belong in data, not in a hardcoded array in a component.
  sort       integer not null,
  created_at timestamptz not null default now()
);

create unique index feelings_name_ci on public.feelings (lower(name));

create table public.fragment_feelings (
  fragment_id uuid not null references public.fragments(id) on delete cascade,
  feeling_id  uuid not null references public.feelings(id)  on delete cascade,
  primary key (fragment_id, feeling_id)
);

-- The room's only question is "which songs carry this feeling", which reads the
-- join backwards. `fragment_subjects` carries the same index for the same
-- reason.
create index fragment_feelings_feeling_idx on public.fragment_feelings (feeling_id);

alter table public.feelings          enable row level security;
alter table public.fragment_feelings enable row level security;

-- --- feelings: `subjects`' four, exactly -------------------------------------
create policy feelings_select_all on public.feelings
  for select to anon, authenticated using (true);

create policy feelings_insert_admin on public.feelings
  for insert to authenticated with check ((select public.is_admin()));

create policy feelings_update_admin on public.feelings
  for update to authenticated using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy feelings_delete_admin on public.feelings
  for delete to authenticated using ((select public.is_admin()));

-- --- fragment_feelings: `fragment_subjects`' five ----------------------------
-- ⚠ THE PUBLIC SELECT IS NOT `true`, AND THAT IS ON PURPOSE. It is gated on the
-- fragment being published and not deleted, which is what `fragment_subjects`
-- does and what the whole corpus's read boundary is. A draft song's feelings
-- are not public before the song is.
--
-- ⚠ AND THIS IS NOT PLAN 33's "untagged songs are not shown" RULE. That one is
-- a DISPLAY rule and must stay in the room's query — the data is public
-- (Michael, 2026-08-10: "it's fine if that's still public data. It's just not
-- worth showing on the page"). Putting it here would silently change what the
-- paired player under an essay can read, and would be very hard to unpick.
create policy ff_select_public on public.fragment_feelings
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.fragments f
       where f.id = fragment_feelings.fragment_id
         and f.status = 'published'
         and f.deleted_at is null
    )
  );

create policy ff_select_admin on public.fragment_feelings
  for select to authenticated using ((select public.is_admin()));

create policy ff_insert_admin on public.fragment_feelings
  for insert to authenticated with check ((select public.is_admin()));

create policy ff_update_admin on public.fragment_feelings
  for update to authenticated using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy ff_delete_admin on public.fragment_feelings
  for delete to authenticated using ((select public.is_admin()));

-- --- merge, from day one -----------------------------------------------------
-- ⚠ MERGE IS NOT A LATER FEATURE HERE, it is the thing that keeps the
-- vocabulary small. §1: the slow death is `wistful` and `reminiscent` splitting
-- one shelf in month three. Uniqueness catches `tender` twice; only merge
-- catches `tender` and `gentle`. It also happens to be the only exit from
-- ruling 6's collision case — a renamed feeling still owns its old slug, so a
-- new one wanting that slug is rejected rather than silently suffixed, and
-- merging is how you resolve it.
--
-- Shape copied from `merge_subjects` (2026-08-09): plpgsql so it is ONE
-- statement to Postgres and cannot half-apply, SECURITY INVOKER so RLS stays
-- the trust boundary, and the is_admin() line as the readable refusal — without
-- it a non-admin's call would touch zero rows under RLS and return success.
--
-- No absorption block, unlike `merge_subjects`: there is no nullable prose
-- field to fill in. The survivor keeps its own name, slug and sort.
create or replace function public.merge_feelings(from_id uuid, into_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if from_id = into_id then
    raise exception 'Pick two different feelings.' using errcode = '22023';
  end if;
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.feelings where id = from_id)
     or not exists (select 1 from public.feelings where id = into_id) then
    raise exception 'One of those feelings no longer exists.' using errcode = 'P0002';
  end if;

  -- A song already carrying the survivor keeps one row rather than failing on
  -- the primary key.
  insert into public.fragment_feelings (fragment_id, feeling_id)
  select ff.fragment_id, into_id
    from public.fragment_feelings ff
   where ff.feeling_id = from_id
  on conflict (fragment_id, feeling_id) do nothing;

  -- The leftovers go with the cascade on `fragment_feelings.feeling_id`.
  delete from public.feelings where id = from_id;
end;
$$;
