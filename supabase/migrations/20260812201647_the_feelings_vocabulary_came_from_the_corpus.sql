-- ============================================================================
-- Thirty-eight words, taken out of Michael's own writing
-- Plan: docs/plans/33 · §1
--
-- WHERE THEY CAME FROM. All 83 essays in the corpus (~65k words) were read two
-- ways: a sweep over adjective-shaped words, and a reverse check of ~350 known
-- feeling-words against actual usage. Every word below is attested in that
-- prose, most of them repeatedly — `generous` 18 times counting its family,
-- `desperate` 17, `relentless` 20. That is the whole point of the exercise:
-- the bench should offer words Michael already reaches for, so tagging a song
-- is recognition and not vocabulary-building, which is the thing §1 says will
-- otherwise stop happening mid-listen.
--
-- ⚠ NEAR-SYNONYMS ARE HERE ON PURPOSE, AND THE STARTING SIXTEEN'S CAUTION
-- AGAINST THEM IS OVERTURNED. `tender`/`gentle`/`warm`, `regretful`/
-- `remorseful`, `detached`/`unperturbed`, `desperate`/`ravenous` — each pair
-- names one feeling at two weights, and music divides exactly that finely
-- (Michael, 2026-08-12: "each word carries a different emotional weight … "
-- "something might feel detached and something might feel unperturbed, based "
-- "off of my subjective experience"). The live rule is written into
-- `src/lib/feelings.ts`; migration 20260811154747 keeps its original wording
-- as history. `merge_feelings` still earns its keep, but for genuine
-- duplicates now — not for shades.
--
-- ⚠ THE ORDER IS A DRAFT, AND IT IS MINE RATHER THAN HIS. Placement on the
-- dark → light spectrum is a judgement `src/lib/feelings.ts` reserves for
-- Michael, and seeding cannot happen without integers — so these are
-- considered guesses and are the first thing expected to move. The Library's
-- update action already takes a `sort`, so re-placing a word costs no
-- migration.
--
-- Three placements are arguments rather than filler:
--   · `despairing` and `desolate` sort BELOW `grieving`, at 3 and 6. Grief has
--     an object and therefore a shape; despair has neither. The sixteen never
--     reached that far down and the room's darkest end was simply unoccupied.
--   · `detached` (36) and `unperturbed` (133) sit a hundred apart. Same
--     withdrawal, opposite valence — one is an absence, one is composure — and
--     that distance is how a field with no `definition` column says so.
--   · `resolute` (98) is nowhere near `resolved` (150), for the same reason.
--     One is a will that will not bend; the other is an ending that settled.
--
-- WHAT WAS REJECTED, so it does not get helpfully re-added later. Words that
-- fail this file's own test — a feeling is what a song DOES TO YOU — because
-- they name a circumstance or a conclusion rather than a bearing a song can
-- carry: `stranded`, `powerless`, `disillusioned`, `fateful`, `elusive`. Words
-- that are only ever pejorative in the corpus and would have to flip meaning to
-- work here: `naive`, `lazy`, `haughty`, `profligate`. And the vivid ones that
-- are simply not his — `plaintive`, `brooding`, `bittersweet`, `haunting`,
-- `solemn`, `serene`, `jubilant`, `languid` occur in TWO documents across the
-- entire corpus, so seeding them would break the one test that made this list
-- worth building.
-- ============================================================================

-- Existing words are shown in brackets, unquoted, so the spectrum can be read
-- top to bottom. They are not touched.
insert into public.feelings (name, slug, sort) values
  ('despairing',    'despairing',      3),
  ('desolate',      'desolate',        6),
  --                                  10  [grieving]
  ('forlorn',       'forlorn',        13),
  ('lonely',        'lonely',         16),
  --                                  20  [regretful]
  ('remorseful',    'remorseful',     23),
  ('bitter',        'bitter',         26),
  --                                  30  [melancholic]
  ('weary',         'weary',          33),
  ('detached',      'detached',       36),
  --                                  40  [reminiscent]
  ('contemplative', 'contemplative',  44),
  --                                  50  [yearning]
  ('desperate',     'desperate',      53),
  ('ravenous',      'ravenous',       56),
  --                                  60  [searching]
  ('uncertain',     'uncertain',      62),
  ('suspended',     'suspended',      65),
  ('capricious',    'capricious',     68),
  --                                  70  [restless]
  ('anxious',       'anxious',        73),
  ('frenzied',      'frenzied',       76),
  --                                  80  [tense]
  ('malevolent',    'malevolent',     82),
  ('oppressive',    'oppressive',     84),
  ('harrowing',     'harrowing',      86),
  ('relentless',    'relentless',     88),
  --                                  90  [defiant]
  ('obstinate',     'obstinate',      93),
  ('unwavering',    'unwavering',     96),
  ('resolute',      'resolute',       98),
  --                                 100  [courageous]
  ('resilient',     'resilient',     103),
  ('patient',       'patient',       105),
  ('fragile',       'fragile',       108),
  --                                 110  [tender]
  ('gentle',        'gentle',        113),
  ('warm',          'warm',          115),
  ('intimate',      'intimate',      117),
  --                                 120  [compassionate]
  ('humble',        'humble',        123),
  ('generous',      'generous',      125),
  ('grateful',      'grateful',      127),
  --                                 130  [hopeful]
  ('unperturbed',   'unperturbed',   133),
  ('peaceful',      'peaceful',      136),
  --                                 140  [redemptive]
  ('cathartic',     'cathartic',     144),
  --                                 150  [resolved]
  ('proud',         'proud',         153),
  ('triumphant',    'triumphant',    155),
  ('unfettered',    'unfettered',    158);
  --                                 160  [ecstatic]
