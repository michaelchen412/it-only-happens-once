# Backups

The corpus — every fragment in every status, the constellations that arrange
them, the vocabulary that describes them — lives in one hosted Supabase
Postgres. This page records how it's protected.

## The nightly dump

**[`michaelchen412/it-only-happens-once-backups`](https://github.com/michaelchen412/it-only-happens-once-backups)**
(private) runs a GitHub Actions workflow daily at 09:23 UTC that dumps the
database three ways — roles, schema, data — using the officially documented
`supabase db dump` trio, and commits the results under stable filenames.
**Git history is the archive**: any past day is `git show <commit>:data.sql`.

Design notes, so this isn't re-derived later:

- **It lives in a separate private repo** because this repo is public and the
  dump contains drafts and (eventually) private notes. Nothing about the
  backup — workflow, secret, or data — touches this repo.
- **GitHub Actions, not Vercel Cron**: Supabase's own documented CI-backup
  path, and none of the serverless limits (Hobby cron is daily ±59 min,
  300 s, 4.5 MB responses).
- **The connection secret is the Session pooler URI** (port 5432). GitHub
  runners are IPv4-only; Supabase direct connections are IPv6-only.
- **An implausibly small `data.sql` fails the run** instead of committing —
  a failed run emails; a silently-empty backup doesn't.
- Restore instructions live in that repo's README (the `psql
  --single-transaction` recipe, with triggers disabled during the data load).

## What the dump does not cover

- **Storage objects** — the About portrait today; essay images if
  [plan 03](plans/03-images-in-essays.md) ships. Only their metadata rows are
  in the dump. Revisit when the bucket holds more than one file.
- **Auth users** (Supabase-managed schema). One admin user; re-creating it is
  a dashboard task, documented in [auth.md](auth.md).

## The rest of the safety story

- The **JSON fidelity export** (human-triggered, re-importable, includes
  positions and pages) is [plan 05 Piece 2](plans/05-export-backup.md) — not
  built yet.
- The **`content/` markdown mirror** (readable-in-fifty-years copy, versioned
  in this repo's git) is [plan 09 Piece 3](plans/09-offline-and-notes.md) —
  not built yet.
