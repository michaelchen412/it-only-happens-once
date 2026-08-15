-- Plan 40 phase 3 — the feelings vocabulary retires.
--
-- ⚠ IRREVERSIBLE, AND THE COST IS 54 WORDS AND ONE LINK. The room they were
-- built for is gone (plan 40): a song was to be filed by what it did to you,
-- and in seventeen days ONE song out of 48 was ever tagged. The labour was
-- per-song and the payoff was a room Michael would not have sent anyone to.
-- What replaced it is a `set` — a curated Spotify playlist somebody can save —
-- which is seven decisions instead of forty-eight.
--
-- ⚠ THE VOCABULARY IS RECORDED HERE BECAUSE THIS FILE IS WHERE APPLIED HISTORY
-- LIVES, and it was real work: 54 words ordered dark → light, not
-- alphabetically, because the order WAS the claim. In `sort` order:
--
--   despairing, desolate, grieving, forlorn, lonely, regretful, remorseful,
--   bitter, melancholic, weary, detached, reminiscent, contemplative, yearning,
--   desperate, ravenous, searching, uncertain, suspended, capricious, restless,
--   anxious, frenzied, tense, malevolent, oppressive, harrowing, relentless,
--   defiant, obstinate, unwavering, resolute, courageous, resilient, patient,
--   fragile, tender, gentle, warm, intimate, compassionate, humble, generous,
--   grateful, hopeful, unperturbed, peaceful, redemptive, cathartic, resolved,
--   proud, triumphant, unfettered, ecstatic
--
-- Near-synonyms were deliberate and are worth preserving in the record too:
-- `detached`/`unperturbed`, `tender`/`gentle`, `reminiscent`/`yearning` name
-- one shade at two weights, and 20260811154707_feelings_are_not_subjects.sql
-- argues why a field that cannot tell neighbouring shades apart cannot file
-- either of them.
--
-- ⚠ NOTHING ABOUT A SONG CHANGES HERE. `fragments` keeps all 48 song rows and
-- all 48 pairings; only the tagging relation goes. Songs leave `fragments` in
-- phase 4, which is a separate migration and a separate decision.

-- The join first — it carries the foreign key into both.
drop table public.fragment_feelings;

drop table public.feelings;

-- The merge helper existed so two words that split one shelf could be made one
-- without losing the links. With no links and no shelf, it has nothing to do.
drop function if exists public.merge_feelings(uuid, uuid);
