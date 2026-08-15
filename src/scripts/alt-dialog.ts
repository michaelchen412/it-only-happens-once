// Drives AltTextDialog.astro — the "what does this picture show" prompt.
//
// Returns a function the editor can await. Three outcomes, and they're
// genuinely different:
//   'Save description' → the trimmed text
//   'Leave empty'      → '' (an explicit choice; a decorative image is alt="")
//   Escape / backdrop  → null, meaning "don't change anything"
// The editor relies on that distinction: null on insert means empty, but null
// when re-editing means leave the existing description alone.
import { closeWithExit, openDialog } from './dialog-close';

export type AskAlt = (current: string) => Promise<string | null>;

export function wireAltDialog(dialog: HTMLDialogElement): AskAlt {
  const field = dialog.querySelector('.alt-text') as HTMLInputElement;
  const apply = dialog.querySelector('.alt-apply') as HTMLButtonElement;
  const skip = dialog.querySelector('.alt-skip') as HTMLButtonElement;
  let resolveCurrent: ((v: string | null) => void) | null = null;

  // The three outcomes above, spelled as `returnValue` — set BEFORE leaving,
  // because `close()` with no argument preserves whatever is already there and
  // `closeWithExit` owns the call now.
  const close = (how: string) => {
    dialog.returnValue = how;
    void closeWithExit(dialog);
  };
  apply.addEventListener('click', () => close('apply'));
  skip.addEventListener('click', () => close('skip'));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close(''); // backdrop → cancel
  });
  // Escape, intercepted for the same reason confirm-dialog.ts intercepts it:
  // the native `cancel` shuts in one frame, which would make this the one
  // dialog that animates away from a click and snaps away from a keystroke.
  // Empty `returnValue` is what the native close left behind, so → null.
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close('');
  });
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      close('apply');
    }
  });
  // Fires for the buttons AND for Escape, where returnValue stays '' → null.
  dialog.addEventListener('close', () => {
    const done = resolveCurrent;
    resolveCurrent = null;
    done?.(dialog.returnValue === 'apply' ? field.value.trim() : dialog.returnValue === 'skip' ? '' : null);
  });

  // One dialog element, so prompts take turns — pasting three images at once
  // would otherwise clobber the visible text and strand the first promise.
  // Same reasoning as confirm-dialog.ts.
  let queue: Promise<unknown> = Promise.resolve();
  return (current) => {
    const run = queue.then(
      () =>
        new Promise<string | null>((resolve) => {
          resolveCurrent = resolve;
          field.value = current;
          dialog.returnValue = '';
          openDialog(dialog);
          field.focus();
          field.select();
        }),
    );
    queue = run.catch(() => {});
    return run;
  };
}
