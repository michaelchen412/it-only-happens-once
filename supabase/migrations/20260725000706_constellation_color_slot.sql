-- Recovered 2026-07-30 from supabase_migrations.schema_migrations: this ran
-- against the live database on 2026-07-25 but was never written to this folder.

-- A constellation's colour is a SLOT, never a raw value: the database stores
-- which hue of the sky's own ramp (stellar temperature: hot violet/blue through
-- amber to cool ember/rose), and app.css decides what that slot means in each
-- theme. This keeps design.md's law intact — the palette lives in one file, and
-- dusk/paper can render the same slot at different lightness.
alter table constellations
  add column color text not null default 'amber'
  check (color in ('violet','ice','azure','gold','amber','sand','ember','rose'));

-- Spread the four seeded constellations across the ramp so the colour coding is
-- legible immediately (and so "least-used slot" auto-assignment starts sane).
update constellations set color = 'amber' where slug = 'conditions-not-character';
update constellations set color = 'ice'   where slug = 'it-only-happens-once';
update constellations set color = 'rose'  where slug = 'the-one-who-reaches-first';
update constellations set color = 'ember' where slug = 'not-looking-away';
