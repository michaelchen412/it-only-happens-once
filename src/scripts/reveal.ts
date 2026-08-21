// Reveal's behaviour — the pairing of a trigger with its popover, and the
// placement of the box once it opens. The markup and the register live in
// `components/Reveal.astro`; only the mechanics are here.
//
// ⚠ IT IS A MODULE RATHER THAN A COMPONENT `<script>` BECAUSE A COMPONENT
// SCRIPT IS NOT GUARANTEED TO RUN WHERE ITS MARKUP APPEARS. Astro emits a
// component's script beside the component, and on `/blog` every Reveal on the
// page is authored INSIDE a reader `<template>` — so the script tag is in
// there too, and nothing on the feed executes it until a template is cloned.
// That was survivable while the Reader only ever cloned templates. It stopped
// being survivable when the Reader learned to FETCH a permalink instead
// (Reader.astro, `fetchArticle`): scripts in a `DOMParser` document are marked
// "already started" by the spec, so the copy that arrives inside a fetched
// essay can never run, and on a page whose only other copy is sealed in a
// template, the pairing code never runs AT ALL. Measured in production
// 2026-08-21: `/blog#read=<a slug not on the current feed page>` opened a
// perfectly rendered closing strip whose "1 constellation" and "7 related"
// were dead text — no underline, no popover, nothing on click.
//
// Exported as an init so the surfaces that can materialise this markup import
// it deliberately (see Reader.astro) instead of hoping for a script tag.

/** Idempotent: the flag lives on <html>, which survives view transitions. */
export function initReveal() {
  if (document.documentElement.dataset.rvBound) return;
  document.documentElement.dataset.rvBound = '1';

  // One observer for every instance on the page, so this pairs by walking the
  // DOM rather than by id.
  //
  // ⚠ AND IT PAIRS LATE ARRIVALS TOO, WHICH IS NOT BELT-AND-BRACES. A quote
  // stanza in a constellation opens its apparatus in the Reader, and the Reader
  // fills itself by CLONING a `<template>` or by importing a FETCHED article
  // (Reader.astro). Template content lives in a separate DocumentFragment, so
  // `document.querySelectorAll` never sees it — a Reveal authored inside one
  // would be skipped at parse time and still be unpaired after the clone
  // landed. The trigger would render, do nothing when pressed, and never show
  // its underline, because `[data-rv-live]` is exactly the gate that says "the
  // script got here".
  //
  // Timestamp does not have this problem and the difference is worth naming: it
  // wires its popover DECLARATIVELY (`popovertarget` + CSS anchor positioning),
  // so a clone arrives already working. This control cannot — it mints no
  // server-side id, on purpose, so two instances can never collide — so the
  // pairing is JS and the JS has to go looking.
  function pair(host: HTMLElement) {
    if (host.hasAttribute('data-rv-live')) return; // idempotent: clones re-enter here
    const trigger = host.querySelector<HTMLButtonElement>('.rv__trigger');
    const pop = host.querySelector<HTMLElement>('.rv__pop');
    if (!trigger || !pop) return;

    // ⚠ `popoverTargetElement`, NOT a manual showPopover() on click. That was
    // the bug the lab surfaced: an `auto` popover light-dismisses on any outside
    // pointerdown, so clicking the trigger while it was open CLOSED it and then
    // the handler REOPENED it — the control could be opened and never shut from
    // the same spot. Handing the pairing to the browser fixes it properly: the
    // spec exempts the invoker from light-dismiss and then toggles, so the same
    // click that opened it closes it.
    trigger.popoverTargetElement = pop;
    trigger.setAttribute('aria-expanded', 'false');
    host.setAttribute('data-rv-live', '');

    // Below `sm` a wide popover is a bottom sheet, positioned by CSS alone. JS
    // must not only skip placing it — it must CLEAR anything it wrote at a wider
    // viewport, or an inline `left` from before a rotation outlives the media
    // query that stopped applying.
    const isSheet = () => pop.classList.contains('rv__pop--wide') && matchMedia('(max-width: 639px)').matches;

    const place = () => {
      if (isSheet()) {
        pop.style.removeProperty('left');
        pop.style.removeProperty('top');
        pop.style.removeProperty('max-height'); // the sheet's 55vh is CSS's to decide
        return;
      }
      const r = trigger.getBoundingClientRect();

      // ⚠ BELOW FIRST — a correction, not a default. The usual tooltip habit is
      // to prefer above when there is room, and the reveal-lab bench showed why
      // that is wrong here: the attribution sits directly beneath the quote, so
      // "above" covers the words being read. Below opens into the gap before the
      // next one.
      //
      // ⚠ AND A TALL BOX IS CAPPED RATHER THAN FLIPPED. The old rule measured
      // the popover and moved it above whenever it did not fit — which on a
      // quote page means laying a list of links across the line the reader came
      // for. Bounding it to the room that exists keeps it below and lets it
      // scroll instead.
      //
      // ⚠ `USABLE` IS DELIBERATELY LOW (90px, ~one row and a scrollbar), and the
      // low number IS the decision. At 1280×720 a quote page's strip sits at
      // y≈583, leaving 121px below and 547px above; a threshold that called 121
      // "too small" flipped the box up and covered the quote — measured, and
      // caught by an e2e assertion after a fixed 17rem cap had already failed
      // the same way one viewport over. Between a cramped box and a covered
      // line, the line wins every time: it is the only thing on the page that
      // cannot be scrolled into view again. Above survives only for a trigger
      // genuinely at the viewport floor, where below would show nothing at all.
      const GAP = 8;
      const USABLE = 90;
      const roomBelow = window.innerHeight - r.bottom - GAP * 2;
      const roomAbove = r.top - GAP * 2;
      const below = roomBelow >= USABLE || roomBelow >= roomAbove;
      pop.style.maxHeight = `${Math.max(USABLE, below ? roomBelow : roomAbove)}px`;

      // Measured AFTER the cap, or the width is read from a box that is about to
      // reflow — and this is the measurement the right-edge clamp depends on.
      const p = pop.getBoundingClientRect();
      pop.style.left = `${Math.min(Math.max(8, r.left - 8), window.innerWidth - p.width - 8)}px`;
      pop.style.top = below ? `${r.bottom + GAP}px` : `${r.top - p.height - GAP}px`;
    };

    // ⚠ PLACED TWICE, AND THE SECOND TIME IS A BUG FIX RATHER THAN CAUTION.
    //
    // `beforetoggle` fires while the popover is still `display: none`, so
    // `getBoundingClientRect()` there returns 0×0. Measured at 390px: w=0 at
    // beforetoggle, w=269 at toggle. Both of place()'s corrections read that
    // zero and therefore do nothing:
    //   · the right-edge clamp becomes `innerWidth - 0 - 8`, a no-op, so the box
    //     is positioned purely at `r.left - 8` and runs off-screen whenever the
    //     trigger is right of centre;
    //   · `roomBelow` compares against `p.height + 16` = 16, so it is true
    //     essentially always and the box never flips above near the floor.
    //
    // QuoteReveal shipped with both and neither ever showed, because its only
    // trigger is an attribution at the left edge of the measure — verified on
    // /blog?view=quotes at 390px, where the citation lands at left=25 and fits
    // by position rather than by the clamp written to save it. The quote page's
    // strip is what exposes it: a control at the right-hand end of a line,
    // opening a wider box.
    //
    // `beforetoggle` still runs first, because it is what stops the flash at
    // 0,0 — it fires synchronously with the state change where `toggle` is
    // queued. So: place blind for a flash-free first paint, then again with real
    // numbers. The correction is sub-pixel whenever the blind guess was fine.
    pop.addEventListener('beforetoggle', (e) => {
      const opening = (e as ToggleEvent).newState === 'open';
      if (opening) place();
      trigger.setAttribute('aria-expanded', String(opening));
    });
    pop.addEventListener('toggle', (e) => {
      if ((e as ToggleEvent).newState === 'open') place();
    });

    // Scroll and resize move the anchor out from under a fixed-position box.
    // Reposition rather than close: closing on scroll would make it impossible
    // to read a long citation on a phone, where reading IS scrolling.
    //
    // ⚠ THE SCROLL LISTENER CAPTURES AT THE DOCUMENT, AND `window` WAS NOT
    // ENOUGH. A scroll event does not bubble, so a listener on `window` hears
    // the page scrolling and nothing else — and inside the Reader the page does
    // not scroll at all: `<html>` is locked and `.reader-scroll` is the
    // scroller. Measured in production 2026-08-21: an open popover kept its
    // 8px gap under the trigger while the sheet moved 250px beneath it, ending
    // up 242px ADRIFT and still open. Capture phase hears every scroller in the
    // document, which is what this always meant.
    document.addEventListener('scroll', () => pop.matches(':popover-open') && place(), {
      passive: true,
      capture: true,
    });
    window.addEventListener('resize', () => pop.matches(':popover-open') && place(), { passive: true });
  }

  const pairAll = (root: ParentNode) => root.querySelectorAll<HTMLElement>('[data-rv]').forEach(pair);

  pairAll(document);
  // Content that arrives after parse: the Reader's clone or fetched article, and
  // a view-transition swap. Cheap — `pair` returns on its first line for
  // anything already live, and the observer only fires on real DOM insertions.
  new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches('[data-rv]')) pair(node);
        pairAll(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('astro:page-load', () => pairAll(document));
}
