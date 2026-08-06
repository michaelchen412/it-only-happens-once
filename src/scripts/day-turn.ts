/*
  day-turn — the Observatory notices that it is tomorrow (20 · Piece 6).

  ⚠ THIS IS A PREREQUISITE FOR THE BADGE, NOT AN EXTRA. Leave the Observatory
  open overnight and every number on it is yesterday's: the date bar still says
  yesterday, yesterday's answered check-in still reads *done*, today's is not on
  the page at all — and a count in the sidebar and the window title inherits all
  of it and puts it somewhere you will believe. This is the same fault plan 15 is
  named for — *state baked into the HTML and never revisited* — arriving on the
  one surface where being wrong is worst, at the hour nobody is watching.

  ── It SAYS SO. It does not fix it. ─────────────────────────────────────────

  ADR-0014 set this precedent and `staleness()` already lives by it: say nothing
  while things are right, speak plainly when they are not. So a line appears with
  a real link, and that is all.

  ⚠ NEVER AN AUTO-RELOAD, and the loser is worth naming because it is the
  obvious build. `location.reload()` at midnight would discard an in-progress
  check-in, a half-written dump, or an open sheet — silently, unwitnessed, at
  exactly the hour the person who typed it has gone to bed. A workshop that
  throws away your work to correct its own clock has made the wrong trade twice
  over: the stale number was cosmetic, and the lost paragraph was not.

  ── Two triggers, and BOTH are needed ───────────────────────────────────────

  1. A timer to the next midnight. Catches the tab left open on a machine that
     stays awake.
  2. `visibilitychange`. Catches the laptop that SLEPT THROUGH midnight, where
     the timer never fired — or fired late and wrong, because a suspended timer
     resumes on the far side of the boundary it was waiting for. This is the
     COMMON case, and a timer alone misses it every time.

  ⚠ MIDNIGHT IS THE CONFIGURED ZONE'S, NEVER THE DEVICE'S. `settings.home_timezone`
  decides every day boundary in HQ (data-model.md §6b), which is why the day
  arrives here as a `data-` attribute the server rendered rather than as anything
  this file works out. It has been `America/New_York` since 2026-08-05 and now
  agrees with the device — so the symptom that would have made a mistake here
  obvious is GONE, which makes the rule matter more rather than less. The two
  zones agreeing is a fact about where Michael lives, not a property of the code,
  and the next trip is the test.

  `new Date().getDate()` is therefore wrong in this file by construction, and so
  is any comparison of local clock parts. The only question asked is *does the
  configured zone still call it the day the server did*, and `localToday` is the
  one function that answers it.
*/
import { localToday, shiftYmd, zonedTimeToUtc } from '../lib/hq/time';

/** The longest a `setTimeout` can be trusted to mean anything (~24.8 days is
 *  the real ceiling; this is a sanity clamp, not a limit we ever reach). */
const MAX_DELAY = 6 * 60 * 60 * 1000;

function mount(): void {
  // `#hq` is where the layout parks the server's answer about *now* — the day,
  // the zone and the count — so this file and `attention.ts` read one source
  // rather than two elements that could be rendered from different values.
  const hq = document.getElementById('hq');
  const el = document.getElementById('day-turn');
  const served = hq?.dataset.today;
  const tz = hq?.dataset.tz;
  if (!el || !served || !tz) return;

  let timer: ReturnType<typeof setTimeout> | undefined;

  const turned = (): boolean => localToday(tz) !== served;

  /** Until the next midnight IN `tz` — through `zonedTimeToUtc`, so the night
   *  the clocks change is an hour longer or shorter and this still lands on the
   *  boundary rather than an hour off it. A second of slack so the timer fires
   *  just after the turn rather than racing it. */
  const untilMidnight = (): number => {
    const next = zonedTimeToUtc(shiftYmd(localToday(tz), 1), '00:00', tz);
    return Math.min(Math.max(next.getTime() - Date.now() + 1000, 1000), MAX_DELAY);
  };

  const check = (): void => {
    if (!turned()) {
      // Re-arm rather than assume: the clamp above means one timer does not
      // always reach midnight, and a machine that slept has a stale idea of
      // when the next one is.
      clearTimeout(timer);
      timer = setTimeout(check, untilMidnight());
      return;
    }
    clearTimeout(timer);
    el.hidden = false;
    // Once it has turned there is nothing further to watch for — the notice is
    // already the strongest thing this file is allowed to say, and it stays
    // until the reader acts on it.
    document.removeEventListener('visibilitychange', onVisible);
  };

  function onVisible(): void {
    if (document.visibilityState === 'visible') check();
  }

  document.addEventListener('visibilitychange', onVisible);
  check();
}

mount();
