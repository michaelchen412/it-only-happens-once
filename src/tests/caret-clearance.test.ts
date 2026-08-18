// `src/scripts/caret-reveal.ts` — the margin the caret keeps from either edge.
//
// ⚠ THE ONLY PART OF THAT FILE A TEST CAN REACH, and the part worth reaching.
// The rest is a rAF wired to four events; this is the decision — how much air,
// which edge wins, and when to do nothing — and it is exactly the kind of
// arithmetic that goes quietly wrong the next time somebody adjusts a number.
// The bug it exists for (a caret painted over the phone's docked toolbar) is
// otherwise reproducible only by holding an iPhone.
import { describe, it, expect } from 'vitest';
import { caretDelta } from '../scripts/caret-reveal';

/** A 20px line, i.e. 30px of clearance owed at each edge. */
const line = (top: number) => ({ top, bottom: top + 20 });
/** A phone-sized scrollport with the keyboard up: 300px of visible document. */
const port = { top: 100, bottom: 400 };

describe('caretDelta — a caret with room to spare', () => {
  it('does nothing when the caret is in the middle of the band', () => {
    expect(caretDelta(line(200), port)).toBe(0);
  });

  it('does nothing at exactly the clearance, because the margin is satisfied', () => {
    // Bottom edge: 400 - 30 = 370, so a line ending at 370 is legal.
    expect(caretDelta(line(350), port)).toBe(0);
    // Top edge: 100 + 30 = 130, so a line starting at 130 is legal.
    expect(caretDelta(line(130), port)).toBe(0);
  });

  it('ignores a sub-pixel breach rather than fighting the browser over rounding', () => {
    // One pixel past the floor. Correcting this every frame is how a scroller
    // ends up jittering against the engine's own reveal.
    expect(caretDelta(line(351), port)).toBe(0);
  });
});

describe('caretDelta — a caret against an edge', () => {
  it('pushes the document up when the caret is flush against the toolbar', () => {
    // ⚠ THIS IS THE BUG. WebKit reveals the caret to the bottom of the
    // scrollport and stops; the scrollport's bottom edge IS the docked
    // toolbar's top edge, so "revealed" and "under the buttons" are the same
    // pixel. A line ending at 400 owes the full 30.
    expect(caretDelta(line(380), port)).toBe(30);
  });

  it('recovers a caret that the keyboard scrolled clean out of the band', () => {
    // The resize race: the sheet shrank under a caret that was legal a frame
    // ago, and it is now below the scrollport entirely.
    expect(caretDelta(line(430), port)).toBe(80);
  });

  it('pulls the document down when the caret is under the chrome', () => {
    expect(caretDelta(line(90), port)).toBe(-40);
  });
});

describe('caretDelta — clearance scales with the line', () => {
  it('gives a heading more room than body text, from one number', () => {
    // A 48px heading owes 72 either side, so it is already illegal where a
    // 20px line would have been fine.
    const heading = { top: 340, bottom: 388 };
    expect(caretDelta(heading, port)).toBe(60);
    expect(caretDelta(line(340), port)).toBe(0);
  });

  it('floors a zero-height rect so a mid-layout frame cannot ask for 0 clearance', () => {
    // Without MIN_LINE this returns 0 — the caret sits exactly on the floor and
    // the function calls that fine, which is the failure it exists to prevent.
    expect(caretDelta({ top: 400, bottom: 400 }, port)).toBe(24);
  });
});

describe('caretDelta — bands that cannot hold the margin', () => {
  it('leaves a too-short scrollport alone instead of oscillating', () => {
    // 40px of visible document cannot hold 30 of margin at each end. Any answer
    // here is wrong, so the honest one is to not move.
    expect(caretDelta(line(200), { top: 190, bottom: 230 })).toBe(0);
  });

  it('serves the bottom edge first when a caret breaks both at once', () => {
    // A 60px line owes 90 either side, so inside a 200px band the legal strip is
    // only 20px tall and a line straddling it breaks the ceiling AND the floor.
    // Bottom wins: the line you are writing on beats the ascenders you are not.
    // (The top-only correction it declines would have been -20.)
    expect(caretDelta({ top: 170, bottom: 230 }, { top: 100, bottom: 300 })).toBe(20);
  });
});
