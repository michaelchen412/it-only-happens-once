// Promise-based styled confirmation, replacing native confirm() across the
// admin. Drives the single <ConfirmDialog /> rendered in AdminLayout.
//
// ⚠ IT RESOLVES AFTER THE EXIT, NOT AT THE CLICK (2026-08-15), and that is a
// deliberate 0.2s rather than an accident of the conversion. Every caller's next
// move is destructive and visible — a fragment leaves a list, a merge redraws
// the library — and landing that repaint while the dialog is still fading puts
// the answer on screen through a half-transparent modal. `returnValue` is set
// before the close so `close()` with no argument carries it, and the `close`
// event still resolves the promise; only the moment moved.
import { closeWithExit, openDialog } from './dialog-close';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  /** Style the confirm button as destructive and default focus to Cancel. */
  danger?: boolean;
}

let resolveCurrent: ((ok: boolean) => void) | null = null;
let wired = false;

function el<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}

function wire() {
  if (wired) return;
  wired = true;
  const dialog = el<HTMLDialogElement>('confirm-dialog');
  /** Set the answer, then leave — `close()` with no argument keeps it. */
  const answer = (value: string) => {
    dialog.returnValue = value;
    void closeWithExit(dialog);
  };
  el<HTMLButtonElement>('confirm-ok').addEventListener('click', () => answer('ok'));
  el<HTMLButtonElement>('confirm-cancel').addEventListener('click', () => answer('cancel'));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) answer('cancel'); // backdrop
  });
  // ⚠ ESCAPE HAS TO BE INTERCEPTED NOW THAT THE EXIT IS OURS. The native
  // `cancel` closes in the same frame, which is the one path that would still
  // snap shut — and it would do it inconsistently, so the same dialog animated
  // away from a click and vanished from a keystroke. `preventDefault` hands the
  // key to `answer`, which leaves `returnValue` empty exactly as the native
  // close did, so this still resolves false.
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    answer('');
  });
  // Fires on button close AND on Escape (returnValue stays '' → false).
  dialog.addEventListener('close', () => {
    const done = resolveCurrent;
    resolveCurrent = null;
    done?.(dialog.returnValue === 'ok');
  });
}

function show(opts: ConfirmOptions): Promise<boolean> {
  wire();
  const dialog = el<HTMLDialogElement>('confirm-dialog');
  el('confirm-title').textContent = opts.title ?? 'Are you sure?';
  el('confirm-message').textContent = opts.message;
  const ok = el<HTMLButtonElement>('confirm-ok');
  const cancel = el<HTMLButtonElement>('confirm-cancel');
  ok.textContent = opts.confirmLabel ?? 'Confirm';
  ok.classList.toggle('btn-error', !!opts.danger);
  ok.classList.toggle('btn-primary', !opts.danger);
  dialog.returnValue = '';

  return new Promise((resolve) => {
    resolveCurrent = resolve;
    openDialog(dialog);
    // Default focus to the safe action for destructive prompts.
    (opts.danger ? cancel : ok).focus();
  });
}

// There is one dialog element, so prompts must take turns: a second call
// while one is open would clobber the visible text and make showModal throw,
// stranding the first caller's promise. Queue instead — each prompt shows
// after the previous one resolves.
let queue: Promise<unknown> = Promise.resolve();

/** Show the confirm modal; resolves true only if the user confirms. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const result = queue.then(() => show(opts));
  queue = result.catch(() => {});
  return result;
}
