// NOTHING IN THIS PROJECT EVER RENDERS UTC — a standing rule (Michael,
// 2026-08-02), and this is the mechanism that keeps it.
//
// The problem is structural rather than a slip. Pages render on a server whose
// clock is UTC, so any date formatted there is in UTC unless something says
// otherwise — and "Saved 12:41 AM" in UTC is not a time the reader was ever
// awake for. It looks like a real time, which is what makes it worth a
// mechanism instead of a code review.
//
// THE PATTERN: render a real `<time datetime="…">` carrying the instant, with a
// server-side fallback already in the CONFIGURED HOME ZONE (never UTC, so the
// no-JavaScript rendering is wrong by at most a few hours of travel rather than
// by a working day). Then this rewrites it into the zone the device is actually
// in, which is the only zone that answers "when did I do that?".
//
// ⚠ THIS IS DISPLAY ONLY, and the distinction is load-bearing: the browser may
// say what o'clock it was, but it never says what DAY it was. The day boundary
// stays server-side, on the configured zone, because scheduled work has no
// browser and a laptop with a stale clock must not be able to move it.
//
//   <time datetime={iso} data-local="time">7:02 AM</time>       → 7:02 AM
//   <time datetime={iso} data-local="datetime">…</time>         → Aug 1, 7:02 AM
//
// `data-local="time"` still adds the date when the instant is not today, since
// a bare clock time on a stamp from last week is actively misleading.
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
const DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function renderLocalTimes(root: ParentNode = document): void {
  root.querySelectorAll<HTMLTimeElement>('time[data-local]').forEach((el) => {
    const iso = el.getAttribute('datetime');
    if (!iso) return;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return;

    const wantsDate = el.dataset.local === 'datetime' || !sameDay(at, new Date());
    el.textContent = wantsDate
      ? `${at.toLocaleDateString('en-US', DATE)}, ${at.toLocaleTimeString('en-US', TIME)}`
      : at.toLocaleTimeString('en-US', TIME);
    // The full truth on hover, also local — a tooltip is not an excuse for UTC.
    el.title = at.toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      ...TIME,
    });
  });
}

renderLocalTimes();
