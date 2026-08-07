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

  ── FOUR RENDERERS, ONE EVENT, ONE PLACE THAT DECIDES ───────────────────────

  The sidebar pill, the burger pill, the window title and — since 21 · Phase 0 —
  the app icon all read the same number. They are updated here, together, from
  one listener — the same discipline `lib/hq/attention.ts` enforces on the
  server, spent on the browser.

  ⚠ THE BADGE IS THE ODD ONE OUT IN TWO WAYS, and both are handled at the foot
  of this file rather than by a second script. It has NO SERVER-RENDERED HALF,
  so unlike the other three it has to be painted on mount as well as on the
  event; and it is the ONE SURFACE READ WITHOUT OPENING ANYTHING, so it goes
  dark in two situations where the other three are still fine (see `paintBadge`).

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

/*
  ── THE NUMBER ON THE ICON (21 · Phase 0) ───────────────────────────────────

  `navigator.setAppBadge(n)` puts a numeral on the installed app's icon — the
  dock on macOS/Windows, the Home Screen on iOS. It runs only while this page
  runs, which is the whole shape of this phase: WHILE-RUNNING, not desktop-only.
  An installed app left running in the background keeps executing JS, so the
  numeral tracks the count live; a phone gets the same code and the same
  correction every time the app is opened, which is what keeps the icon honest
  between the pushes 21 · Phases 2–3 will add.

  ⚠ NOTHING HERE MAKES THE NUMBER TRUE WHILE THE APP IS CLOSED. That is a push
  stack and it is deliberately not in this phase. What this phase must therefore
  guarantee is that the icon is never CONFIDENTLY WRONG — see `paintBadge`.

  Guarded on presence and swallowing failures: the API is absent in plenty of
  browsers, and it can reject inside an installed app for reasons nothing here
  can act on. A workshop does not owe the console an error about a dock icon.
*/
function setBadge(total: number): void {
  if (!('setAppBadge' in navigator)) return;
  // ⚠ `setAppBadge(0)` IS the clear, per the Badging API — so zero needs no
  // special case here, and adding one would be a second way to say it.
  navigator.setAppBadge(total).catch(() => {
    // Nothing to do, and nothing worth saying.
  });
}

function clearBadge(): void {
  if (!('clearAppBadge' in navigator)) return;
  navigator.clearAppBadge().catch(() => {
    // As above.
  });
}

function mount(): void {
  const hq = document.getElementById('hq');
  const today = hq?.dataset.today;
  if (!hq || !today) return;

  // Seeded from the server's own answer rather than counted off the page: the
  // rooms show a filtered slice of the day, so anything derived from what is on
  // screen would be a different number on every route.
  const state = {
    // `data-count-*`, not `data-checkin` — the bare name belongs to the Morning
    // zone, and taking it here silently blanked that whole card. See AdminLayout.
    checkin: Number(hq.dataset.countCheckin ?? 0),
    tasks: Number(hq.dataset.countTasks ?? 0),
  };

  /** The number every surface renders. Halves clamped independently, so a
   *  stray undo cannot push one of them below zero and hide the other. */
  const count = (): number => Math.max(0, state.checkin) + Math.max(0, state.tasks);

  /**
   * ⚠ ONCE THE DAY HAS TURNED, THE ICON STAYS DARK — and this latch is why it
   * cannot come back. `day-turn.ts` says the served day is over; every number
   * on this page is now about yesterday. The three on-screen renderers keep
   * theirs, because "The day has turned" is sitting right above them and a
   * number with a caveat beside it is honest. The ICON has no room for a
   * caveat — it is read from a dock or a Home Screen with nothing around it —
   * so it says nothing instead, which is ADR-0014's whole argument.
   *
   * Without the latch this would undo itself: tick a row at 00:05 on the stale
   * page and `s.on === today` still holds (both are yesterday), so `render()`
   * would cheerfully repaint the icon with yesterday's count.
   */
  let turned = false;

  const paintBadge = (): void => setBadge(turned ? 0 : count());

  function render(): void {
    const total = count();

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

    paintBadge();
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

  // The day turning is `day-turn.ts`'s observation, not this file's — it owns
  // "what day is it" the way this one owns "what is the number". It reports the
  // fact; the decision about what that costs each renderer is made here, which
  // is the same split the two writers already get (see the header).
  document.addEventListener('hq:dayturn', () => {
    turned = true;
    paintBadge();
  });

  // ⚠ THE ICON CLEARS WHEN THE PAGE GOES AWAY, and the loser is worth naming
  // because it is the obvious build: LEAVING THE NUMBER THERE. A badge left
  // standing is wrong every single night — at 00:01 the true count is 1 (a new
  // check-in) and the icon still shows yesterday's — and it is wrong again the
  // moment anything is answered on another device. Being reliably ABSENT beats
  // being confidently WRONG, which is the argument ADR-0014 built `staleness()`
  // around, arriving on the one surface that has nowhere to print a caveat.
  //
  // The rival — `clearAppBadge()` never, and let push correct it — is not
  // available yet and is what 21 · Phases 2–3 are for. Until then the honest
  // scope of this feature is "correct while the app is running".
  //
  // ⚠ IT ALSO FIRES ON EVERY ADMIN NAVIGATION, because the Observatory has no
  // ClientRouter and each room is a real page load — so the numeral blinks off
  // and is repainted a moment later by the next page's `mount()`. Accepted
  // knowingly: the alternative is telling a close apart from a navigation,
  // which `pagehide` cannot do, and a brief blink is a smaller fault than a
  // stale number. If it reads badly on a real dock, that is a Phase 5 finding.
  window.addEventListener('pagehide', clearBadge);

  // The badge has no server-rendered half — the pills and the title arrive
  // correct in the HTML and this file only has to keep them so. The icon starts
  // at whatever the last page left on it, so the first paint is here.
  paintBadge();
}

mount();
