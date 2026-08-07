-- ⚠ CORRECTS `push_hourly_schedule`, WHICH WOULD HAVE FAILED SILENTLY EVERY HOUR.
--
-- That migration called `extensions.http_post(...)`, on the assumption that
-- `create extension pg_net with schema extensions` had put it there. It had
-- not: on this project `pg_net` lives in schema `net`, so the scheduled command
-- raised `function does not exist` — inside a cron job, where nobody sees it.
--
-- ⚠ THIS IS THE FEATURE'S CHARACTERISTIC FAILURE MODE, and it is why the fix is
-- recorded rather than quietly edited. Everything here fails QUIETLY: a wrong
-- schema, a missing secret, a stale key, a Vault entry that never reached the
-- Edge runtime. None of them throw where a person is watching; they simply mean
-- the phone never rings on the morning it should, which is indistinguishable
-- from "nothing was waiting".
--
-- Found by RUNNING the job's own command by hand rather than trusting that
-- `cron.job` had a row in it. A scheduled job that exists and a scheduled job
-- that works are different claims, and only one of them is worth anything.
--
-- `cron.schedule` upserts on the job name, so this replaces rather than adds.
select cron.schedule(
  'push-send-hourly',
  '5 * * * *',
  $job$
  select net.http_post(
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
