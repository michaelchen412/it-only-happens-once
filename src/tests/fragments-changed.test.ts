// `corpusDebt` — what an editor sheet owes the list behind it (fragments-changed.ts).
//
// These are the rules that decide WHEN the list hears about an edit, and they
// fail silently in both directions: too few announcements and a host shows
// stale rows with no error; one live announcement too many and a host that
// cannot redraw under an open sheet (the composer) is handed one anyway. Neither
// is visible in a green build, so the rules are pinned here.
//
// No DOM environment: Node already has `EventTarget` and `CustomEvent`, and the
// module touches nothing else but timers and `location.reload`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeDialog extends EventTarget {
  open = true;
  dataset: Record<string, string> = {};
}

type Detail = { live: boolean; settled: Promise<void> };

let doc: EventTarget;
let reload: ReturnType<typeof vi.fn>;
let mod: typeof import('../scripts/fragments-changed');

beforeEach(async () => {
  vi.useFakeTimers();
  doc = new EventTarget();
  reload = vi.fn();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('location', { reload });
  vi.resetModules();
  mod = await import('../scripts/fragments-changed');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Every `fragments:changed` dispatched, in order. */
function heard(): Detail[] {
  const seen: Detail[] = [];
  doc.addEventListener('fragments:changed', (e) => seen.push((e as CustomEvent<Detail>).detail));
  return seen;
}

/** What a sheet does on the way out: start the exit, then settle. */
function closeSheet(dialog: FakeDialog, debt: { settle: () => void }) {
  dialog.dataset.closing = '1';
  debt.settle();
}

describe('corpusDebt — while the sheet is open', () => {
  it('tells a live host once a burst of saves goes quiet, and owes nothing on close', () => {
    const seen = heard();
    mod.onFragmentsChanged(() => true, { live: true });
    const dialog = new FakeDialog();
    const debt = mod.corpusDebt(dialog as unknown as HTMLElement);

    debt.changed();
    vi.advanceTimersByTime(500);
    debt.changed(); // an autosave mid-burst restarts the wait
    vi.advanceTimersByTime(1199);
    expect(seen).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(seen.map((d) => d.live)).toEqual([true]);

    closeSheet(dialog, debt);
    expect(seen).toHaveLength(1); // paid already — nothing at close
    expect(reload).not.toHaveBeenCalled();
  });

  it('never hands a live announcement to a host that did not ask for one — it hears on close instead', () => {
    const composer = vi.fn<(d: Detail) => boolean>(() => true);
    mod.onFragmentsChanged(composer); // no { live: true }: it swaps a whole suite
    const dialog = new FakeDialog();
    const debt = mod.corpusDebt(dialog as unknown as HTMLElement);

    debt.changed();
    vi.advanceTimersByTime(2000);
    expect(composer).not.toHaveBeenCalled();

    closeSheet(dialog, debt);
    expect(composer).toHaveBeenCalledTimes(1);
    expect(composer.mock.calls[0][0]).toMatchObject({ live: false });
  });

  it('keeps the debt when a live host and a close-only host share the page', () => {
    // The composer's browser drawer over the composer: the drawer redraws live,
    // the suite underneath still has to be told on close.
    const drawer = vi.fn(() => true);
    const composer = vi.fn(() => true);
    mod.onFragmentsChanged(drawer, { live: true });
    mod.onFragmentsChanged(composer);
    const dialog = new FakeDialog();
    const debt = mod.corpusDebt(dialog as unknown as HTMLElement);

    debt.changed();
    vi.advanceTimersByTime(1200);
    expect(drawer).toHaveBeenCalledTimes(1);

    closeSheet(dialog, debt);
    expect(composer).toHaveBeenCalledTimes(1);
  });

  it('falls back to a reload on close when no host can refresh in place — never mid-edit', () => {
    const dialog = new FakeDialog();
    const debt = mod.corpusDebt(dialog as unknown as HTMLElement);

    debt.changed();
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled(); // a live announcement must not reload the page under you

    closeSheet(dialog, debt);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('owes nothing, and says nothing, when nothing was written', () => {
    const seen = heard();
    const dialog = new FakeDialog();
    const debt = mod.corpusDebt(dialog as unknown as HTMLElement);
    closeSheet(dialog, debt);
    vi.advanceTimersByTime(5000);
    expect(seen).toHaveLength(0);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('corpusDebt — writes that race the close', () => {
  it('a save then an immediate close is announced once, as a close', () => {
    const seen = heard();
    mod.onFragmentsChanged(() => true, { live: true });
    const dialog = new FakeDialog();
    const debt = mod.corpusDebt(dialog as unknown as HTMLElement);

    debt.changed();
    closeSheet(dialog, debt);
    vi.advanceTimersByTime(5000);
    expect(seen.map((d) => d.live)).toEqual([false]);
  });

  it('a write that lands after the close began is told at once, not left owed', () => {
    const seen = heard();
    mod.onFragmentsChanged(() => true, { live: true });
    const dialog = new FakeDialog();
    const debt = mod.corpusDebt(dialog as unknown as HTMLElement);

    closeSheet(dialog, debt); // nothing owed yet — the toggle is still in flight
    expect(seen).toHaveLength(0);
    debt.changed(); // …and lands now
    expect(seen.map((d) => d.live)).toEqual([false]);
  });
});
