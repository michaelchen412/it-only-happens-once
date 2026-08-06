/*
  attention — the count moves when you answer (20 · Piece 7).

  ⚠ WHY THIS IS NOT OPTIONAL POLISH. If the badge does not decrement the moment
  you tick something, you will stop trusting it inside a week — and an untrusted
  badge is worse than no badge, because it costs a glance every time and repays
  nothing. A number that is right on arrival and wrong ten seconds later is a
  number you learn to ignore, which is the exact fate `progressLabel()` refuses
  for `0 of 3 done`.

  MOST OF THIS IS FREE ALREADY. The pills and the title are server-rendered on
  every navigation and the Observatory has no ClientRouter, so every admin
  navigation is a real page load and the count self-corrects. Only what happens
  WITHIN one page needs help, and there are exactly two writes that change it —
  the tick (`task-list.ts`, on Today and in the Agenda room) and answering or
  skipping the check-in (`checkin.ts`).

  ── THREE RENDERERS, ONE EVENT, ONE PLACE THAT DECIDES ──────────────────────

  The sidebar pill, the burger pill and the window title all read the same
  number. They are updated here, together, from one listener — the same
  discipline `lib/hq/attention.ts` enforces on the server, spent on the browser.

  ⚠ AND THE DECIDING HAPPENS HERE, NOT IN THE WRITERS. The two dispatchers say
  only what they did — *a task belonging to this date is now answered* — and
  this file decides whether that counts. That split is the whole point: "does
  this change the badge?" is one question with one answer, and putting it in the
  writers would make it two questions that will eventually disagree. It is also
  what keeps the rule below in a single place.

  ⚠ THE BADGE MUST NOT FOLLOW THE DATE BAR. Today is navigable to any date via
  `?date=`, and the badge always means TODAY. Stepping back to backfill last
  Tuesday's check-in must not clear a signal about this morning, and must not let
  that backfill decrement it — and `checkin.ts` posts whatever `logDate` the page
  is showing, so without the comparison below it would do exactly that. Same
  distinction `admin/index.astro` draws for the whole page: *only the check-in
  follows the date bar.* Ticking a PAST DUE row is the same trap wearing other
  clothes: it is answered, it leaves the arrears list, and the badge — which
  never counted it — must not move.
*/
import { attentionLabel, titlePrefix } from '../lib/hq/attention';

/** What a writer reports. Never a count, and never a verdict — just the fact. */
export interface AttentionSignal {
  kind: 'task' | 'checkin';
  /** The day the thing that changed BELONGS TO — an occurrence date, or the
   *  check-in's `log_date`. `null` for an undated task, which never counts. */
  on: string | null;
  /** Is it answered for now? `false` is an undo, or an unskip. */
  answered: boolean;
}

/** Fire one of these after a write lands. Typed and exported so the two callers
 *  cannot drift from the shape this file reads. */
export function signalAttention(detail: AttentionSignal): void {
  document.dispatchEvent(new CustomEvent<AttentionSignal>('hq:attention', { detail }));
}

function mount(): void {
  const hq = document.getElementById('hq');
  const today = hq?.dataset.today;
  if (!hq || !today) return;

  // Seeded from the server's own answer rather than counted off the page: the
  // rooms show a filtered slice of the day, so anything derived from what is on
  // screen would be a different number on every route.
  const state = {
    checkin: Number(hq.dataset.checkin ?? 0),
    tasks: Number(hq.dataset.tasks ?? 0),
  };

  function render(): void {
    const total = Math.max(0, state.checkin) + Math.max(0, state.tasks);

    document.querySelectorAll<HTMLElement>('[data-attention-pill]').forEach((pill) => {
      pill.textContent = total > 0 ? String(total) : '';
      pill.hidden = total === 0;
    });

    // The accessible name says what the number counts; the pill itself is
    // `aria-hidden`. Kept in step with the pill here for the same reason it is
    // set in the layout — a reader must never be handed a bare numeral.
    document.getElementById('nav-today')?.setAttribute('aria-label', attentionLabel(total));
    document
      .getElementById('sb-open')
      ?.setAttribute('aria-label', total > 0 ? `Open menu, ${total} waiting` : 'Open menu');

    // ⚠ STRIP BEFORE PREFIXING, or the prefixes stack: `(1) (2) Today — …`
    // after two ticks. The room's own title is whatever is left.
    document.title = titlePrefix(total) + document.title.replace(/^\(\d+\) /, '');
  }

  document.addEventListener('hq:attention', (e) => {
    const s = (e as CustomEvent<AttentionSignal>).detail;
    if (!s || s.on !== today) return; // see the header: never the date bar

    if (s.kind === 'checkin') {
      state.checkin = s.answered ? 0 : 1;
    } else {
      // Clamped, because a page can hold a tickable row the badge never counted
      // — a task answered earlier today still sits there struck through, and its
      // undo is a legitimate `+1` from a state this page never saw as `0`.
      state.tasks = Math.max(0, state.tasks + (s.answered ? -1 : 1));
    }
    render();
  });
}

mount();
