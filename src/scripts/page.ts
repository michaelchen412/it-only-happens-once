// A room that still works when you walk back into it (plan 24 · §9).
//
// ⚠ THE RULE THE OBSERVATORY NOW LIVES UNDER, in one sentence: **a module runs
// once per DOCUMENT, and `<ClientRouter />` does not make new documents.** Astro
// says it plainly:
//
//   "Bundled module scripts, which are the default scripts in Astro, are only
//    ever executed once. After initial execution they will be ignored, even if
//    the script exists on the new page after a transition."
//
// So the body is swapped and no module re-runs. Everything bound to a page
// element is now bound to an element that has been thrown away, and the room
// looks perfect and does nothing.
//
// ⚠⚠ THE FIRST VISIT MASKS ALL OF IT, which is what makes this worth a file of
// its own rather than a rule in a comment. Astro DOES execute scripts that are
// new to the page (step 7 of its navigation process), so walking into a room for
// the first time runs its module and everything works. Walk out and back and it
// does not run again. Measured 2026-09-18 with the router on: the pile, the
// Library and the manager all passed a single-visit probe and were dead on the
// second visit. A bug that only appears the second time you visit somewhere is
// one nobody reports crisply — it reads as "it sometimes doesn't work".
//
// ── THE TWO FAILURES, WHICH ARE OPPOSITES ──────────────────────────────────
//
//   · a listener on a PAGE ELEMENT **dies** — the element is gone
//   · a listener on `document` or `window` **accumulates** — those survive the
//     swap, so re-registering on each arrival leaves N copies after N visits
//
// The second is much the worse of the two and the only one that can corrupt
// anything: one press files a note twice, opens two dialogs, sends two writes.
// Nothing looks wrong until the second one lands.
//
// `onPage` answers both. The boot re-runs on every arrival, so element bindings
// are fresh; and anything registered through the `page.on` it hands you is
// removed again on the way out, so document listeners never stack up.
//
// ⚠ WHY A SCOPE OBJECT RATHER THAN A `key` STRING. The other shape considered
// was `onDoc('notes:filed', 'hq:note-filed', fn)`, de-duplicating by key — and
// it fails open: a typo in a key is a duplicate listener, silently, which is the
// exact bug this exists to prevent. A handle that collects what it registered
// cannot be typo'd.

/** What a boot may bind to things that outlive the page. */
export interface PageScope {
  /**
   * A listener that is taken off again when you leave this page.
   *
   * ⚠ USE IT FOR `document` AND `window`, ALWAYS. A listener on a page element
   * does not need it — the element is discarded with the body, and the listener
   * with it — but using it there too is harmless and means the rule is "every
   * listener inside a boot goes through `page.on`" rather than a judgement call
   * about which target survives a swap.
   */
  on<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    handler: (e: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions | boolean,
  ): void;
  on<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    handler: (e: DocumentEventMap[K]) => void,
    opts?: AddEventListenerOptions | boolean,
  ): void;
  /*
    ⚠ THE THIRD OVERLOAD IS WHAT CUSTOM EVENTS LAND ON. `hq:note-filed`,
    `writing:edit` and the rest are not in either DOM event map, so the handler
    is typed `Event` and each caller casts to the `CustomEvent<…>` it expects —
    exactly what these call sites already did before the router existed.
  */
  on(
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    opts?: AddEventListenerOptions | boolean,
  ): void;
  /**
   * Anything else that must be undone on the way out — a timer, an observer, a
   * subscription. Called once, in registration order, at the next arrival.
   */
  cleanup(undo: () => void): void;
}

/**
 * Run `boot` on first load and after every client-side arrival.
 *
 * ⚠ IT IS NOT ALSO CALLED DIRECTLY, and that is not an oversight: `astro:page-load`
 * fires on the initial document load too ("Runs on both initial page load and
 * every subsequent navigation"). Calling `boot()` beside this would double every
 * binding on the very first page — the accumulate bug, introduced by the thing
 * meant to fix it.
 *
 * ⚠ AND IT IS SAFE ON A PAGE THE SCRIPT DOES NOT BELONG TO. Once loaded, a
 * module stays loaded for the life of the document, so its boot fires on every
 * arrival anywhere in the building. Every boot therefore has to start by looking
 * for its own elements and returning when they are absent — which is the
 * `if (!el) return` that most of these scripts already had as a module-scope
 * guard, now doing a second job.
 */
export function onPage(boot: (page: PageScope) => void): void {
  let bin: (() => void)[] = [];

  document.addEventListener('astro:page-load', () => {
    // Leaving happens first, and it happens even if the last boot threw —
    // otherwise one bad arrival leaks its listeners for the rest of the session.
    for (const undo of bin) {
      try {
        undo();
      } catch {
        /* a cleanup that fails must not stop the others, or block this arrival */
      }
    }
    bin = [];

    const page: PageScope = {
      on(
        target: EventTarget,
        type: string,
        handler: EventListenerOrEventListenerObject,
        opts?: AddEventListenerOptions | boolean,
      ) {
        target.addEventListener(type, handler, opts);
        bin.push(() => target.removeEventListener(type, handler, opts));
      },
      cleanup(undo) {
        bin.push(undo);
      },
    };

    boot(page);
  });
}
