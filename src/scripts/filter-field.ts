/**
 * The one filter pass in the Observatory (plan 42 · §4.B.2).
 *
 * ⚠ THIS EXISTED FOUR TIMES, THREE OF THEM BYTE-IDENTICAL. `tag-sheet.ts`,
 * `event-sheet.ts` and `shared-by.ts` each carried the same six lines over
 * `.sby__row`; `constellation-picker.ts` carried a longer version that also
 * counted hits, drove a no-match line and re-checked the threshold. Four copies
 * of a rule is how three of them come to be missing the half the fourth
 * has — which is exactly what had happened.
 */

/** What a wired field lets its sheet do after the rows underneath it change. */
export interface FilterFieldHandle {
  /** Re-run the pass. Call after adding or removing rows — it re-checks the threshold too. */
  sync(): void;
  /** Empty the query and show everything. For a sheet reopening on a new record. */
  clear(): void;
  input: HTMLInputElement;
}

/**
 * Wire one `<FilterField>` wrapper.
 *
 * Idempotent — `wireFilterFields` runs on every sheet open in some rooms, and a
 * field wired twice would run its pass twice per keystroke. Same guard idiom as
 * `wireRadioGroups`.
 */
export function wireFilterField(el: HTMLElement): FilterFieldHandle | null {
  // ⚠ RESOLVE THE WRAPPER RATHER THAN TRUSTING THE ARGUMENT, because the first
  // caller got it wrong and NOTHING SAID SO. `constellation-picker.ts` passed
  // its `.cn-picker` root — the element the `[data-ff]` div now sits inside —
  // so `dataset.rows` came back undefined, the row selector was `''`, and
  // `querySelectorAll('')` throws a SyntaxError from inside an `input`
  // listener: swallowed, no console line on the happy path, and the filter
  // simply did nothing. Caught by the e2e spec, not by `verify`.
  const root = el.matches('[data-ff]') ? el : (el.querySelector<HTMLElement>('[data-ff]') ?? el);

  const field = root.querySelector<HTMLElement>('.search');
  const input = root.querySelector<HTMLInputElement>('input[type="search"]');
  if (!field || !input) return null;

  const none = root.querySelector<HTMLElement>('.ff__none');
  const rowSel = root.dataset.rows ?? '';
  // Belt and braces on the same trap: an empty selector is a programming error,
  // and it should say so once rather than throw on every keystroke.
  if (!rowSel) {
    console.error('FilterField: no data-rows on', root);
    return null;
  }
  const groupSel = root.dataset.groups ?? '';
  const rawThreshold = root.dataset.threshold ?? '';
  /** '' means the caller passed `threshold={null}`: always show the field. */
  const threshold = rawThreshold === '' ? null : Number(rawThreshold);

  function apply() {
    const q = input!.value.trim().toLowerCase();
    const rows = Array.from(root.querySelectorAll<HTMLElement>(rowSel));
    let shown = 0;
    for (const row of rows) {
      const hit = !q || (row.dataset.search ?? '').includes(q);
      row.hidden = !hit;
      if (hit) shown++;
    }

    // A section whose every row is filtered out hides its heading with them.
    // The roster's words for why: "a heading over an empty grid reads as a
    // rendering bug." Its own count stays truthful because it counts what
    // EXISTS, not what is showing — so nothing here has to rewrite it.
    if (groupSel) {
      for (const group of root.querySelectorAll<HTMLElement>(groupSel)) {
        group.hidden = !group.querySelector(`${rowSel}:not([hidden])`);
      }
    }

    // ⚠ `|| !q` IS NOT DEFENSIVE, IT FIXES A LINE THAT SHOWED THE WRONG THING.
    // `ConstellationPicker`'s version read `hidden = shown > 0`, so a picker
    // with NO constellations and nothing typed rendered "Nothing matches."
    // stacked on top of its own "No constellations yet" empty state — two
    // sentences, one of them answering a question nobody had asked. A no-match
    // line is about a QUERY; with no query there is nothing for it to say.
    if (none) none.hidden = shown > 0 || !q;

    // A live query never hides its own field, however few rows are left: the
    // box that is doing the filtering vanishing under you is worse than a box
    // over four rows.
    if (threshold !== null) field!.hidden = rows.length <= threshold && !q;
  }

  if (root.dataset.ffWired !== '1') {
    root.dataset.ffWired = '1';
    input.addEventListener('input', apply);
  }

  // ⚠ RE-APPLY ON WIRE, and this line is the finding's actual fix. These
  // surfaces reload after a save (ADR 0036 — the reload is correct and is not
  // going to stop); browsers restore form state across a reload; so without
  // this the query text comes back while `input` never fires, leaving a filled
  // search box sitting over an unfiltered list. Live on `/admin/people` today.
  if (input.value) apply();

  return {
    sync: apply,
    clear() {
      input.value = '';
      apply();
    },
    input,
  };
}

/** Wire every `<FilterField>` under `scope`. */
export function wireFilterFields(scope: ParentNode = document): FilterFieldHandle[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('[data-ff]'))
    .map(wireFilterField)
    .filter((h): h is FilterFieldHandle => h !== null);
}
