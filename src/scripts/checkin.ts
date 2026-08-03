// Client logic for the Morning zone (components/admin/CheckinZone.astro).
//
// THE DOM IS THE STATE. Every value is read back off the controls that display
// it — `aria-pressed` on an option, `--on` on a star, the input's own value —
// rather than being mirrored into a JavaScript object beside them. A second
// copy of the answers is a second thing that can be wrong, and the one that
// would be wrong is the one nobody is looking at.
//
// TWO SAVE SPEEDS, on purpose:
//   · a TAP saves immediately. It is one discrete decision, it is the common
//     case, and debouncing it only creates a window in which a phone locking
//     itself loses the answer.
//   · TYPING debounces, and flushes on blur. Otherwise every keystroke in the
//     dream field is a round trip.
//
// AND FAILURE IS LOUD. The footer says "Saves as you go", which is a promise —
// so when a save fails it says so and stays saying so. The expensive lesson of
// this codebase is an offline outbox that reported success it did not have; a
// check-in that silently drops the worst morning of the month would be the same
// mistake in a place that matters more.
import { actions } from 'astro:actions';

const zone = document.querySelector<HTMLElement>('[data-checkin]');

if (zone) {
  const logDate = zone.dataset.logDate!;
  const writable = zone.dataset.writable === 'true';
  const $ = <T extends HTMLElement>(sel: string) => zone.querySelector<T>(sel);
  const $$ = <T extends HTMLElement>(sel: string) => Array.from(zone.querySelectorAll<T>(sel));

  const savedEl = $<HTMLElement>('[data-saved]');
  const derivedEl = $<HTMLElement>('[data-derived]');

  // ── panels ──────────────────────────────────────────────────────────────
  function show(panel: string) {
    $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== panel));
    const edit = $<HTMLElement>('[data-edit]');
    if (edit) edit.hidden = panel !== 'done';
  }
  show(zone.dataset.panelInitial!);

  $('[data-go="fill"]')?.addEventListener('click', () => show('fill'));
  $('[data-edit]')?.addEventListener('click', () => show('fill'));

  if (!writable) {
    // Nothing below this point can run: there is no form to run it against.
    // A date outside the backfill window is readable and not editable, and the
    // action refuses the write too, so the two agree by construction.
  } else {
    // ── reading the form ──────────────────────────────────────────────────
    const pressed = (attr: string): string | null =>
      $$(`[data-${attr}]`).find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset[attr] ?? null;
    const stars = (field: string): number | null => {
      const on = $$(`[data-star="${field}"].st--on`);
      return on.length ? Math.max(...on.map((el) => Number(el.dataset.v))) : null;
    };
    const track = (field: string): number | null => {
      const on = $<HTMLElement>(`[data-tb="${field}"].tb--on`);
      return on ? Number(on.dataset.v) : null;
    };
    const text = (field: string): string | null => $<HTMLTextAreaElement>(`[data-field="${field}"]`)?.value.trim() || null;
    const time = (field: string): string | null => $<HTMLInputElement>(`[data-field="${field}"]`)?.value || null;

    const collect = () => ({
      logDate,
      bed: time('bed'),
      woke: time('woke'),
      sleepLatency: pressed('lat') as never,
      awakenings: pressed('wake') as never,
      sleepQuality: stars('sleep_quality'),
      restedness: stars('restedness'),
      valence: track('valence'),
      arousal: track('arousal'),
      dreamRecall: pressed('dream') as never,
      dreamIntensity: track('dream_intensity'),
      dreamBody: text('dream_body'),
      note: text('note'),
    });

    // ── saving ────────────────────────────────────────────────────────────
    // A single in-flight save with a dirty flag, rather than a queue: the
    // payload is the WHOLE form every time, so a superseded request carries
    // nothing the next one will not.
    let timer: number | undefined;
    let inFlight = false;
    let dirty = false;

    function note(msg: string, bad = false) {
      if (!savedEl) return;
      savedEl.textContent = msg;
      savedEl.classList.toggle('text-error', bad);
    }

    async function flush() {
      if (inFlight) {
        dirty = true;
        return;
      }
      inFlight = true;
      try {
        // A LOOP, not a recursive call. Re-entering `flush()` to pick up a
        // change made mid-request would find `inFlight` still true — the flag
        // is only cleared in the `finally` below — so the change would be
        // marked dirty and then never sent. `collect()` re-reads the DOM each
        // pass, so the last iteration always carries the latest answers.
        do {
          dirty = false;
          note('Saving…');
          const { error } = await actions.checkin.save(collect());
          if (error) {
            // Deliberately not retried on a loop and deliberately not cleared:
            // the words on screen must not outlive their truth.
            note(error.message || 'Not saved — check your connection', true);
            return;
          }
        } while (dirty);
        note('Saved');
      } catch {
        // ⚠ `astro:actions` THROWS on a dead network rather than returning
        // `{ error }` — the same trap that once left the AI button stuck on
        // "Thinking…" for the life of the page (subject-suggest.ts). Here it
        // was worse than a stuck label: without this catch the rejection also
        // skipped `inFlight = false`, so the flag stayed true and EVERY
        // subsequent save was silently swallowed as a duplicate. A check-in
        // that quietly stops saving is the exact failure this feature cannot
        // have. Caught by `checkin.spec.ts`, on its first ever run.
        note('Not saved — check your connection', true);
      } finally {
        inFlight = false;
      }
    }

    /** A tap: save now. */
    const now = () => {
      clearTimeout(timer);
      void flush();
    };
    /** Typing: settle first. */
    const soon = () => {
      note('Saving…');
      clearTimeout(timer);
      timer = window.setTimeout(flush, 800);
    };

    // ── the live payback ──────────────────────────────────────────────────
    // Recomputed from the same helper the server renders the summary with, so
    // the line cannot disagree with the card it turns into.
    const LAT = { under_15: 8, '15_30': 22, '30_60': 45, over_60: 75 } as Record<string, number>;
    const WAKE = { none: 0, few: 12, many: 30 } as Record<string, number>;
    function hm(mins: number) {
      const h = Math.floor(mins / 60);
      return h ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
    }
    function recompute() {
      if (!derivedEl) return;
      const bed = time('bed');
      const woke = time('woke');
      if (!bed || !woke) {
        derivedEl.textContent = '';
        return;
      }
      const [bh, bm] = bed.split(':').map(Number);
      const [wh, wm] = woke.split(':').map(Number);
      let inBed = wh * 60 + wm - (bh * 60 + bm);
      if (inBed <= 0) inBed += 1440; // crossed midnight — the normal case
      const parts = [`${hm(inBed)} in bed`];
      const lat = LAT[pressed('lat') ?? ''];
      const wake = WAKE[pressed('wake') ?? ''];
      if (lat !== undefined && wake !== undefined) {
        const asleep = Math.max(0, inBed - lat - wake);
        parts.push(`≈${hm(asleep)} asleep`, `${Math.round((asleep / inBed) * 100)}%`);
      }
      derivedEl.textContent = parts.join(' · ');
    }

    // ── the words beside the marks ────────────────────────────────────────
    const WORDS: Record<string, string[]> = {
      sleep_quality: ['terrible', 'poor', 'ok', 'good', 'great'],
      restedness: ['wrung out', 'tired', 'ok', 'rested', 'sharp'],
      valence: ['bleak', 'low', 'even', 'good', 'bright'],
      arousal: ['sleepy', 'calm', 'steady', 'restless', 'wired'],
      dream_intensity: ['faint', 'mild', 'vivid', 'strong', 'consuming'],
    };
    function setWord(field: string, value: number) {
      const el = $<HTMLElement>(`[data-w-for="${field}"]`);
      if (el) el.textContent = WORDS[field]?.[value - 1] ?? '';
    }

    // ── wiring ────────────────────────────────────────────────────────────
    /** A single-select group of `.opt` buttons. Re-tapping clears it. */
    function group(attr: string, after?: (value: string | null) => void) {
      $$<HTMLButtonElement>(`[data-${attr}]`).forEach((btn) =>
        btn.addEventListener('click', () => {
          const wasOn = btn.getAttribute('aria-pressed') === 'true';
          $$(`[data-${attr}]`).forEach((o) => o.setAttribute('aria-pressed', String(o === btn && !wasOn)));
          after?.(wasOn ? null : (btn.dataset[attr] ?? null));
          recompute();
          now();
        }),
      );
    }

    group('dream', (value) => {
      // Intensity and the text only exist once there is a dream, which is the
      // same rule the table's CHECK enforces. Clearing them here means a change
      // of mind cannot leave orphan data behind.
      const more = $<HTMLElement>('[data-dream-more]');
      const hasDream = value !== null && value !== 'none';
      if (more) more.hidden = !hasDream;
      if (!hasDream) {
        $$('[data-tb="dream_intensity"]').forEach((el) => el.classList.remove('tb--on'));
        setWord('dream_intensity', 0);
        const ta = $<HTMLTextAreaElement>('[data-field="dream_body"]');
        if (ta) ta.value = '';
      }
    });
    group('lat');
    group('wake');

    $$<HTMLButtonElement>('[data-star]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const field = btn.dataset.star!;
        const v = Number(btn.dataset.v);
        $$(`[data-star="${field}"]`).forEach((o) => o.classList.toggle('st--on', Number(o.dataset.v) <= v));
        setWord(field, v);
        now();
      }),
    );

    $$<HTMLButtonElement>('[data-tb]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const field = btn.dataset.tb!;
        const v = Number(btn.dataset.v);
        $$(`[data-tb="${field}"]`).forEach((o) => o.classList.toggle('tb--on', o === btn));
        setWord(field, v);
        now();
      }),
    );

    $$<HTMLInputElement>('input[type="time"]').forEach((input) =>
      input.addEventListener('input', () => {
        const hint = $<HTMLElement>('[data-prefill]');
        if (hint) hint.hidden = true; // it is your time now, not a suggestion
        recompute();
        soon();
      }),
    );

    $$<HTMLButtonElement>('[data-reveal]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const ta = $<HTMLTextAreaElement>(`[data-field="${btn.dataset.reveal}"]`);
        if (!ta) return;
        ta.hidden = false;
        btn.hidden = true;
        ta.focus();
      }),
    );

    $$<HTMLTextAreaElement>('textarea[data-field]').forEach((ta) => {
      ta.addEventListener('input', soon);
      ta.addEventListener('blur', now);
    });

    // ── leaving ───────────────────────────────────────────────────────────
    // "Done" is not a submit: everything is already saved. It flushes anything
    // still pending and then reloads, so the summary that replaces the form is
    // rendered from the ROW rather than from the browser's idea of it.
    $('[data-done]')?.addEventListener('click', async () => {
      clearTimeout(timer);
      await flush();
      location.reload();
    });

    const setSkipped = async (skipped: boolean) => {
      const { error } = await actions.checkin.setSkipped({ logDate, skipped });
      if (error) {
        note(error.message || 'Not saved', true);
        return;
      }
      location.reload();
    };
    $$<HTMLButtonElement>('[data-skip]').forEach((b) => b.addEventListener('click', () => setSkipped(true)));
    $('[data-unskip]')?.addEventListener('click', () => setSkipped(false));

    // The last line of defence for the debounced text fields: a phone locking
    // itself mid-sentence should not lose it. `beforeunload` is not a promise
    // the browser keeps, which is why the debounce is short and taps do not use
    // one at all — this is a backstop, not the mechanism.
    window.addEventListener('pagehide', () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        void flush();
      }
    });
  }
}
