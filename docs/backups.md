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

- **Storage objects** — and this stopped being hypothetical on 2026-07-31, when
  [plan 03](plans/03-images-in-essays.md) shipped and essays could contain
  pictures. `pg_dump` captures the metadata rows in `storage.objects`, **not the
  bytes**. So an essay's prose is backed up nightly and its images are not: lose
  the Supabase project and every picture goes with it, leaving posts that
  reference files nobody has.
  **This is the one real hole in the safety story.** It was tolerable at one
  portrait. It stops being tolerable at whatever number of essay images makes
  you wince — the fix is a sync of the `site` bucket into the backups repo
  (`supabase storage cp -r`, or the S3-compatible endpoint), which is small and
  currently unbuilt.
- **Auth users** (Supabase-managed schema). One admin user; re-creating it is
  a dashboard task, documented in [auth.md](auth.md).

## The rest of the safety story

- The **JSON fidelity export** (human-triggered, re-importable, includes
  positions and pages) is [plan 05 Piece 2](plans/05-export-backup.md) — not
  built yet.
- The **`content/` markdown mirror** — a two-way copy of the corpus as files,
  with a `push` script to write them back — was **cancelled on 2026-07-31 and
  should not be re-proposed.** Two of its four justifications had shipped as
  separate work by then (backup here, revision history as plan 07's
  `fragment_versions`), a third contradicted the admin's whole purpose, and
  `push` would have been a second write path into the corpus alongside the
  actions. It also created a sync problem — two representations that can both
  change — which is the same shape as the offline problem
  [ADR 0010](adr/0010-online-first-writing.md) had just removed, and this repo
  being public made a mirror of drafts and notes an outright hazard.

  **What it would have closed, and the cheap way to close it:** `data.sql` holds
  the prose as SQL `INSERT` statements — recoverable, since it's a text file,
  but not readable as prose. If that ever matters, write a **one-way** export:
  published pieces to `.md`, no `push`, no entry ramp, no second write path. An
  afternoon, and no architecture.
