-- Three facts, one derived line — the data catching up with the model.
-- (17 · provenance; specified in 17a · the quote matrix.)
--
-- ⚠ READ THE DRY RUN BEFORE RUNNING THIS. Plan 17 asks for it by name and the
-- reason is worth restating: the surviving-override list at the foot is the
-- evidence for whether the derivation rule is right. An empty list means the
-- rule covers every quote Michael owns. A list of five means the matrix is
-- missing a case — and that is a thing to learn BEFORE shipping, not after.
--
-- Measured 2026-08-05 against the live corpus, 76 published quotes:
--
--     line matches the stored attribution, BEFORE   74/76
--     line matches the stored attribution, AFTER    76/76
--     surviving overrides                            0
--
-- ⚠ SO NO PUBLISHED QUOTE CARD CHANGES WHAT IT SHOWS. That is the property to
-- preserve if this file is ever edited. An earlier draft of the matrix appended
-- the locator to the line whenever one existed, which would have rewritten 22
-- live cards from "— Marcus Aurelius" to "— Marcus Aurelius, Book 8:9" — a
-- public design change smuggled inside an admin fix. Putting the locator behind
-- a reveal instead (Michael's call) is what makes the whole thing additive.
--
-- ⚠ `attribution` IS NOT NULLED HERE, and that is deliberate. It becomes a
-- derived-and-stored value: the form never asks for it, the server computes it
-- on every save, and the column keeps holding exactly what it holds today.
-- Nulling it is only safe once QuoteCard and SuiteStanza derive the line
-- themselves — they read `item.attribution` and nothing else — and those two
-- files belong to the reveal piece, not to this one. When that ships, dropping
-- the column's contents is a one-line follow-up whose no-op-ness is already
-- proven by the 76/76 above.
--
-- Four steps, in this order. Step 1 reads what step 4 deletes.

-- ── 1 · THE ONE JUDGEMENT CALL ────────────────────────────────────────────────
-- The Ecclesiastes 9:11 row is filed under NO work at all, with the Bible as a
-- loose string in `details` — so it does not appear beside the other two verses
-- under any grouping or filter. It is the scar left by the seeding trap fixed in
-- ce11bc4: typing a book name into the old Attribution field seeded a phantom
-- author, which emptied the Work list, so "The Bible" could not be chosen and
-- the only way forward was to type it into Source title instead.
--
-- Resolved by slug rather than by a pasted id: the id is generated data and
-- hardcoding it would make this file untrue anywhere but this one database.
update public.fragments f
   set work_id = w.id
  from public.works w
 where f.type = 'quote'
   and f.work_id is null
   and w.slug = 'the-bible'
   and f.details->>'source_title' = 'The Bible';

-- ── 2 · LOCATORS OUT OF THE COLUMN MEANT FOR NAMES ───────────────────────────
-- "Matthew 5:43-48" and "Ecclesiastes 1:18" are sitting in `attribution`,
-- because with no author there was nowhere else to put them. That is the exact
-- ambiguity this whole plan removes: `attribution` held the WHO on some rows and
-- the WHERE on others, so every quote made you decide which.
--
-- Nothing is deleted — the locator is COPIED into the Where, and `attribution`
-- keeps the same string it always had. It is now the derived line rather than a
-- hand-typed one, which is why the assertion at the foot passes.
--
-- ⚠ The last condition is load-bearing and is not defending against today's
-- data. A quote whose line IS its work — a film, say: "— Arrival", no author, no
-- locator — matches every other condition here, and copying "Arrival" into the
-- Where would invent a reference that does not exist. There is no such row yet.
-- There will be (matrix row 12).
update public.fragments f
   set details = coalesce(f.details, '{}'::jsonb) || jsonb_build_object('citation', f.attribution)
  from public.works w
 where f.type = 'quote'
   and f.author_id is null
   and f.work_id = w.id
   and not (coalesce(f.details, '{}'::jsonb) ? 'citation')
   and coalesce(f.attribution, '') <> ''
   and f.attribution is distinct from w.title;

-- ── 3 · `page` FOLDS INTO THE WHERE ──────────────────────────────────────────
-- "p. 41" is a locator like any other, and Michael's call was to KEEP BOTH
-- rather than choose: his Seneca row carries a letter reference AND a page, and
-- dropping either loses something he took the trouble to record. Seven rows —
-- six Ocean Vuong pages, and that one Seneca ("Letter 2:3, p. 19").
update public.fragments
   set details = (coalesce(details, '{}'::jsonb) - 'page')
                 || jsonb_build_object(
                      'citation',
                      case
                        when coalesce(details->>'citation', '') = '' then 'p. ' || (details->>'page')
                        else (details->>'citation') || ', p. ' || (details->>'page')
                      end)
 where type = 'quote'
   and coalesce(details, '{}'::jsonb) ? 'page';

-- ── 4 · `source_title` GOES ──────────────────────────────────────────────────
-- 42 live rows carry one; 41 are a verbatim copy of `works.title`. The 42nd was
-- step 1. The form labelled it "shown after the attribution" and it was shown
-- after the attribution in exactly zero places a reader could reach — its only
-- consumer was one column of the admin list, which now reads the relation
-- instead (FragmentRow.astro). A copy of a column is a copy that can drift.
update public.fragments
   set details = coalesce(details, '{}'::jsonb) - 'source_title'
 where type = 'quote'
   and coalesce(details, '{}'::jsonb) ? 'source_title';

-- ── THE SURVIVING-OVERRIDE LIST, AS AN ASSERTION ─────────────────────────────
-- Plan 17: "run it as a dry-run first and READ that list. If it's empty, the
-- rule is right. If it has five rows, you've found the fifth case before
-- shipping rather than after."
--
-- This is that check, made blocking. The rule below is the SQL twin of
-- deriveProvenance() in src/lib/provenance.ts — who, else where, else from —
-- and 25 unit tests pin the TypeScript side to the same fourteen cases. If they
-- ever disagree, this migration is the one that notices.
--
-- Migrations run in a transaction, so a raise here rolls back all four steps
-- above and the corpus is untouched. Deleting this block to "make it apply" is
-- deleting the only thing that makes applying it safe.
do $$
declare
  bad int;
  sample text;
begin
  select count(*),
         string_agg(format('%L → %L', f.attribution, f.derived), E'\n  ')
    into bad, sample
    from (
      select f.attribution,
             coalesce(a.name, nullif(f.details->>'citation', ''), w.title, '') as derived
        from public.fragments f
        left join public.authors a on a.id = f.author_id
        left join public.works   w on w.id = f.work_id
       where f.type = 'quote'
    ) f
   where coalesce(f.attribution, '') is distinct from f.derived;

  -- ⚠ Exactly as many `%` as arguments. RAISE takes no `%s`, and getting that
  -- wrong is a COMPILE error in the DO block — which aborts the migration after
  -- the four updates above have already run. It rolled back cleanly the first
  -- time this was applied, which is the transaction doing its job; but it means
  -- the assertion must itself be rehearsed, not just the statements it guards.
  if bad > 0 then
    raise exception
      'quote provenance: % row(s) still disagree with the derived line. The matrix is missing a case — read these before shipping: %',
      bad, sample;
  end if;
end $$;
