-- ============================================================================
-- The starting sixteen
-- Plan: docs/plans/33 · §1
--
-- ⚠ THIS IS A DRAFT AND IS MEANT TO CHANGE. Nine of these are Michael's own
-- words from the conversation that started this plan; seven are mine. §1's
-- position is that a vocabulary is DISCOVERED BY TAGGING, NOT BY DRAFTING — so
-- these exist to give the bench something to click on its first day, and the
-- first thirty songs are expected to rename, merge and add.
--
-- ⚠ THE ORDER IS THE CLAIM. Dark to light, grieving -> ecstatic. It is not
-- alphabetical and must not be "tidied" into alphabetical: the field in the
-- room is read as a spectrum, and that is the whole reason `sort` is a column
-- instead of an ORDER BY name.
--
-- Gaps of ten so a word discovered mid-listening can land between two existing
-- ones without renumbering the rest. §6a needs that: the moment you have to
-- stop and renumber is the moment adding a word stops happening mid-flow.
--
-- `wistful` is deliberately ABSENT. It and `reminiscent` would split one shelf,
-- which is the exact drift §1 says kills a taxonomy — and uniqueness cannot
-- catch it, only judgement can.
-- ============================================================================
insert into public.feelings (name, slug, sort) values
  ('grieving',     'grieving',     10),
  ('regretful',    'regretful',    20),
  ('melancholic',  'melancholic',  30),
  ('reminiscent',  'reminiscent',  40),
  ('yearning',     'yearning',     50),
  ('searching',    'searching',    60),
  ('restless',     'restless',     70),
  ('tense',        'tense',        80),
  ('defiant',      'defiant',      90),
  ('courageous',   'courageous',  100),
  ('tender',       'tender',      110),
  ('compassionate','compassionate',120),
  ('hopeful',      'hopeful',     130),
  ('redemptive',   'redemptive',  140),
  ('resolved',     'resolved',    150),
  ('ecstatic',     'ecstatic',    160);
