// Promise-based styled confirmation, replacing native confirm() across the
// admin. Drives the single <ConfirmDialog /> rendered in AdminLayout.
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
  el<HTMLButtonElement>('confirm-ok').addEventListener('click', () => dialog.close('ok'));
  el<HTMLButtonElement>('confirm-cancel').addEventListener('click', () => dialog.close('cancel'));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close('cancel'); // backdrop
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
    dialog.showModal();
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
