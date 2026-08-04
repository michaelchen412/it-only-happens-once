// The floating "back to top" control, for the window OR any scroll container.
//
// The page-level version listens to window scroll; but every long surface in
// this site scrolls INSIDE something — the Reader's `.reader-scroll`, the
// browser sheet's panel, the writing sheet's document — where window scroll
// never fires. So the button names its scroller with `data-scroller` (a
// selector) and this wires whichever applies.
//
// Self-wiring: import once per page and every `[data-back-to-top]` on it is
// handled, including ones inside dialogs that open later.

const THRESHOLD = 600; // px scrolled before it earns its place

type Scroller = HTMLElement | Window;

function scrollTopOf(s: Scroller): number {
  return s === window ? window.scrollY : (s as HTMLElement).scrollTop;
}

function wire(btn: HTMLElement) {
  const sel = btn.dataset.scroller;
  const scroller: Scroller = sel ? ((document.querySelector(sel) as HTMLElement | null) ?? window) : window;
  if (btn.dataset.btWired) return;
  btn.dataset.btWired = '1';

  // Toggle at most once per frame — cheap on the scroll hot path.
  let ticking = false;
  const update = () => btn.classList.toggle('is-visible', scrollTopOf(scroller) > THRESHOLD);
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      update();
      ticking = false;
    });
  };

  btn.addEventListener('click', () => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const opts: ScrollToOptions = { top: 0, behavior: reduce ? 'auto' : 'smooth' };
    scroller === window ? window.scrollTo(opts) : (scroller as HTMLElement).scrollTo(opts);
  });

  scroller.addEventListener('scroll', onScroll, { passive: true });
  update();
}

export function wireBackToTop(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-back-to-top]').forEach(wire);
}

wireBackToTop();
// A view-transition navigation swaps the document — re-wire and re-evaluate.
document.addEventListener('astro:page-load', () => wireBackToTop());
