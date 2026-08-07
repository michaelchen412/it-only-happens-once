-- The scheduler (21 · Phase 3, ADR-0019).
--
-- ⚠ THIS REPOSITORY DELIBERATELY HAD NO CRON, AND `src/actions/calendar.ts`
-- EXPLAINS AT LENGTH WHY IT WAS GLAD. The calendar dodged the problem with
-- sync-on-view; push cannot, because the entire point is to arrive when no page
-- is open. So this introduces the thing that comment is glad to be without —
-- and it concedes the least: the schedule and the secret both live inside
-- Supabase, and the SITE's own domain gains no endpoint.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ⚠ HOURLY, AND THE HOUR IS NOT THE POINT. `pg_cron` fires on UTC; HQ's day
-- boundary and `settings.push_time` are both in `settings.home_timezone`. A
-- schedule written as "10am" would arrive at 6am in New York — and 5am for half
-- the year, because the offset is not a constant. So the schedule is deliberately
-- DUMB: tick every hour, and let the function answer "what day is it and what
-- time is it where Michael is". Hard-coding today's offset here is the exact
-- mistake `settings.home_timezone` exists to prevent.
--
-- ⚠ FIRING HOURLY IS SAFE ONLY BECAUSE OF TWO GUARDS IN THE FUNCTION, and
-- neither may be removed: the CONDITION (speak only when the check-in is still
-- open) and the CLAIM (`push_day_claims`, where the insert is the claim). The
-- schedule itself guarantees nothing about how often the phone rings.
--
-- ⚠ THE SECRET IS READ FROM VAULT BY NAME. It is NOT written here, because this
-- repository is public and a migration is a published file. It was created out
-- of band as `push_cron_secret`; the same value is also an Edge Function secret
-- (`PUSH_CRON_SECRET`), because Postgres reads one and Deno reads the other.
--
-- ⚠⚠ THIS MIGRATION IS WRONG AND IS CORRECTED BY THE NEXT ONE. It calls
-- `extensions.http_post`, which does not exist on this project — `pg_net` lives
-- in schema `net`. Kept as applied rather than edited, because the record of
-- what ran matters more than the record being tidy.
select cron.schedule(
  'push-send-hourly',
  '5 * * * *',
  $job$
  select extensions.http_post(
    url := 'https://deodwnoztppvtrnehwzg.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);
