// The COMPOSER's browser drawer — placing fragments in a constellation.
//
// ⚠ THE DRAWER ITSELF IS NO LONGER IN HERE (plan 39 · §1). Loading the panel,
// the error line, open/close and the three dismissals moved to
// `browser-shell.ts`, which the song sheet's pairing picker uses too. What is
// left in this file is the VERB — `constellations.place`, the cart, and the
// row-state bookkeeping that a placement implies — and that is deliberately not
// shared: pairing is a different write with different cardinality and different
// collision rules, and one parameterised `commit()` would have been two branches
// wearing a single name.
import { actions } from 'astro:actions';
import { wireAddMenu } from './fragment-panel';
import { callAction, formatActionError } from './action-error';
import { starMarkHtml } from '../lib/star-mark';
import { stripMarkdown } from '../lib/markdown-plain';
import { openEditorFor } from './open-editor';
import { onSkyChange } from './sky-changed';
import { notifyFragmentsChanged } from './fragments-changed';
import { wireBrowserShell } from './browser-shell';

// ⚠ SELF-GUARDING, because FragmentBrowser.astro imports this unconditionally.
// An Astro `<script>` inside a `{}` expression is inert HTML rather than a
// hoisted module, so "only import it in pick mode" is not a thing the component
// can express — and /admin/listening mounts a pair-mode drawer with no
// constellation for any of this to act on.
const browser = document.querySelector<HTMLDialogElement>('.fbrowser[data-mode="pick"]');
if (browser) wireComposerBrowser(browser);

function wireComposerBrowser(browser: HTMLDialogElement) {
  const cid = browser.dataset.constellation!;
  // `let`, not `const`: the constellation's name is edited in the form BEHIND
  // this drawer, and a chip added live has to match what was just saved rather
  // than what the server rendered when the page loaded.
  //
  // ⚠ COLOUR NO LONGER ARRIVES THIS WAY, and the absence is deliberate
  // (docs/plans/16 · Piece 3): the composer stopped asking for a colour, so on
  // this page the rendered value can't go stale — it is correct by
  // construction. `ccolor` stays a `let` and the guard below stays, because the
  // event still carries an optional colour and a future surface may send one.
  // If an editing control ever returns to the composer, this is one of three
  // places that cached its answer, which is the argument for it not returning.
  let cname = browser.dataset.constellationName ?? '';
  let ccolor = browser.dataset.constellationColor ?? '';

  let placedAny = false;

  const bulkbar = browser.querySelector<HTMLElement>('.fb-bulkbar')!;
  const bulkcount = browser.querySelector<HTMLElement>('.fb-bulkcount')!;
  const placeSelectedBtn = browser.querySelector<HTMLButtonElement>('.fb-place-selected')!;

  const shell = wireBrowserShell(browser, {
    params: () => ({ mode: 'pick', constellation: cid }),
    panel: {
      onOpen(row) {
        shell.clearError();
        openEditorFor(row);
      },
      async onAction(act, id, row) {
        shell.clearError();
        // The membership cell works in here too, and it can tick THIS
        // constellation — the same placement the ＋ beside it makes. Nothing
        // needs to reconcile the two: the sheet announces `fragments:changed`
        // on its way out, this drawer refreshes its rows, and the row comes
        // back from the server already marked placed.
        if (act === 'constellations') return void openEditorFor(row, 'constellations');
        if (act !== 'place') return;
        if (await place(id)) markPlaced(row); // which also takes it out of the cart
      },
      onSelectionChange(ids, shown) {
        // Shows on the CART being non-empty, not on the visible selection —
        // and there is deliberately no `onSwap` hide any more. Hiding the bar
        // on a filter change was belt-and-braces on a loss that no longer
        // happens; keeping it would now hide a cart that still has things in
        // it, which is the confusing half of this feature rather than the
        // useful half.
        bulkbar.hidden = ids.length === 0;
        // "· n shown here" is the honesty mechanism, not decoration: once the
        // cart outlives the filter, the count can exceed what you can see, and
        // a number that doesn't match what's on screen has to be explained or
        // it reads as a bug.
        bulkcount.textContent =
          shown === ids.length ? `${ids.length} selected` : `${ids.length} selected · ${shown} shown here`;
        placeSelectedBtn.textContent = `Place ${ids.length === 1 ? 'it' : `all ${ids.length}`} in constellation`;
      },
    },
    onOpen() {
      setHash('#browse');
    },
    onClose() {
      setHash('');
      // The suite underneath is stale the moment something was placed. It used
      // to be a `location.reload()` in this same tick, which cut the drawer's
      // own slide-out short; now the composer refreshes the suite in place and
      // the drawer gets to finish closing.
      if (placedAny) {
        placedAny = false;
        notifyFragmentsChanged(browser);
      }
    },
  });

  onSkyChange((c) => {
    if (c.id !== cid) return;
    cname = c.name;
    if (c.color) ccolor = c.color;
    shell.setName(c.name);
    // ⚠ THE DESCRIPTION IS MARKDOWN (since 2026-08-11 — the composer's field is
    // a rich editor now), and this header is one clamped line plus a `title`
    // tooltip. Neither can render a mark, so the marks come off: `stripMarkdown`,
    // not `lib/markdown.ts`, because that one carries `marked` + `sanitize-html`
    // and this is a browser bundle. The server does the same at the call site
    // with `toPlainText`; both arrive at words.
    shell.setNote(stripMarkdown(c.description ?? ''));
  });

  async function place(id: string): Promise<boolean> {
    const fd = new FormData();
    fd.set('constellation_id', cid);
    fd.set('fragment_id', id);
    // ⚠ `callAction`, NOT a bare await — this function's `false` return is what
    // both callers use to stop, and a dead network THROWS rather than returning
    // `{ error }`. That rejection propagated straight out of the `for` loop below
    // and skipped `placeSelectedBtn.disabled = false`, so **Place all N** stuck
    // disabled for the life of the drawer with nothing said. Found alongside the
    // nine sites in docs/plans/25; the audit's own grep missed this one because
    // the await is one function away from the button it wedges.
    const { error } = await callAction(actions.constellations.place(fd));
    if (error) {
      shell.showError(formatActionError(error));
      return false;
    }
    placedAny = true;
    return true;
  }

  /** Re-derive the membership cell's names from the chips now in it. The cell
   *  is a button, so its accessible name is an `aria-label` — which means it
   *  does NOT follow the chips we just changed unless something says so, and a
   *  label that still says "in no constellations" over a filled chip is worse
   *  than no label at all. */
  function relabelCnCell(row: HTMLElement) {
    const btn = row.querySelector<HTMLElement>('.cn-cell');
    if (!btn) return;
    const names = [...row.querySelectorAll('.cn-cell__chips .admin-chip--in')].map((c) => c.textContent!.trim());
    btn.title = names.join(' · ');
    btn.setAttribute(
      'aria-label',
      names.length ? `In ${names.join(', ')} — change constellations` : 'In no constellations — assign one',
    );
  }

  /** Flip a row to its placed state in place — no refetch, the sheet stays open. */
  function markPlaced(row: HTMLElement) {
    row.classList.add('opacity-45');
    row.classList.remove('hover:bg-base-200/40');
    row.dataset.placed = '';
    const check = row.querySelector<HTMLInputElement>('.row-check');
    if (check) {
      check.checked = false;
      check.disabled = true;
      // The cart is a Set of ids, not a reading of the checkboxes, so
      // disabling one does NOT take it out — and a placed fragment left in the
      // cart would be re-placed on the next bulk press (harmless, `place` is
      // idempotent) and would keep inflating the count (not harmless).
      shell.panel()?.deselect(check.value);
    }
    const cell = row.querySelector('[data-act="place"]')?.closest('td');
    if (cell)
      cell.innerHTML = `<span class="font-sans text-[0.65rem] tracking-wide text-primary/70 uppercase">${starMarkHtml()} placed</span>`;

    // Keep the membership column honest without a refetch: drop the "none"
    // chip if this was an orphan, and add this constellation's own chip.
    //
    // It used to find that cell by `td.lg\:table-cell` and build the chip list
    // if it was missing — both of which stopped being true when the column
    // became a control (FragmentRow.astro). The wrapper is now always there,
    // and `.cn-cell__chips` names it rather than describing where it sits.
    const list = row.querySelector('.cn-cell__chips');
    if (list) {
      list.querySelector('.admin-chip--none')?.remove();
      const chip = document.createElement('span');
      chip.className = `admin-chip admin-chip--in max-w-[11rem] truncate${ccolor ? ` cn-${ccolor}` : ''}`;
      chip.innerHTML = starMarkHtml('mr-1');
      chip.append(cname);
      list.appendChild(chip);
      relabelCnCell(row);
    }
    const ids = new Set((row.dataset.constellations || '').split(',').filter(Boolean));
    ids.add(cid);
    row.dataset.constellations = [...ids].join(',');
  }

  browser.querySelector('.fb-clear-selected')?.addEventListener('click', () => shell.panel()?.clearSelection());

  placeSelectedBtn.addEventListener('click', async () => {
    const panel = shell.panel();
    if (!panel) return;
    const ids = panel.getSelected();
    if (!ids.length) return;
    shell.clearError();
    placeSelectedBtn.disabled = true;
    // Sequential — each placement appends position = max+1, so the cart's
    // insertion order becomes the suite's order. That is why getSelected()
    // returns a Set's iteration order and not a DOM read.
    for (const id of ids) {
      const ok = await place(id);
      if (!ok) break; // the rest stay in the cart, so a failure is retryable
      const row = panel.root.querySelector<HTMLElement>(`tr.fragment-row[data-id="${id}"]`);
      if (row)
        markPlaced(row); // which deselects it
      else panel.deselect(id); // carted under a filter that no longer shows it
    }
    placeSelectedBtn.disabled = false;
  });

  // --- open / close ---------------------------------------------------------
  const setHash = (h: string) => history.replaceState(null, '', location.pathname + location.search + h);

  document
    .querySelectorAll<HTMLElement>('[data-browse]')
    .forEach((btn) => btn.addEventListener('click', () => shell.open()));

  // The #browse hash trick is no longer LOAD-BEARING: the drawer never closes
  // for a save any more, so there is no navigation to land back inside. Left in
  // place because it still covers a genuine hard refresh (and Back, though
  // Piece 3's `no-store` means that is now a real request rather than bfcache).
  if (location.hash === '#browse') shell.open();

  wireAddMenu(browser.querySelector<HTMLElement>('.fb-add-btn')!, browser.querySelector<HTMLElement>('.fb-add-menu')!);
}
