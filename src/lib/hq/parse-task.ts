// Reading a task out of a sentence (docs/plans/14-capture.md §6). Server-only —
// it holds the API-key path and must never be imported client-side.
//
// REUSES THE ADR-0007 PATTERN, deliberately and exactly: Claude Haiku 4.5,
// structured output, Zod-validated, human in the loop. Sentence in, validated
// fields out. It is the same shape as ✦ Suggest with AI, and the same rule
// applies — the model proposes, the person disposes.
//
// ⚠ NOT A DATE LIBRARY, AND THAT IS THE ARGUMENT FOR A MODEL AT ALL. `chrono`
// handles "tomorrow at 4:30pm" and falls over on "warn me three days in
// advance" and "every third Monday" — those are not date parsing, they are this
// system's own concepts. Separating a task's TITLE from its SCHEDULING WORDS is
// also precisely what a language model is good at and a regex is not.
//
// ⚠ THE OUTPUT SCHEMA IS THE SYSTEM'S OWN ENUMS, and that is what makes this
// safe rather than merely careful. `recurrence` is `z.enum(PRESETS)`, so the
// model CANNOT propose a schedule the database has no way to store — the
// failure mode where a parser invents "every three weeks" and something
// downstream rounds it to biweekly is closed by construction, not by review.
// The same goes for effort and priority.
//
// ⚠ AND IT NEVER GUESSES SILENTLY. Every field the model fills comes back with
// the words it read to fill it (`from`), so a wrong parse is visible in the
// sheet instead of surfacing three days late as a task that never appeared.
// §6.2: a silently misparsed date is worse than no parse at all.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'astro/zod';
import { EFFORTS, PRIORITIES } from './tasks';
import { PRESETS } from './recurrence';
import type { Ymd } from './time';

const EFFORT_KEYS = EFFORTS.map((e) => e.key) as [string, ...string[]];
const PRIORITY_KEYS = PRIORITIES.map((p) => p.key) as [string, ...string[]];
const PRESET_KEYS = PRESETS as unknown as [string, ...string[]];

/**
 * A field the model filled, plus the words it read to fill it.
 *
 * The `from` half is not decoration: it is the whole of how a wrong parse
 * becomes visible. "2026-08-07 — read from *Friday*" can be judged at a glance;
 * "2026-08-07" alone cannot be judged at all.
 */
const Read = <T extends z.ZodTypeAny>(value: T, what: string) =>
  z
    .object({
      value,
      from: z.string().describe(`The exact words in the input that gave you this ${what}. Quote them verbatim.`),
    })
    .nullable();

const Parsed = z.object({
  /*
    ⚠ THIS FIELD NARROWS A SETTLED DECISION, AND THAT IS DELIBERATE.
    10-hq §4.21 and §6 forbid a router that decides what a captured thought IS,
    because a router's failure is silent — a thought filed as the wrong kind
    disappears into the wrong room. That ban stands for task vs log-entry vs
    quote vs person, and nothing here touches it.

    Event vs task is the one pair it does not describe, for a reason that is
    structural rather than a matter of degree: **events and tasks share every
    surface.** Both render on the calendar grid, both appear on Today. A wrong
    guess is the wrong SHAPE somewhere you are already looking, not a
    disappearance — and it is shown to you before anything is written.

    And most of the call is not judgement at all. A repeat, a lead, or anything
    that wants answering for CANNOT be an event: the table has no recurrence
    column and no lead. So the model is applying a capability rule far more
    often than it is exercising taste.
  */
  kind: z
    .enum(['task', 'event'])
    .describe(
      'Which row this should be.\n' +
        'TASK if it repeats, asks to be warned in advance, or is something you would tick off when done — ' +
        'an event can do none of those.\n' +
        'EVENT if it is being somewhere at a time, especially with a named person: a dinner, a lunch, a party, a trip.\n' +
        'When it could honestly be either, choose task — it is the row that can do more, and it is the one that ' +
        'will ask you about itself if you never get to it.',
    ),
  // ⚠ NULLABLE, and it was not at first. Required, the model met a sentence
  // that is all schedule and no task ("6pm next Monday, warn me three days in
  // advance") by inventing the placeholder string "(no task name given)" —
  // which would have opened the sheet with those literal words in the title
  // field. A schema that forbids an empty answer does not get no answer; it
  // gets a fabricated one. Null here means "say nothing", and the caller falls
  // back to the sentence itself, so no words are ever lost.
  title: z
    .string()
    .nullable()
    .describe(
      'The task itself, as a short imperative with every scheduling word REMOVED. ' +
        '"call the dentist at 4:30 tomorrow" gives "call the dentist". Under ~60 characters. ' +
        'Return null if the sentence names no task at all — never invent a placeholder.',
    ),
  // ⚠ AND THIS ONE HAD TO SAY "not already in the title": given a sentence with
  // no scheduling in it, the model put the whole thing in BOTH fields, so the
  // sheet showed the same line twice.
  notes: z
    .string()
    .nullable()
    .describe(
      'Context worth keeping that is NOT already in the title and is not scheduling. ' +
        'Null when the title already carries the whole sentence — never repeat it here.',
    ),
  due_on: Read(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), 'date').describe(
    'The date it is due, as YYYY-MM-DD, resolved against TODAY given below. Null if the sentence names no day.',
  ),
  due_time: Read(z.string().regex(/^\d{2}:\d{2}$/), 'time').describe(
    'A 24-hour HH:MM clock time, only if one is actually stated. Null otherwise — do not invent 9am.',
  ),
  lead_days: Read(z.number().int().min(0).max(90), 'lead').describe(
    'Only when the sentence asks to be warned in advance ("remind me three days before") — the number of days. Null otherwise.',
  ),
  recurrence: Read(z.enum(PRESET_KEYS), 'repeat').describe(
    'Only if the sentence asks for a repeat AND one of these exactly fits: ' +
      'daily, weekly, biweekly (every two weeks), monthly-date (same date each month), ' +
      'monthly-nth (e.g. the third Monday of each month), weekdays (Mon–Fri). ' +
      'If the repeat it asks for is none of these — "every three weeks", "twice a year" — return null ' +
      'and say so in `unschedulable`. NEVER round to the nearest one.\n' +
      '⚠ If you return a recurrence you MUST also return `due_on`: the date of its FIRST occurrence from today ' +
      '("every Thursday" said on a Tuesday means this coming Thursday). A repeat with no date cannot be stored.',
  ),
  effort: Read(z.enum(EFFORT_KEYS), 'effort').describe(
    'How big the job is, ONLY if the sentence says so: quick (under 15 min), sitting (about an hour), ' +
      'block (half a day), project (several sessions). Null when it is not stated — do not infer from the topic.',
  ),
  priority: Read(z.enum(PRIORITY_KEYS), 'priority').describe(
    'low / normal / high, ONLY if the sentence says so ("urgent", "whenever"). Null otherwise.',
  ),
  unschedulable: z
    .string()
    .nullable()
    .describe(
      'If the sentence asks for a schedule this system cannot express, say what it asked for, in one short phrase. Null otherwise.',
    ),
  // ⚠ "next <weekday>" IS NAMED EXPLICITLY, because the general instruction did
  // not catch it. Asked twice in one session, the model read "next Monday" as
  // Aug 10 in one sentence and Aug 17 in another, and flagged neither — while
  // correctly flagging the vaguer "sometime next week". That phrase is §6.3's
  // own example of the thing this field exists for, so it is spelled out rather
  // than left to judgement.
  ambiguous: z
    .string()
    .nullable()
    .describe(
      'If a date phrase genuinely has more than one reading, name the ambiguity in one short phrase. ' +
        'ALWAYS flag "next <weekday>" — it means the coming one to some people and the one in the following week to others. ' +
        'Also flag vague spans like "sometime next week". Null when the phrase can only be read one way ("tomorrow", "the 14th").',
    ),
});

export type ParsedTask = z.infer<typeof Parsed>;

/**
 * ⚠ TODAY AND THE ZONE ARE PASSED IN, NEVER ASSUMED (§6.1). "4:30pm tomorrow"
 * is meaningless without both, and the model has no clock — left to itself it
 * will use whatever date its training suggests, confidently. `today` must come
 * from `localToday()` over the configured home zone, not from the server's.
 */
const SYSTEM = (today: Ymd, tz: string, weekday: string) =>
  `You turn one jotted sentence into the fields of a personal task manager.\n\n` +
  `TODAY IS ${weekday}, ${today}. The person's timezone is ${tz}. Resolve every relative date against that, ` +
  `and never return a date in the past — if a phrase like "Monday" has already gone by this week, it means the next one.\n\n` +
  `Fill ONLY what the sentence actually says. An empty field is correct and expected; a guessed one is a bug. ` +
  `In particular: do not invent a time, do not infer effort from the topic, and do not assume something is urgent.\n\n` +
  `For every field you do fill, quote the exact words you read it from. Those words are shown to the person so they can ` +
  `see how you read them, so quote the input verbatim rather than paraphrasing.`;

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NAMES_A_WEEKDAY = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/i;

/**
 * ⚠ A CONTRADICTION THE MODEL CANNOT BE TRUSTED TO NOTICE, checked in code
 * because it is checkable in code.
 *
 * `tasks` stores **one date column** (13 · Piece 1's third reading of §7), so a
 * weekly rule takes its weekday from `due_on` — there is nowhere else for it to
 * come from. That means *"team sync every Tuesday, but the first one is on the
 * 12th"* (a Wednesday) stores **every Wednesday**, silently, while the sentence
 * plainly said Tuesday.
 *
 * Asked to spot exactly this, the model caught it in one phrasing and missed it
 * in another — so it is not a prompt problem. It is arithmetic, and arithmetic
 * belongs here. The rule is kept rather than dropped (the date is the thing the
 * person was most explicit about) and the disagreement is SAID, in the words of
 * what will actually happen.
 */
export function weekdayDisagreement(
  recurrence: { value: string; from: string } | null,
  dueOn: { value: string; from: string } | null,
): string | null {
  if (!recurrence || !dueOn) return null;
  if (recurrence.value !== 'weekly' && recurrence.value !== 'biweekly') return null;
  const named = NAMES_A_WEEKDAY.exec(recurrence.from)?.[1]?.toLowerCase();
  if (!named) return null;
  const actual = WEEKDAY[new Date(`${dueOn.value}T00:00:00Z`).getUTCDay()];
  if (named === actual.toLowerCase()) return null;
  return `“${recurrence.from}”, but ${dueOn.value} is a ${actual} — it will repeat on ${actual}s`;
}

export interface ParseResult {
  parsed: ParsedTask;
  /** Derived, never asked for — see `whyKind`. */
  why: string;
  /** Round-trip milliseconds and token counts — the lab shows these; the piece does not. */
  meta: { ms: number; inputTokens: number; outputTokens: number };
}

export async function parseTask(
  text: string,
  today: Ymd,
  tz: string,
  apiKey: string,
  at: number,
): Promise<ParseResult> {
  const weekday = WEEKDAY[new Date(`${today}T00:00:00Z`).getUTCDay()];
  const client = new Anthropic({ apiKey });
  const message = await client.messages.parse({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    system: SYSTEM(today, tz, weekday),
    messages: [{ role: 'user', content: text }],
    output_config: { format: zodOutputFormat(Parsed) },
  });

  const parsed = message.parsed_output ?? {
    kind: 'task' as const,
    title: null,
    notes: null,
    due_on: null,
    due_time: null,
    lead_days: null,
    recurrence: null,
    effort: null,
    priority: null,
    unschedulable: null,
    ambiguous: null,
  };

  // ⚠ A DATE IN THE PAST IS DROPPED, NOT SHOWN. The prompt forbids it and the
  // schema cannot; a task due before today would sit in Past due from the
  // moment it was created, which is precisely the wall of arrears ADR-0013
  // exists to prevent. Dropping it leaves an undated task, which is a normal
  // and honest state.
  if (parsed.due_on && parsed.due_on.value < today) parsed.due_on = null;

  // The model's own ambiguity note wins when it made one; otherwise the
  // arithmetic above speaks. Never both — one warning is read, two are skipped.
  parsed.ambiguous ??= weekdayDisagreement(parsed.recurrence, parsed.due_on);

  // ⚠ THE KIND IS OVERRULED BY ITS OWN FIELDS, and this is not defensive
  // programming — it fired on the second run of real sentences. "team standup
  // every weekday at 9:15" came back as an EVENT carrying `recurrence:
  // weekdays`, which is a row the database cannot store: `events` has no
  // recurrence column and no lead. The model had picked a shape that could not
  // hold its own answer, and the repeat would have been dropped on the floor.
  //
  // Capability is arithmetic, so it is settled here rather than asked for.
  if (parsed.kind === 'event' && (parsed.recurrence || parsed.lead_days)) parsed.kind = 'task';

  // ⚠ A REPEAT WITH NO DATE IS NOT STORABLE, and left alone it disappears in
  // silence. `tasks` anchors a fixed rule to `due_on` (13 · Piece 1), so the
  // sheet clears the repeat the moment it finds no date — which is correct, and
  // which meant a parse of "every Thursday at 4pm" that happened to omit the
  // date dropped the whole recurrence with nothing on screen saying so.
  //
  // The prompt now demands an anchor; this is what happens when it does not
  // arrive anyway. Say it, rather than show a repeat that will not survive.
  if (parsed.recurrence && !parsed.due_on) {
    parsed.ambiguous ??= `“${parsed.recurrence.from}” needs a first date before it can repeat — pick one`;
    parsed.recurrence = null;
  }

  return {
    parsed,
    why: whyKind(parsed),
    meta: {
      ms: Date.now() - at,
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    },
  };
}

/**
 * Why it is a task or an event, **derived from the fields rather than asked
 * for** — and that is a correction, not a preference.
 *
 * The model used to return this line itself, and it fabricated. Given "renew
 * the passport before the end of the month" it answered `task` (right) and
 * explained *"it repeats annually and asks to be warned in advance"* — neither
 * of which is in the sentence, and neither of which it had put in the fields it
 * filled a moment earlier. Tightening the instruction did not fix it. A
 * fabricated reason attached to a correct answer is worse than no reason at
 * all, because this line is the thing being read to decide whether to trust
 * everything else.
 *
 * 10-hq §10i already had the rule, learned the same way: **derived summaries
 * beat written ones.** A hand-written "4 things · three sources" went stale the
 * moment the data changed; this one cannot, because it IS the data.
 */
export function whyKind(p: Pick<ParsedTask, 'kind' | 'recurrence' | 'lead_days' | 'due_time'>): string {
  if (p.kind === 'event') {
    return p.due_time ? 'somewhere to be, at a time — nothing to tick off' : 'somewhere to be — nothing to tick off';
  }
  if (p.recurrence) return 'it repeats, and an event cannot';
  if (p.lead_days) return 'it asks to be warned ahead, and an event cannot';
  return 'something to tick off when it is done';
}
