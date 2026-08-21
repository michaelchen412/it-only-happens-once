// Client logic for the Morning zone (components/admin/CheckinZone.astro).
//
// THE DOM IS THE STATE. Every value is read back off the controls that display
// it — `aria-pressed` on an option, `--on` on a star, the input's own value —
// rather than being mirrored into a JavaScript object beside them. A second
// copy of the answers is a second thing that can be wrong, and the one that
// would be wrong is the one nobody is looking at.
//
// THAT HELD WHEN THE CARD GREW REPEATERS (2026-08-06). A list of timed wakings
// is exactly the shape that tempts a `let wakings = []` beside the markup —
// and then a row removed from the array while its inputs are still on screen.
// `collect()` walks the rows instead, so "what is on screen" and "what gets
// saved" cannot come apart, and removing a row is a `remove()` and nothing else.
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
// ⚠ THE ARITHMETIC AND THE WORDS ARE IMPORTED, NOT RE-DECLARED. This file used
// to keep its own `LAT`, `WAKE`, `WORDS` and `hm` beside the module's, which
// made the header of `lib/hq/checkin.ts` ("one implementation, three readers")
// aspirational rather than true — two copies of "how long were you in bed",
// and the one that would drift is the one on screen at 7am. The module is
// type-only in its imports, so it costs the bundle nothing but the functions.
import { actions } from 'astro:actions';
import { callAction, formatActionError } from './action-error';
// Static, for the reason task-sheet.ts states at its own copy of this import.
import { mountMiniEditor, type RichEditorHandle } from './rich-editor';
import { signalAttention } from './attention';
import {
  OPEN_ENDED_LATENCY,
  TIMEABLE_WAKINGS,
  derive,
  deriveLine,
  wordFor,
  type Awakenings,
  type DreamTone,
  type MarkField,
  type SleepLatency,
} from '../lib/hq/checkin';

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
    /** Every pressed member of a MULTI-select group, in the order rendered. */
    const pressedAll = (attr: string): string[] =>
      $$(`[data-${attr}]`)
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.dataset[attr]!)
        .filter(Boolean);
    const stars = (field: string): number | null => {
      const on = $$(`[data-star="${field}"].st--on`);
      return on.length ? Math.max(...on.map((el) => Number(el.dataset.v))) : null;
    };
    const track = (field: string): number | null => {
      const on = $<HTMLElement>(`[data-tb="${field}"].tb--on`);
      return on ? Number(on.dataset.v) : null;
    };
    /**
     * The two prose fields are mini editors (plan 43); every other `data-field`
     * is still a native control. Keyed by field name so `text()` below stays the
     * one way the form is read — a second reader for two of fourteen values is
     * how a payload starts disagreeing with the screen.
     *
     * `breaks: false` MATCHES `DonePanel`, which renders both with a bare
     * `renderMarkdown(…)`. Mounted at `true` the editor would show a line break
     * the summary card then closed up.
     *
     * ⚠ `onChange` AND `focusout` ARE THE AUTOSAVE, and both have to be attached
     * here. The old wiring hung `input`/`blur` on `textarea[data-field]` further
     * down; a contenteditable fires no `input` this form can hear, so without
     * these two a dream typed at 6am would have been debounced by nothing and
     * saved by nothing. `soon`/`now` are declared below and only ever called
     * from inside these closures, so the forward reference is fine.
     *
     * ⚠ `proseFields`, NOT `prose` — `syncDreamPanels` below already has a local
     * `prose` for the `[data-dream-prose]` block, and the shorter name shadowed
     * it there, turning `prose.get(…)` into a call on an HTMLElement. Caught by
     * `astro check`; named apart so it cannot come back.
     */
    const proseFields = new Map<string, RichEditorHandle>();
    for (const [field, id, placeholder, label] of [
      ['dream_body', 'ci-dream-body', 'What you remember.', 'What you remember'],
      ['note', 'ci-note', 'Anything at all.', 'A line about today'],
    ] as const) {
      const host = $<HTMLElement>(`[data-field="${field}"]`);
      const el = document.getElementById(id);
      const wrap = document.getElementById(`${id}-wrap`);
      if (!host || !el || !wrap) continue;
      const handle = mountMiniEditor({
        editorEl: el,
        toolbarRoot: wrap,
        placeholder,
        ariaLabel: label,
        docClass: 'f-prose',
        breaks: false,
        onChange: () => soon(),
      });
      // `emitUpdate: false` — seeding is not typing, and `soon()` would put
      // "Saving…" on screen and write the row back on every page load.
      handle.editor.commands.setContent(host.querySelector<HTMLInputElement>('[data-seed]')?.value ?? '', {
        emitUpdate: false,
      });
      // ⚠ FOCUS MOVING *INSIDE* THE FIELD IS NOT LEAVING IT. The toolbar is part
      // of this widget, so pressing B blurs the editable — and a bare `focusout`
      // turned every formatting click into an immediate flush, defeating the
      // 800ms debounce that "typing debounces instead of saving every keystroke"
      // exists to protect. A textarea had no controls inside it and so never
      // posed the question. `relatedTarget` is what gains focus; null means
      // focus left the document entirely, which IS a reason to save now.
      el.addEventListener('focusout', (e) => {
        const to = (e as FocusEvent).relatedTarget as Node | null;
        if (to && host.contains(to)) return;
        now();
      });
      proseFields.set(field, handle);
    }

    const text = (field: string): string | null =>
      proseFields.has(field)
        ? proseFields.get(field)!.getMarkdown().trim() || null
        : $<HTMLTextAreaElement>(`[data-field="${field}"]`)?.value.trim() || null;
    const time = (field: string): string | null => $<HTMLInputElement>(`[data-field="${field}"]`)?.value || null;
    /** A time picker inside one repeater row — scoped, so rows cannot read each other. */
    const rowTime = (row: HTMLElement, name: string): string | null =>
      row.querySelector<HTMLInputElement>(`[data-t="${name}"]`)?.value || null;
    const isOn = (el: Element | null): boolean => el?.getAttribute('aria-pressed') === 'true';

    /** The tones that are pressed, each with everything under it. */
    const dreams = () =>
      (pressedAll('dream').filter((k) => k !== 'none') as DreamTone[]).map((tone) => {
        const more = $<HTMLElement>(`[data-dream-more="${tone}"]`);
        return {
          tone,
          intensity: track(`intensity_${tone}`),
          wokeYou: isOn(more?.querySelector('[data-flag="wokeYou"]') ?? null),
          recurring: isOn(more?.querySelector('[data-flag="recurring"]') ?? null),
        };
      });

    const wakings = () =>
      $$('[data-waking]').map((r) => ({
        woke: rowTime(r, 'woke'),
        backAsleep: rowTime(r, 'backAsleep'),
        leftBed: isOn(r.querySelector('[data-left-bed]')),
      }));

    const naps = () => $$('[data-nap]').map((r) => ({ start: rowTime(r, 'start'), end: rowTime(r, 'end') }));

    /**
     * What was taken, and the difference between "nothing" and "unasked".
     *
     * `[]` is an answered "nothing tonight" and `null` is a question nobody
     * answered — the column depends on the distinction, so the tap has to
     * survive the trip. See `AIDS` in lib/hq/checkin.ts.
     */
    const sleepAids = (): string[] | null => {
      if (isOn($('[data-aid="none"]'))) return [];
      const taken = pressedAll('aid').filter((k) => k !== 'none');
      return taken.length ? taken : null;
    };

    const collect = () => ({
      logDate,
      bed: time('bed'),
      woke: time('woke'),
      gotUp: time('gotUp'),
      asleepAt: time('asleepAt'),
      sleepLatency: pressed('lat') as never,
      awakenings: pressed('wake') as never,
      wakings: wakings(),
      sleepQuality: stars('sleep_quality'),
      restedness: stars('restedness'),
      valence: track('valence'),
      arousal: track('arousal'),
      // `true` only for an explicit "Nothing"; never `false` — the action
      // derives that from the tones, so the two cannot contradict each other.
      dreamless: isOn($('[data-dream="none"]')) ? true : null,
      dreams: dreams(),
      dreamBody: text('dream_body'),
      sleepAids: sleepAids() as never,
      naps: naps(),
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

        // The sidebar pill, the burger pill and the window title (20 · §7).
        //
        // ⚠ THIS PATH AND NO OTHER. Skip, unskip and Done all end in
        // `location.reload()`, so the server re-renders the count and an event
        // there would be a second, racing answer to a question already settled.
        // What is left is the case nothing else covers: the FIRST save of the
        // morning, where the check-in becomes answered while you are still
        // standing on the page that was asking.
        //
        // ⚠ `logDate` IS SENT, NOT ASSUMED TO BE TODAY. This card follows the
        // date bar — backfilling last Tuesday saves against Tuesday — and the
        // badge never does. `attention.ts` compares the two; passing it is what
        // lets it.
        signalAttention({ kind: 'checkin', on: logDate, answered: true });
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
    // LITERALLY the same functions the server renders the summary with, so the
    // line cannot disagree with the card it turns into.
    function recompute() {
      if (!derivedEl) return;
      derivedEl.textContent = deriveLine(
        derive({
          bed: time('bed'),
          woke: time('woke'),
          latency: pressed('lat') as SleepLatency | null,
          awakenings: pressed('wake') as Awakenings | null,
          gotUp: time('gotUp'),
          asleepAt: time('asleepAt'),
          wakings: wakings(),
          naps: naps(),
        }),
      );
    }

    // ── the words beside the marks ────────────────────────────────────────
    // Each tone's strength track is its own field (`intensity_anxious`), because
    // three of them share one card and a shared name would let a tap on one
    // clear another. They all read from the same five words.
    function setWord(field: string, value: number) {
      const el = $<HTMLElement>(`[data-w-for="${field}"]`);
      if (!el) return;
      const words = field.startsWith('intensity_') ? 'dream_intensity' : field;
      el.textContent = wordFor(words as MarkField, value);
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

    /**
     * A MULTI-select group with one exclusive member.
     *
     * The exclusive one is the answer that denies the others — "Nothing" for
     * dreams and for aids. Tapping it clears the rest; tapping any of the rest
     * clears it. That is the whole rule, and it is shared because both rows
     * mean the same thing by "nothing": a real answer, not an empty one.
     */
    function multi(attr: string, exclusive: string, after?: () => void) {
      $$<HTMLButtonElement>(`[data-${attr}]`).forEach((btn) =>
        btn.addEventListener('click', () => {
          const key = btn.dataset[attr]!;
          const wasOn = btn.getAttribute('aria-pressed') === 'true';
          if (key === exclusive) {
            $$(`[data-${attr}]`).forEach((o) => o.setAttribute('aria-pressed', String(o === btn && !wasOn)));
          } else {
            btn.setAttribute('aria-pressed', String(!wasOn));
            $(`[data-${attr}="${exclusive}"]`)?.setAttribute('aria-pressed', 'false');
          }
          after?.();
          now();
        }),
      );
    }

    /** Every tone's follow-up block matches whether its chip is pressed. */
    function syncDreamPanels() {
      let any = false;
      $$('[data-dream]').forEach((btn) => {
        const key = btn.dataset.dream!;
        if (key === 'none') return;
        const on = btn.getAttribute('aria-pressed') === 'true';
        any ||= on;
        const more = $<HTMLElement>(`[data-dream-more="${key}"]`);
        if (!more) return;
        more.hidden = !on;
        // A tone put away takes its own answers with it. Otherwise an intensity
        // set on Tuesday's anxious dream would ride back in on Wednesday's
        // distressing one the moment the chip was tapped again.
        if (!on) {
          more.querySelectorAll(`[data-tb="intensity_${key}"]`).forEach((el) => el.classList.remove('tb--on'));
          setWord(`intensity_${key}`, 0);
          more.querySelectorAll('[data-flag]').forEach((el) => el.setAttribute('aria-pressed', 'false'));
        }
      });
      // The prose describes the night's dreaming, so it belongs to "was there
      // any", not to any one tone — and it cannot outlive the answer that there
      // was nothing to describe (the table's CHECK says so too).
      const prose = $<HTMLElement>('[data-dream-prose]');
      if (prose) prose.hidden = !any;
      if (!any) {
        // `emitUpdate: false`: this clear is a CONSEQUENCE of the tone you just
        // pressed, and that press has already scheduled a save. Letting the
        // editor announce it too would queue a second one for the same click.
        proseFields.get('dream_body')?.editor.commands.setContent('', { emitUpdate: false });
      }
    }

    multi('dream', 'none', syncDreamPanels);
    multi('aid', 'none');

    group('lat', (value) => {
      // The refinement belongs to the open-ended bucket and to nothing else —
      // the same rule the table's CHECK enforces and the action re-applies.
      // Clearing it on the way back down the scale means a change of mind
      // cannot strand a measured latency under a bucket that contradicts it.
      const more = $<HTMLElement>('[data-asleep-at]');
      const open = value === OPEN_ENDED_LATENCY;
      if (more) more.hidden = !open;
      if (!open) {
        const input = $<HTMLInputElement>('[data-field="asleepAt"]');
        if (input) input.value = '';
      }
    });

    group('wake', (value) => {
      // Same shape one bucket over: a timed waking refines "a few" and "many",
      // and means nothing under "not at all". The action drops them too, so a
      // change of mind is a change of mind rather than an error at 7am.
      const more = $<HTMLElement>('[data-wakings]');
      const open = TIMEABLE_WAKINGS.includes(value as Awakenings);
      if (more) more.hidden = !open;
      if (!open) $$('[data-waking]').forEach((r) => r.remove());
    });

    $$<HTMLButtonElement>('[data-star]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const field = btn.dataset.star!;
        const v = Number(btn.dataset.v);
        $$(`[data-star="${field}"]`).forEach((o) => o.classList.toggle('st--on', Number(o.dataset.v) <= v));
        setWord(field, v);
        now();
      }),
    );

    // ── repeaters ─────────────────────────────────────────────────────────
    // THE ROW IS THE STATE, so an added row is complete the moment it exists —
    // no array to keep in step, and no index to renumber when one in the middle
    // is removed.
    //
    // ⚠ CLONED FROM A `<template>` THE SERVER RENDERED, never assembled from a
    // string here. Building the markup twice would mean building it without
    // `<Icon>` the second time, and a waking you just added would be missing
    // glyphs that a waking you reloaded has.
    function addRow(kind: string, listSel: string): HTMLElement | null {
      const tpl = $<HTMLTemplateElement>(`[data-tpl="${kind}"]`);
      const list = $<HTMLElement>(listSel);
      if (!tpl || !list) return null;
      const el = tpl.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
      if (!el) return null;
      list.append(el);
      return el;
    }

    const focusFirst = (row: HTMLElement | null) => row?.querySelector<HTMLInputElement>('input')?.focus();

    $('[data-add-waking]')?.addEventListener('click', () => focusFirst(addRow('waking', '[data-waking-list]')));

    const addNap = () => focusFirst(addRow('nap', '[data-nap-list]'));
    $('[data-add-nap]')?.addEventListener('click', addNap);

    // A nap arrives hours after this card was closed, so the summary offers its
    // own way in — straight to an empty row, rather than back through a form
    // about last night.
    $('[data-add-nap-from-done]')?.addEventListener('click', () => {
      show('fill');
      const naps = $<HTMLElement>('[data-fs="naps"]');
      naps?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      addNap();
    });

    // ── delegated, because half of these controls did not exist at load ────
    // Every repeater row is built after this listener is attached, so binding
    // per row would mean remembering to bind — and forgetting once is a "Got
    // up" toggle that looks alive and never saves.
    zone.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;

      const flag = el.closest<HTMLElement>('[data-flag], [data-left-bed]');
      if (flag) {
        flag.setAttribute('aria-pressed', String(flag.getAttribute('aria-pressed') !== 'true'));
        recompute();
        now();
        return;
      }

      const drop = el.closest<HTMLElement>('[data-drop]');
      if (drop) {
        drop.closest('.rep')?.remove();
        recompute();
        now();
        return;
      }

      const tb = el.closest<HTMLElement>('[data-tb]');
      if (tb) {
        const field = tb.dataset.tb!;
        const v = Number(tb.dataset.v);
        $$(`[data-tb="${field}"]`).forEach((o) => o.classList.toggle('tb--on', o === tb));
        setWord(field, v);
        now();
      }
    });

    zone.addEventListener('input', (e) => {
      const el = e.target as HTMLElement;
      if (!(el instanceof HTMLInputElement) || el.type !== 'time') return;
      const hint = $<HTMLElement>('[data-prefill]');
      if (hint) hint.hidden = true; // it is your time now, not a suggestion
      recompute();
      soon();
    });

    $$<HTMLButtonElement>('[data-reveal]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const field = btn.dataset.reveal!;
        const host = $<HTMLElement>(`[data-field="${field}"]`);
        if (!host) return;
        host.hidden = false;
        btn.hidden = true;
        // ⚠ FOCUS AFTER THE UNHIDE. ProseMirror cannot place a caret inside a
        // `hidden` subtree — the command is simply dropped — where a textarea's
        // `.focus()` did not care about the order.
        const editor = proseFields.get(field);
        if (editor) editor.editor.commands.focus();
        else host.focus();
      }),
    );

    // The autosave listeners for the two prose fields are attached at their
    // mount above (`onChange` + `focusout`), because a contenteditable fires no
    // `input` this form can hear. No `textarea[data-field]` remains.

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
      // ⚠ SKIP HAD NO CATCH while the autosave above has carried one since the
      // day its own spec found the bug. Same surface, same header promising
      // that *failure is loud*, and offline a Skip/Unskip tap did nothing at
      // all — no reload, no sentence, an unhandled rejection. The one place a
      // silent no-op is worst is the control whose whole meaning is "I answered
      // this, stop asking."
      const { error } = await callAction(actions.checkin.setSkipped({ logDate, skipped }));
      if (error) {
        note(formatActionError(error), true);
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
