// A jot that arrived from the ✚ — plan 45 · Piece 2.
//
// The capture dialog's tab row DECLARES a destination; it never becomes that
// destination's form. So `Agenda →` parks the thought as a note and navigates
// to the room that owns it, carrying nothing but the jot's id. This module is
// the other end of that trip, and both agenda rooms need exactly the same two
// halves of it:
//
//   · on arrival — read the sentence, then open the room's own sheet prefilled
//   · on save    — consume the jot, but only if nobody else already did
//
// ⚠ ONE MODULE FOR TWO CALLERS, WHICH 14 §10d's RULE WOULD NORMALLY DEFER.
// That rule declined to extract a shared log box until a third caller appeared,
// and the reason was that the two implementations DIFFERED — one component
// would have had to carry two person models. These two do not differ by a
// character: same parse, same dispatch, same consume, same failure. Copying
// them would be re-earning one bug in two places on a schedule of its own,
// which is the argument 14 §10b made for extracting `pop-anchor.ts`.
import { actions } from 'astro:actions';
import { callAction } from './action-error';

/** Where the KindBar's "make it an event/task instead" switch has to land. */
const ROOM = { task: '/admin/agenda/tasks', event: '/admin/agenda' } as const;

/**
 * Tell the page a jot was filed, and consume it if nothing else will.
 *
 * ⚠ THE EVENT IS CANCELABLE, AND THE CANCELLATION IS A HANDSHAKE. In the notes
 * room the pile owns what happens next: it trashes the jot, raises the undo
 * strip and adds the way onward (14 §10e). Everywhere else — a jot filed from
 * the ✚, which lands you in the agenda — nobody is listening, and an unclaimed
 * announcement would leave the task written and the jot still sitting in the
 * pile. So the pile calls `preventDefault()` to say *I have this*, and an
 * uncancelled event means the sheet consumes the jot itself.
 *
 * Sniffing the pile's markup (`#notes-pile`) was the alternative and was
 * declined: it makes one room's DOM into another module's contract, and it
 * would go on being true after the pile stopped listening.
 *
 * ⚠ THE ORDER IS 14 §10e's, UNCHANGED: the destination is written before this
 * is called, so a failure here leaves a jot still in the pile — which you can
 * see and delete — rather than a thought that went nowhere.
 */
export async function announceFiled(detail: {
  noteId: string;
  what: string;
  href: string | null;
  undo: { kind: 'task' | 'interaction' | 'event'; id?: string };
}): Promise<void> {
  const claimed = !document.dispatchEvent(new CustomEvent('hq:note-filed', { cancelable: true, detail }));
  if (claimed) return;

  const fd = new FormData();
  fd.set('ids', detail.noteId);
  fd.set('op', 'trash');
  const { error } = await callAction(actions.fragments.bulk(fd));
  // Reported to the console rather than to the screen: the sheet has closed on
  // a save that genuinely succeeded, and the honest summary — "it is written,
  // and your jot is still in the pile" — is what the pile itself will show you.
  if (error) console.error('[a jot filed from the ✚] it saved; the jot is still in the pile', error);
  // The room's list is a function of the row that just changed.
  location.reload();
}

/**
 * Open this room's sheet on a jot the ✚ sent here.
 *
 * ⚠ THE PARSE HAPPENS IN THIS ROOM, NOT IN THE DIALOG, and that is where the
 * 1.5–4s belongs. The ✚ exists so the gap between having a thought and saving
 * it is as short as possible; making it wait on a model before it will even let
 * go of you would spend that budget in the one place plan 14 refuses to.
 *
 * ⚠ AND A FAILED PARSE IS NOT AN ERROR STATE. No key, a dead model, a slow
 * network — the sheet still opens, on the naive first-line/rest split TaskSheet
 * already falls back to. 14 §6.4: capture must never depend on the model.
 */
export function wireJotArrival(sheet: HTMLElement, openEvent: 'hq:task-open' | 'hq:event-open'): void {
  const noteId = sheet.dataset.seedFrom;
  const text = sheet.dataset.seedBody;
  // No seed means this page was not arrived at from the ✚ — including the notes
  // room, which mounts these same sheets and owns the whole motion itself. That
  // check is what keeps this module inert there rather than fighting the pile.
  if (!noteId || !text) return;

  // The switch inside KindBar is the ONE affordance a room can offer and not
  // honour: the tasks room mounts no EventSheet and the calendar mounts no
  // TaskSheet, so here it is a door to the other room carrying the same jot,
  // rather than a control that quietly does nothing.
  document.addEventListener('hq:kind-switch', (e) => {
    const to = (e as CustomEvent<{ to: 'task' | 'event' }>).detail.to;
    window.location.href = `${ROOM[to]}?from=${encodeURIComponent(noteId)}`;
  });

  void (async () => {
    const { data } = await callAction(actions.tasks.parse({ text }));
    const parsed = (data?.parsed as Record<string, unknown> | null) ?? null;
    document.dispatchEvent(new CustomEvent(openEvent, { detail: { noteId, text, parsed, why: data?.why ?? '' } }));
  })();

  // ⚠ SCRUBBED, so a refresh does not re-open a sheet on a jot this save may
  // already have consumed. Same reason the quote room scrubs its own `from=`.
  const url = new URL(window.location.href);
  url.searchParams.delete('from');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
