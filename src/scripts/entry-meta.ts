// The meta row shared by the two places an interaction gets written: the log
// box on a profile (TimelineZone.astro) and the log sheet in the notes pile
// (LogSheet.astro). Kind, date, and who — the three questions both ask.
//
// ⚠ THE COMPONENTS ARE STILL TWO, AND THAT IS NOT AN OVERSIGHT. LogSheet.astro's
// header records the decision not to share the MARKUP, and it stands: a profile
// already knows whose entry this is, so its picker adds *others* and is
// optional; the pile has no subject at all until you name one, so the same
// control is required and reads "Who?" rather than "with". Two person models,
// two components. What was never different is the WIRING underneath — the same
// six kinds, the same three relative days, the same date-input trap, the same
// popovers — and that is what lives here.
//
// ⚠ THE DATE GUARD IS THE REASON THIS EXISTS AT ALL. Both copies carried a
// comment about the half-typed-year bug and one of them just said "See
// log-box.ts". A rule that lives in a comment pointing at another file is the
// exact shape docs/plans/25 spent a sitting removing from the save paths; this
// is the same fix applied to the room next door. It is one function now.
//
// ⚠ AND ONE COPY HAD ALREADY DRIFTED: log-box.ts re-declared a local `shiftYmd`
// — five untested lines beside the tested one in `lib/hq/time.ts` — which is
// what "the second consumer exists" looks like when nobody acts on it.
import { anchorPopover } from './pop-anchor';
import { shiftYmd, type Ymd } from '../lib/hq/time';

export interface EntryMetaOptions {
  /** The page's idea of today, as a local `YYYY-MM-DD`. */
  today: Ymd;
  /**
   * Which attribute the people rows carry. `with` on a profile, `who` in the
   * pile — two words because they mean two things, which is the whole reason
   * the markup was deliberately not shared. It names the label and the trigger
   * too (`data-with-label` / `data-with-open`).
   */
  peopleAttr: 'with' | 'who';
  /** How the closed chip reads, given the ticked names in tick order. */
  peopleLabel: (names: string[]) => string;
  /** Fired whenever the ticks change. LogSheet gates its Save on this. */
  onPeopleChange?: () => void;
}

export interface EntryMeta {
  /** The chosen kind key, read off the DOM. Undefined only if nothing is on. */
  kind: () => string | undefined;
  /** The chosen date, as a local `YYYY-MM-DD`. */
  occurredOn: () => Ymd;
  /** The ticked people, in the order they were ticked. */
  people: () => string[];
  /** Back to the defaults: today, the first kind, nobody. */
  reset: () => void;
  /** Load an existing entry's meta back in — the log box's edit path. */
  set: (on: Ymd, kind: string, people: string[]) => void;
  /** Shut every picker, for a host closing its own surface. */
  closePops: () => void;
}

/** `8/9` — the compact stamp a chosen date falls back to. UTC accessors on a
 *  UTC-midnight instant, so the label cannot slip a day west of Greenwich. */
const monthDay = (ymd: Ymd) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export function wireEntryMeta(
  root: ParentNode,
  { today, peopleAttr, peopleLabel, onPeopleChange }: EntryMetaOptions,
): EntryMeta {
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const $$ = <T extends HTMLElement>(sel: string) => Array.from(root.querySelectorAll<T>(sel));

  const kindLabel = $<HTMLElement>('[data-kind-label]')!;
  const kindIcon = $<HTMLElement>('[data-kind-icon]')!;
  const dateLabel = $<HTMLElement>('[data-date-label]')!;
  // ⚠ NOT `!`, unlike the three above. TimelineZone renders its people chip only
  // when the roster holds somebody besides the person whose page it is, so on a
  // one-person corpus these two are genuinely absent — and the log box has
  // always coped by doing nothing rather than throwing at module top level.
  const peopleLabelEl = $<HTMLElement>(`[data-${peopleAttr}-label]`);
  const peopleOpenEl = $<HTMLElement>(`[data-${peopleAttr}-open]`);
  const peopleRows = () => $$<HTMLButtonElement>(`[data-${peopleAttr}]`);

  let occurredOn: Ymd = today;
  const chosen = new Set<string>();

  // ── the pickers ────────────────────────────────────────────────────────────
  // Opening, closing, Escape, light-dismiss and one-at-a-time all belong to the
  // browser (`popovertarget` + `popover="auto"`). All that is left is putting
  // one in the right place, and that arithmetic — plus the measure-after-open
  // trap it exists to avoid — is `pop-anchor.ts`.
  const pops = $$<HTMLElement>('[data-pop]');
  const closePops = () => pops.forEach((p) => p.matches(':popover-open') && p.hidePopover());
  for (const pop of pops) {
    anchorPopover(pop, () => $<HTMLElement>(`[popovertarget="${pop.id}"]`));
  }

  // ── kind ───────────────────────────────────────────────────────────────────
  $$<HTMLButtonElement>('[data-kind]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('[data-kind]').forEach((o) => o.classList.toggle('is-on', o === btn));
      kindLabel.textContent = btn.textContent!.trim();
      // The glyph is CLONED INTO a wrapper that stays. Replacing the
      // `[data-kind-icon]` element itself would destroy the hook, so the second
      // choice you made would silently do nothing — a bug the log box paid for
      // once, and the log sheet then inherited the comment about.
      const svg = btn.querySelector('svg');
      if (svg) kindIcon.replaceChildren(svg.cloneNode(true));
      closePops();
    }),
  );

  // ── date ───────────────────────────────────────────────────────────────────
  const setDate = (ymd: Ymd, label: string) => {
    occurredOn = ymd;
    dateLabel.textContent = label;
  };
  $$<HTMLButtonElement>('[data-day]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('[data-day]').forEach((o) => o.classList.toggle('is-on', o === btn));
      setDate(shiftYmd(today, -Number(btn.dataset.day)), btn.textContent!.trim());
      closePops();
    }),
  );
  $<HTMLInputElement>('[data-date-input]')?.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    const value = el.value;
    if (!value) return;
    // ⚠ A DATE INPUT FIRES `change` PER SEGMENT, not when you are finished with
    // it. Once month and day are filled, the FIRST digit of the year completes
    // a "valid" date — 2 arrives as the year 0002 — so this handler used to
    // commit that and close the picker before `2026` could be typed. Waiting
    // for the year to land inside the input's own `min`/`max` is the fix: 0002,
    // 0020 and 0202 are all range errors, and we simply sit through them.
    //
    // This is the paragraph that was living in two files, one of which only
    // pointed at the other.
    if (el.validity.rangeUnderflow) return;
    $$('[data-day]').forEach((o) => o.classList.remove('is-on'));
    setDate(value, monthDay(value));
    closePops();
  });

  // ── who ────────────────────────────────────────────────────────────────────
  // Multi-select, and the label COUNTS rather than listing — three names would
  // push the meta row past the box at 390px. What the count reads as is the
  // host's (`with Ana +2` on a profile, `Ana +2` in the pile), because that is
  // the one place the two surfaces genuinely differ.
  function syncPeople() {
    if (peopleLabelEl) {
      const names = [...chosen].map((id) => $<HTMLElement>(`[data-${peopleAttr}="${id}"]`)?.dataset.name ?? '');
      peopleLabelEl.textContent = peopleLabel(names);
    }
    peopleOpenEl?.classList.toggle('lchip--on', chosen.size > 0);
    onPeopleChange?.();
  }
  peopleRows().forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset[peopleAttr]!;
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      btn.classList.toggle('is-on', chosen.has(id));
      syncPeople();
    }),
  );

  return {
    kind: () => $<HTMLElement>('[data-kind].is-on')?.dataset.kind,
    occurredOn: () => occurredOn,
    people: () => [...chosen],
    closePops,

    reset() {
      chosen.clear();
      occurredOn = today;
      peopleRows().forEach((o) => o.classList.remove('is-on'));
      $$('[data-kind]').forEach((o, i) => o.classList.toggle('is-on', i === 0));
      $$('[data-day]').forEach((o, i) => o.classList.toggle('is-on', i === 0));
      // ⚠ READ OFF THE FIRST CHIP rather than written out again. Both copies
      // hard-coded 'Hangout' and 'Today', which made four places for
      // `KINDS[0]` / `QUICK_DAYS[0]` to be restated — and "the DOM is the
      // state" is this pair's own stated principle, so the chip is the honest
      // source. Reordering either list can no longer leave a default behind.
      const firstKind = $$<HTMLElement>('[data-kind]')[0];
      const firstDay = $$<HTMLElement>('[data-day]')[0];
      if (firstKind) kindLabel.textContent = firstKind.textContent!.trim();
      if (firstDay) dateLabel.textContent = firstDay.textContent!.trim();
      const glyph = firstKind?.querySelector('svg');
      if (glyph) kindIcon.replaceChildren(glyph.cloneNode(true));
      syncPeople();
    },

    set(on, kind, people) {
      // ⚠ TWO RELATIVE WORDS, NOT THREE, and that is as shipped rather than a
      // choice made here. The picker offers Today / Yesterday / 2 days ago, but
      // re-opening an entry has only ever resolved the first two and fallen
      // back to `8/7` for the third. Matching the chips would read better and
      // it is a behaviour change, so it is written down rather than smuggled
      // into an extraction.
      const label = on === today ? 'Today' : on === shiftYmd(today, -1) ? 'Yesterday' : null;
      setDate(on, label ?? monthDay(on));
      // ⚠ NO DAY CHIP IS LIT, deliberately. The chips mean "jump to this day";
      // marking one on load would claim you had pressed it.
      $$('[data-day]').forEach((o) => o.classList.remove('is-on'));
      $<HTMLButtonElement>(`[data-kind="${kind}"]`)?.click(); // reuses the label + glyph swap
      closePops();
      for (const id of people) {
        chosen.add(id);
        $(`[data-${peopleAttr}="${id}"]`)?.classList.add('is-on');
      }
      syncPeople();
    },
  };
}
