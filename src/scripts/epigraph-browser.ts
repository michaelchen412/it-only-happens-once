// The SET SHEET's quote picker (plan 42 · §4.D.4) — the third room to use the
// FragmentBrowser drawer.
//
// It answers one question: *which quote belongs beside this playlist?* — and it
// is the narrowest of the three modes by some distance. Published quotes only,
// one pick, no cart, no editors, no create bar.
//
// ⚠ IT WRITES NOTHING. `pick` calls `constellations.place` and `pair` calls
// `songs.pair`, both immediately, because both are RELATIONS — join rows that
// are instantly reversible (docs/admin.md §4a). A set's epigraph is not: it is
// a scalar column on the set, saved with the rest of the card by `sets.save`.
// So this hands the choice back to the sheet and the sheet holds it until Save,
// which is what makes an unsaved new set able to carry a quote at all.
//
// That is also why there is no confirm here where `pair-browser.ts` has one. A
// pick from the song side can STEAL an essay's existing pairing; picking a quote
// can only ever replace this set's own, in a field the sheet is showing you.
import { wireBrowserShell } from './browser-shell';

/** What the sheet shows once a quote is chosen. */
export interface PickedQuote {
  id: string;
  /** The quote's own words, already flattened by the row. */
  label: string;
  attribution: string;
}

export interface EpigraphBrowserOpts {
  onPicked: (quote: PickedQuote) => void;
}

export interface EpigraphBrowserHandle {
  open: (ctx: { setName: string }) => void;
}

export function wireEpigraphBrowser(root: HTMLDialogElement, { onPicked }: EpigraphBrowserOpts): EpigraphBrowserHandle {
  const shell = wireBrowserShell(root, {
    params: () => ({ mode: 'epigraph' }),
    panel: {
      // ⚠ NO ROW CLICK HANDLER, and the absence is the decision `pair` already
      // took: this drawer opens no editors. `pick` opens them because placing is
      // curation and you must read what you curate; here you are choosing one
      // line to sit above a playlist, and the table already shows it whole.
      onAction: (act, id, row) => {
        if (act !== 'epigraph') return;
        /*
          ⚠ READ FROM `data-fragment`, NOT FROM THE ROW'S TEXT. Every quote row
          already carries its editor payload — that is what opens the quote sheet
          — so the body and the attribution are there as COLUMNS. Scraping the
          cells instead would pick up the citation line's leading "— ", the
          `<em>` a work title is set in, and, whenever a search is running, the
          `<mark>`s `Highlighted` wraps around the matched term. The sheet would
          then show a summary that changes depending on what you searched for to
          find it.
        */
        const q = JSON.parse(row.dataset.fragment ?? '{}') as { body?: string; attribution?: string };
        onPicked({
          id,
          label: (q.body ?? '').replace(/\s+/g, ' ').trim(),
          attribution: (q.attribution ?? '').trim(),
        });
        shell.close();
      },
    },
  });

  return {
    open({ setName }) {
      // ⚠ THROW THE PANEL AWAY FIRST — the same reason the pair drawer does.
      // One drawer serves every set the sheet loads, and while the rows here do
      // not depend on WHICH set is open, the header's name does; resetting keeps
      // one rule for "this drawer was opened on something else" rather than two.
      shell.reset();
      shell.setName(setName || 'this set');
      shell.open();
    },
  };
}
