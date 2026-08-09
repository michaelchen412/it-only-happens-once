-- ============================================================================
-- Merging a subject, an author or a work is ONE TRANSACTION
-- Plan: docs/plans/26 · §1 · Actions: src/actions/vocabulary.ts
--
-- ⚠ WHAT THIS REPLACES, AND WHY IT IS IN THE DATABASE RATHER THAN IN THE ACTION.
-- The three merges used to be a sequence of unchecked statements in TypeScript:
-- remap the links, then hard-delete the merged-from row, with every write's
-- result thrown away. Two ways that lost data, both silent, both reported as
-- success:
--
--   1. A transient failure mid-remap still reached the delete. The FKs on
--      `fragments.author_id` / `fragments.work_id` are ON DELETE SET NULL, so a
--      half-finished merge quietly NULLED a fragment's author or work instead
--      of moving it, and `fragment_subjects` rows not yet remapped went out
--      with the cascade.
--   2. The works merge remapped `fragments.work_id` and nothing else — but
--      `person_works.work_id` CASCADES. Merging two works destroyed every
--      person's shelf link to the merged-from one, and the note written on it.
--
-- A plpgsql function is one statement to Postgres, so every branch below either
-- commits whole or rolls back whole. There is no "partly merged" state to
-- recover from and no ordering for a future reader to get wrong. The
-- alternative that lost: checking each result in TypeScript and refusing before
-- the delete. It is strictly weaker — the writes already committed stay
-- committed — and it leaves the correctness argument spread across three
-- handlers instead of stated once, here.
--
-- SECURITY INVOKER (the default, named anyway) — RLS stays the trust boundary
-- and these run as the caller, exactly as the actions did. The is_admin() line
-- at the top of each is the readable refusal: without it a non-admin's call
-- would touch zero rows under RLS and return success, which is the silent
-- `{ ok: true }` this plan's §3 is about.
--
-- THE ABSORPTION RULE, stated once and applied everywhere below: the survivor's
-- own values win, and only its BLANK fields are filled from the row about to
-- disappear. So a merge can add information and can never overwrite it. The
-- alternative that lost was "newest wins", which silently replaces prose you
-- wrote with prose you wrote — indistinguishable from a bug a month later.
-- ============================================================================

-- --- subjects ---------------------------------------------------------------
-- Only `fragment_subjects` points here, and it cascades.
create or replace function public.merge_subjects(from_id uuid, into_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if from_id = into_id then
    raise exception 'Pick two different subjects.' using errcode = '22023';
  end if;
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.subjects where id = from_id)
     or not exists (select 1 from public.subjects where id = into_id) then
    raise exception 'One of those subjects no longer exists.' using errcode = 'P0002';
  end if;

  -- Blank fields on the survivor take the disappearing row's answer.
  update public.subjects s
     set definition = coalesce(nullif(btrim(s.definition), ''), nullif(btrim(f.definition), ''))
    from public.subjects f
   where s.id = into_id and f.id = from_id;

  -- Move the links. A fragment already carrying the survivor keeps one row
  -- rather than failing on the primary key.
  insert into public.fragment_subjects (fragment_id, subject_id)
  select fs.fragment_id, into_id
    from public.fragment_subjects fs
   where fs.subject_id = from_id
  on conflict (fragment_id, subject_id) do nothing;

  -- The leftovers go with the cascade on `fragment_subjects.subject_id`.
  delete from public.subjects where id = from_id;
end;
$$;

-- --- authors ----------------------------------------------------------------
-- `fragments.author_id` and `works.author_id` point here, both SET NULL — which
-- is what made the old unchecked version lose attributions rather than fail.
create or replace function public.merge_authors(from_id uuid, into_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if from_id = into_id then
    raise exception 'Pick two different authors.' using errcode = '22023';
  end if;
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.authors where id = from_id)
     or not exists (select 1 from public.authors where id = into_id) then
    raise exception 'One of those authors no longer exists.' using errcode = 'P0002';
  end if;

  update public.authors a
     set sort_name = coalesce(nullif(btrim(a.sort_name), ''), nullif(btrim(f.sort_name), '')),
         note      = coalesce(nullif(btrim(a.note), ''),      nullif(btrim(f.note), ''))
    from public.authors f
   where a.id = into_id and f.id = from_id;

  update public.fragments set author_id = into_id where author_id = from_id;
  update public.works     set author_id = into_id where author_id = from_id;

  delete from public.authors where id = from_id;
end;
$$;

-- --- works ------------------------------------------------------------------
-- Three tables point here, and the third is the one the old version forgot.
create or replace function public.merge_works(from_id uuid, into_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if from_id = into_id then
    raise exception 'Pick two different works.' using errcode = '22023';
  end if;
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.works where id = from_id)
     or not exists (select 1 from public.works where id = into_id) then
    raise exception 'One of those works no longer exists.' using errcode = 'P0002';
  end if;

  update public.works w
     set author_id = coalesce(w.author_id, f.author_id),
         year      = coalesce(w.year, f.year),
         kind      = coalesce(nullif(btrim(w.kind), ''), nullif(btrim(f.kind), ''))
    from public.works f
   where w.id = into_id and f.id = from_id;

  update public.fragments set work_id = into_id where work_id = from_id;

  -- ⚠ THE SHELF LINKS. `person_works.work_id` cascades, so before this function
  -- existed a merge deleted them outright — the link AND the note on it, which
  -- is the only prose in that table.
  --
  -- `created_at` travels with the row rather than defaulting to now(): the
  -- People brief orders the shelf by it and reads it as "when this was shared",
  -- so letting it reset would silently move a book someone gave you in 2019 to
  -- the top of "recently".
  --
  -- On a person who shelved BOTH works there is one row's room for two notes.
  -- The absorption rule decides it: the survivor's note stands, and is filled
  -- from the other only when it is blank. `least(created_at)` keeps the earlier
  -- of the two dates for the same reason.
  insert into public.person_works as survivor (person_id, work_id, note, created_at)
  select pw.person_id, into_id, pw.note, pw.created_at
    from public.person_works pw
   where pw.work_id = from_id
  on conflict (person_id, work_id) do update
     set note       = coalesce(nullif(btrim(survivor.note), ''), nullif(btrim(excluded.note), '')),
         created_at = least(survivor.created_at, excluded.created_at);

  -- The leftovers go with the cascade on `person_works.work_id`.
  delete from public.works where id = from_id;
end;
$$;

-- --- grants -----------------------------------------------------------------
-- EXECUTE is granted to PUBLIC by default, which would put these on the anon
-- API surface. They refuse a non-admin anyway (is_admin(), and RLS underneath),
-- but an endpoint that exists in order to say no is still an endpoint.
revoke execute on function public.merge_subjects(uuid, uuid) from public, anon;
revoke execute on function public.merge_authors(uuid, uuid)  from public, anon;
revoke execute on function public.merge_works(uuid, uuid)    from public, anon;
grant execute on function public.merge_subjects(uuid, uuid) to authenticated;
grant execute on function public.merge_authors(uuid, uuid)  to authenticated;
grant execute on function public.merge_works(uuid, uuid)    to authenticated;

comment on function public.merge_subjects(uuid, uuid) is
  'Fold one subject into another, atomically: absorb blank fields, remap fragment_subjects, delete the source.';
comment on function public.merge_authors(uuid, uuid) is
  'Fold one author into another, atomically: absorb blank fields, remap fragments.author_id and works.author_id, delete the source.';
comment on function public.merge_works(uuid, uuid) is
  'Fold one work into another, atomically: absorb blank fields, remap fragments.work_id AND person_works (keeping the note and the shelf date), delete the source.';
