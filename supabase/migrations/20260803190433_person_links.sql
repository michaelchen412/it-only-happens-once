-- Person ↔ corpus links (docs/plans/12-people.md §5 and §9, ADR-0012).
--
-- THE ONE SEAM BETWEEN THE TWO HALVES OF THE HOUSE. 10-hq.md §2 is otherwise
-- absolute — HQ data never becomes corpus data, and a log entry is never
-- promoted into an essay. These two tables are the single exception, and they
-- are shaped so the exception leaks in one direction only: they REFERENCE
-- public rows, and are themselves entirely private.
--
-- ⚠ WHY TWO TABLES AND NOT ONE person↔fragment JOIN. Michael's example is the
-- design: "if Noelle recommended On Earth We're Briefly Gorgeous, then on
-- Noelle's profile I want to see the quotes from that book." That is a TWO-HOP
-- path — person → work → fragments — and `works` already exists (ADR-0008).
-- Linking the work once means every quote carrying that `work_id` appears on
-- her profile automatically, INCLUDING ONES ADDED YEARS LATER. Tagging each
-- quote by hand would give the same page today and a stale one in a year.
--
-- `person_fragments` is the direct edge for what the two-hop path cannot reach:
-- a specific song someone sent, or a line they said out loud that never came
-- from a book.
--
-- NO `person_authors`, though §5 sketches it ("she got me into Ocean Vuong").
-- It is plausible, weaker, and largely derivable from the works already linked
-- — §5 defers it until it earns itself, and a third join table that nothing
-- reads is a third join table to keep correct in the export and the backup.
--
-- NO ENUM OF LINK KINDS, deliberately (§5). "Recommended" / "gave me" / "we
-- read it together" is a taxonomy that looks right on paper and is wrong after
-- a month; `note` holds the nuance in words until a pattern actually emerges.

create table public.person_works (
  person_id uuid not null references public.people(id) on delete cascade,
  work_id uuid not null references public.works(id) on delete cascade,

  -- Optional, free text: "recommended, Mar 2024". The whole taxonomy, until
  -- there is evidence for a smaller one.
  note text,

  created_at timestamptz not null default now(),
  primary key (person_id, work_id)
);

comment on table public.person_works is
  'PRIVATE. Person → work; the profile then shows every fragment carrying that work_id, including ones added later.';

create table public.person_fragments (
  person_id uuid not null references public.people(id) on delete cascade,
  fragment_id uuid not null references public.fragments(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  primary key (person_id, fragment_id)
);

comment on table public.person_fragments is
  'PRIVATE. The direct edge, for what person → work → fragments cannot reach: a song someone sent, a line they said out loud.';

-- The primary key already indexes (person_id, …), which is the profile's
-- direction. This one serves the OTHER direction — "who shared this?" — which
-- the fragment editor's Shared-by field asks on every open. `person_works` gets
-- no matching index because nothing asks "who recommended this work?": there is
-- no work page to ask it from. Add it with the surface that needs it, not
-- before.
create index person_fragments_fragment on public.person_fragments (fragment_id);

alter table public.person_works enable row level security;
alter table public.person_fragments enable row level security;

-- ⚠ NO `anon` POLICY, AND THAT IS THE WHOLE SECURITY ARGUMENT FOR THIS PIECE.
-- §5: "A published quote stays public; the fact that Noelle is why it exists is
-- HQ data." These tables reference public rows and are not themselves public at
-- any grain — not the note, not the count, not the existence of the row. Private
-- by omission (ADR-0012), the same posture as `people` and `interactions`.
--
-- The second half of that guarantee is not written here: public queries must
-- never touch these tables at all, so there is no join for a policy to have to
-- get right. That is asserted by the specs and by the live anon drive.
create policy person_works_all_admin on public.person_works
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy person_fragments_all_admin on public.person_fragments
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.person_works to authenticated;
grant select, insert, update, delete on public.person_fragments to authenticated;
