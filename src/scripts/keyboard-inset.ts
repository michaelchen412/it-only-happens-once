// `--kb` — how much of the window the software keyboard is currently covering.
//
// WHY THIS HAS TO BE MEASURED. A phone keyboard does not resize the layout
// viewport: `innerHeight` is the same with it up as with it down, `100vh` and
// `100dvh` both still mean the whole window, and a `<dialog>` sized to any of
// them extends underneath it. The bottom of the writing sheet was therefore
// always behind the keyboard, which is what made editing near the end of a
// piece feel stuck — Michael, 2026-08-17: *"if you edit near the bottom, the
// point of focus gets hard to scroll because we've reached the bottom. Have to
// click out and click in again."*
//
// That is exactly what a missing inset looks like from the inside. The scroll
// container ran to the foot of the window, so its last scrollable pixel was
// under the keyboard; there was no runway left to lift the caret with, and
// `scrollIntoView` had nowhere to go. Clicking out dismissed the keyboard,
// which re-laid-out the page, and clicking back in re-ran the caret scroll
// against a geometry that finally had room — the workaround was the diagnosis.
//
// `visualViewport` is the only thing that knows. It is the one part of the
// platform that reports what is actually VISIBLE rather than what is laid out,
// and it is Baseline everywhere this site runs.
const root = document.documentElement;
const vv = window.visualViewport;

let queued = 0;

function measure(): void {
  if (!vv) return;
  // ⚠ PINCH-ZOOM PRODUCES THE SAME ARITHMETIC AS A KEYBOARD and means nothing
  // like it: zoomed in, the visual viewport is legitimately smaller than the
  // layout viewport and the difference is not an obstruction. Sizing sheets to
  // it would shrink them under a reader who is only trying to look closer.
  // `scale` is what separates the two cases.
  const inset = vv.scale > 1.01 ? 0 : Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  // Small differences are browser chrome sliding in and out — the URL bar on
  // scroll — not a keyboard. Reacting to those would resize every open sheet
  // on an ordinary flick. A keyboard is never this short.
  root.style.setProperty('--kb', `${inset > 120 ? Math.round(inset) : 0}px`);
}

function schedule(): void {
  if (queued) return;
  queued = requestAnimationFrame(() => {
    queued = 0;
    measure();
  });
}

if (vv) {
  // `scroll` as well as `resize`: iOS scrolls the visual viewport to follow a
  // focused field, which changes `offsetTop` without changing `height` — and
  // that shifts where the keyboard's top edge falls relative to the layout.
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  measure();
}
