-- Web push: who to reach, and proof of what was already sent (21 · Phase 2).
--
-- ⚠ THIS IS THE FIRST SCHEMA IN THE BUILDING THAT EXISTS TO REACH MICHAEL WHEN
-- NO PAGE IS OPEN. Everything before it answered a question he came and asked.
-- [ADR-0013](docs/adr/0013-absence-never-accumulates.md) is therefore at its
-- maximum strength here — a push is the loudest possible version of the surface
-- that ADR is about — and the constraint that keeps it honest is NOT in this
-- file: it is the *condition* under which a row here gets used at all. See
-- 21 · Phase 3. What this file owes is that the machinery cannot double-send.
--
-- ── WHY DECLARATIVE PUSH MEANS NO SERVICE WORKER ─────────────────────────────
--
-- Proven on the real phone 2026-08-06 before a line of this was written: a
-- subscription minted from `window.pushManager` with NO service worker in
-- existence, delivered by Apple, rendered by WebKit itself. So this schema
-- backs a page, not a worker — and [ADR-0010](docs/adr/0010-online-first-writing.md)
-- is untouched, because nothing here caches, intercepts a request, or gives the
-- app a second source of truth. ADR-0019 records that in full.

-- ─────────────────────────────────────────────────────────────────────────────
--  1 · WHO TO REACH
-- ─────────────────────────────────────────────────────────────────────────────
create table public.push_subscriptions (
  -- ⚠ THE ENDPOINT IS THE IDENTITY, so it is the key. It is minted by the push
  -- service, it is what the sender POSTs to, and it is what 404/410 condemns.
  --
  -- The loser is a synthetic `uuid` with a unique index beside it: it would add
  -- a second name for one thing, and every upsert and every prune would have to
  -- decide which name it meant. Nothing references a subscription — the ladder's
  -- log in Phase 4 keys on the TASK, not on the device it reached — so the one
  -- argument for a surrogate key does not arise.
  endpoint text primary key,

  -- The subscription's own encryption parameters, straight from
  -- `PushSubscription.toJSON()`. Stored as they arrive: they are meaningless
  -- without the endpoint, they are useless to anyone who cannot also present the
  -- VAPID private key, and the sender cannot encrypt a payload without them.
  p256dh text not null,
  auth   text not null,

  -- ⚠ ONE ROW PER DEVICE, AND THAT IS THE POINT. The phone and the desktop each
  -- subscribe separately and each get their own row; a send is a loop over all
  -- of them. `user_agent` exists only so a human reading this table can tell
  -- which row is which phone when pruning by hand — nothing branches on it.
  user_agent text,

  created_at   timestamptz not null default now(),

  -- Bumped every time the installed app re-asserts its subscription on load.
  -- ⚠ THIS IS THE NO-SERVICE-WORKER ANSWER TO SUBSCRIPTION ROT. With a worker,
  -- `pushsubscriptionchange` would fire in the background and repair itself.
  -- Without one, the app repairs it on every open instead — which is enough,
  -- because a subscription that has not been re-asserted in months belongs to a
  -- device that is not being used, and the 404/410 prune retires it anyway.
  last_seen_at timestamptz not null default now()
);

comment on table public.push_subscriptions is
  'One row per installed device. `endpoint` is minted by the push service and is the identity; delete on 404/410.';

-- ─────────────────────────────────────────────────────────────────────────────
--  2 · WHAT WAS ALREADY SENT
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ⚠ THE INSERT *IS* THE CLAIM, and that is the whole design. The scheduler
-- fires HOURLY (it must, because `pg_cron` runs on UTC and HQ's day boundary is
-- `settings.home_timezone` — resolving the zone in code is the only way that
-- survives DST), so the guard against a second push cannot be the schedule. It
-- has to be the database.
--
--   insert into push_day_claims (ymd) values ($1)
--   on conflict (ymd) do nothing
--   returning ymd;              -- no row returned ⇒ somebody already sent it
--
-- Same shape as the calendar sync's fix (`f5bb568`): CLAIM THE ROW BEFORE YOU
-- DO THE WORK. Three things it makes impossible, each of which is real:
--
--   1. The hourly tick firing twice in one day.
--   2. A manual invocation of the function while the schedule also runs.
--   3. ⚠ THE DST REPEAT HOUR. On the November night the clocks go back, 01:00
--      to 02:00 in New York happens TWICE, and a naive "is it past the send
--      time" check is true in both of them.
--
-- One row per day sent, and nothing is written on a day that stays quiet — so
-- this table is also the honest record of how often the tripwire actually
-- spoke, which is exactly the number to look at before deciding it is welcome.
create table public.push_day_claims (
  -- The LOCAL day in `settings.home_timezone`, never `current_date` — the
  -- server's clock is UTC, so a claim made at 8pm in New York would be dated
  -- tomorrow. Same rule `task_events.occurred_on` states for the same reason.
  ymd date primary key,

  sent_at timestamptz not null default now(),

  -- How many devices the send actually reached, recorded after the fact. Not a
  -- constraint on anything — it is here so that "did it go out?" and "did it go
  -- anywhere?" are different questions with different answers.
  delivered int not null default 0
);

comment on table public.push_day_claims is
  'One row per day the daily push was claimed. The INSERT is the claim — see the header.';

-- ─────────────────────────────────────────────────────────────────────────────
--  3 · RLS — the admin, and nobody else
-- ─────────────────────────────────────────────────────────────────────────────
--
-- NO `anon` POLICY OF ANY KIND: private by omission, which is the whole HQ
-- posture (ADR-0012), and the same shape every table in this half already uses.
--
-- ⚠ NOT `TO authenticated USING (true)`, which is the outlier GROUND-RULES
-- already flags on `constellations_select_admin`. That form says "any signed-in
-- user", and on a single-admin project it LOOKS identical right up until it is
-- not. `is_admin()` is the rule everywhere else and it is the rule here.
--
-- ⚠ AND THE SENDER DOES NOT USE THESE POLICIES. The Edge Function reads this
-- table with the service role, which bypasses RLS by design — that is what lets
-- a scheduled job run with nobody signed in. These policies govern the BROWSER:
-- the permission button writing its own row, and nothing else.
alter table public.push_subscriptions enable row level security;
alter table public.push_day_claims    enable row level security;

create policy push_subscriptions_all_admin on public.push_subscriptions
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Readable by the admin so a room can one day say "it last spoke on Tuesday";
-- written only by the sender, which does not come through RLS at all.
create policy push_day_claims_all_admin on public.push_day_claims
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_day_claims    to authenticated;
