# 0007 — AI-assisted subject tagging

Status: Accepted
Date: 2026-07-20

## Context

Subjects (`subjects` + `fragment_subjects`) are the *aboutness* tags on every fragment. Assigning them by hand is exactly the kind of low-joy taxonomy chore Michael wants to spend as little time on as possible — but it still wants a human's judgment, because over-tagging and near-duplicate subjects rot the vocabulary.

So the goal: a model reads a fragment, proposes which **existing** subjects apply (and, rarely, a genuinely new one), and the human accepts/edits. The task is **bounded classification against a fixed ~21-label taxonomy with definitions**, not open reasoning. Two things actually matter: **guaranteed schema conformance** (we need "0–3 names from the real set", not free text) and **data privacy** — the inputs are Michael's personal quotes and reflections.

## Decision

A **"✦ Suggest with AI"** button in each editor's subject field, backed by a server-only Astro Action (`fragments.suggestSubjects`) that calls **Claude Haiku 4.5** ([`src/lib/suggest-subjects.ts`](../../src/lib/suggest-subjects.ts)).

- **Model: Claude Haiku 4.5.** Cheapest/fastest tier that supports structured outputs; the task needs no deeper reasoning. ≈ **$0.0015 per call** (~$0.50 to tag the whole back-catalogue).
- **Structured output** via the Anthropic SDK's `messages.parse` + `zodOutputFormat` (`output_config.format`). A `z.enum` of the current subject names pins existing picks to the real taxonomy; the proposed-new slot is nullable. Schema conformance is guaranteed, not hoped for. (The ~3 cap is enforced by prompt **and** `.slice(0,3)` — JSON Schema can't express `maxItems`.)
- **Taxonomy is read live from the DB** (`subjects.name`/`definition`) per call — so edited definitions and accepted new subjects immediately feed back in ([ADR 0008](0008-provenance-and-facets.md) sibling: the DB is the runtime source of truth; `scripts/reflections-subjects.json` is only the seed).
- **Human in the loop.** Suggestions pre-fill the tag input as ordinary editable chips. A *proposed new subject* is a distinct "Add it" affordance that must be **explicitly accepted** — it only becomes real via `syncSubjects` at save time.
- **Server-only key.** `ANTHROPIC_API_KEY` never reaches the client. Absent key → the button degrades to an inline "not configured" message; manual tagging is unaffected.

## Consequences

- **Privacy fits personal writing.** Anthropic does not train on API inputs by default — the deciding factor over the free tiers (below).
- **Reliable shape.** Constrained decoding means we never parse-and-pray; the action returns a validated `{ existing: string[], proposed | null }`.
- **Closed loop, no drift.** Reading the taxonomy from the DB means the classifier always sees the current vocabulary, including subjects it or the user just added.
- **A new dependency + secret.** `@anthropic-ai/sdk` and `ANTHROPIC_API_KEY`. Bounded: read-only, single-admin, no batch by default.
- **Cost is a rounding error** but non-zero. Acceptable given the volume; a bulk re-tag would be a deliberate one-off, not automatic.

## Alternatives

- **A genuinely free API.** Researched (2026). Rejected for this use: the easy free tiers — **Google Gemini** and **Mistral** free plans — *train on free-tier inputs*, which is disqualifying for personal writing. **Groq `gpt-oss-120b`** is the one clean free option (doesn't train, zero-retention, constrained decoding) and is kept as the fallback if a $0 line item ever becomes a hard requirement — but for pennies of savings it adds a second provider, rate-limit juggling, and an OpenAI-compat shim. Not worth it while the paid cost is ~$0.50 total.
- **A larger model (Sonnet/Opus).** Rejected as default — overkill for fixed-label classification. Escalate only if evals show Haiku systematically over-tags.
- **Best-effort JSON + validate/retry** (no constrained decoding). Rejected — strict structured output removes an entire failure class.
- **Auto-apply suggestions.** Rejected — the whole point is human judgment over the vocabulary; a proposed *new* subject especially must be a deliberate accept.
- **Store the taxonomy in a file only.** Rejected — see [ADR 0008]; definitions live in the DB so the loop closes.
