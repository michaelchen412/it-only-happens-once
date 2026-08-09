# It Only Happens Once

A personal site built around one idea: **everything shareable is a fragment** —
an essay, a quote, a song — and fragments are gathered into **constellations**,
which are ways of seeing rather than topics. The result is meant to be walked
rather than scrolled.

It is one Astro application with three surfaces:

- **The public site** — the Sky (constellation overview and typeset suites), the
  blog (writing, quotes and music, with search and subject filters), and About.
- **The Workshop** — where the corpus is written and groomed: the fragment
  manager, the composer, draft versions, constellations, the Library.
- **HQ** — a private daily dashboard: the morning check-in, people, the agenda,
  notes. It is a second domain rather than a feature of the first; nothing in it
  ever becomes public content.

Single author, single admin. Astro (SSR on Vercel) · Supabase (Postgres + Auth +
Storage) · Tailwind and daisyUI · TypeScript throughout.

## Running it

```sh
npm install
npm run dev        # astro dev
npm run verify     # format:check + lint + astro check + test  (~22s)
```

`verify` is the gate, and literally one: `npm run build` runs it first, and
Vercel's build command is `npm run build` — so a failing check fails the build
and the last good deployment keeps serving. A pre-commit hook formats and lints
staged files. It needs a `.env` with the Supabase project keys; the full list of
environment variables is in [`docs/auth.md`](docs/auth.md) §6.

## The documentation

**[`docs/`](docs/) is the real front door** — start at
[`docs/README.md`](docs/README.md), which says what to read in what order.

| | |
|---|---|
| How it is assembled and rendered | [`docs/architecture.md`](docs/architecture.md) |
| The schema, and how the domain maps to it | [`docs/data-model.md`](docs/data-model.md) |
| Auth, RLS, secrets | [`docs/auth.md`](docs/auth.md) |
| Every private surface | [`docs/admin.md`](docs/admin.md) |
| Search and match-highlighting | [`docs/search.md`](docs/search.md) |
| What protects the corpus | [`docs/backups.md`](docs/backups.md) |
| Why each major choice was made | [`docs/adr/`](docs/adr/) |

Those files describe the app **as it stands**; the reasoning behind a decision
lives in an ADR. Nothing about the build is duplicated here, deliberately — a
second copy is a copy that goes stale, which is the fault this file was rewritten
to stop repeating.

A few documents are referenced from `docs/` and are **not in this repository**
(`vision.md`, `design.md`, `about-michael.md`). They are personal working files
and are git-ignored on purpose.
