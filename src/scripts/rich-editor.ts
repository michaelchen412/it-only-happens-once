// Reusable TipTap editor (WYSIWYG that serializes to Markdown, ADR-0006).
//
// Extracted from the writing composer so the About builder can share the exact
// same editor + toolbar + link dialog. Everything is passed as ELEMENTS (not
// ids) so multiple editors can coexist on a page. The writing composer wraps
// this with its autosave/publish logic; the About builder wraps it with the
// page builder. Markdown is the stored value (`editor.storage.markdown`).
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import { ProofreadMarks, proofreadHandle, type ProofreadHandle } from './proofread-marks';
import { closeWithExit, openDialog } from './dialog-close';
import { keepCaretClear } from './caret-reveal';

export interface RichEditorHandle {
  editor: Editor;
  getMarkdown: () => string;
  /** Present only when `proofread` was asked for (docs/plans/22 · Piece 4). */
  proofread?: ProofreadHandle;
}

export interface RichEditorOptions {
  /** The element TipTap renders into. */
  editorEl: HTMLElement;
  /** Container holding the `.tt-btn` toolbar buttons (see EditorToolbar.astro). */
  toolbarRoot: HTMLElement;
  /**
   * The `<dialog>` from LinkDialog.astro (inner controls are class-scoped).
   * Optional: omit it for a slim, link-free toolbar — the link command becomes a
   * no-op and no dialog is required.
   *
   * ⚠ As of 2026-08-07 NO caller omits it. The only one that ever did was the
   * About page's interest-note editor, removed with its section (ADR-0020). Kept
   * optional rather than made required: it is a real affordance for the next slim
   * editor, and the alternative is a breaking signature change for zero gain. The
   * example is named here so nobody goes looking for a caller that exists.
   */
  linkDialog?: HTMLDialogElement | null;
  placeholder?: string;
  content?: string;
  ariaLabel?: string;
  /**
   * Treat a lone newline as a hard break, both ways through Markdown.
   *
   * ⚠ THE NOTE EDITORS NEED THIS AND AN ESSAY MUST NOT HAVE IT. Every dump
   * written before this editor was rich is plain text whose newlines carry its
   * shape — a list of errands, a stanza. Parsed with `breaks: false` those are
   * soft wraps, so opening one would silently glue it into a single paragraph
   * and the autosave would write that back. `mountMiniEditor` already made
   * this exact call for a quote and a song annotation; render the other end
   * with `renderMarkdown(body, { breaks: true })` to match.
   */
  breaks?: boolean;
  /**
   * Extra classes for the editable surface, beside `reading tiptap-doc`.
   * The surface is created by TipTap, so a caller that needs to style it (the
   * notes editors run at a jotting's scale, not an essay's) has no other hook.
   */
  docClass?: string;
  /** Called on every document change (the caller decides what to do). */
  onChange?: () => void;
  /**
   * Enables images (docs/plans/03). Omit and there is no image node at all —
   * the toolbar button, paste and drop all stay off, which is what the quote
   * and song editors want.
   */
  images?: ImageSupport;
  /**
   * Enables the proofreading decoration plugin (docs/plans/22 · Piece 4), and
   * with it `handle.proofread`.
   *
   * ⚠ OPT-IN, AND IT HAS TO BE. This function has five callers — the composer,
   * the capture box, the notes room, and two editors in the About builder (`me`
   * and `site`). Adding the plugin unconditionally would ship it into all of them,
   * four of which have no trigger for it and no chip to report into. Same shape as
   * `images` and `linkDialog` above, for the same reason.
   *
   * ⚠ The list was corrected 2026-08-07. It previously read "the interest notes
   * and three editors in the About builder" — two errors: `notes.ts` is the notes
   * room, never interest notes, and the About builder's third editor (the
   * per-interest note) is gone with ADR-0020. The count of five is right again by
   * coincidence, not because the list was.
   */
  proofread?: boolean;
}

export interface ImageSupport {
  /** Put the file somewhere public and return its URL. See scripts/upload.ts. */
  upload(file: File): Promise<string>;
  /** Ask for alt text. Resolve '' for "no alt"; the caller decides the UI. */
  askAlt?(current: string): Promise<string | null>;
  /** In-flight notice, then null. Uploads are slow enough to need one. */
  onStatus?(message: string | null): void;
  onError?(message: string): void;
}

/**
 * Marks the caller's element as an editor host (see admin.css `.tt-host`).
 *
 * Applied here rather than asked of every caller: the host is the element
 * TipTap builds its surface inside, so "make the surface fill the field" is a
 * fact about mounting, not a style each of the six call sites should have to
 * remember. Adding a class is also the only way to reach an element whose
 * classes are otherwise the caller's business.
 */
function markHost(el: HTMLElement) {
  el.classList.add('tt-host');
}

/**
 * Upload FIRST, insert on success — deliberately not the usual optimistic
 * placeholder.
 *
 * A placeholder means a `blob:` URL sits in the document while the upload runs,
 * and this editor autosaves 1.2s after you stop typing. That save would write
 * `![](blob:…)` into the database, where it is meaningless — and the public
 * sanitizer only permits http/https/data for `img`, so it would render as
 * nothing at all. Waiting keeps every state of the document a valid one.
 */
async function insertImages(editor: Editor, files: File[], img: ImageSupport) {
  if (!files.length) return;
  // Deliberately NOT filtered to image/* here. `upload` is the one validator,
  // and it explains itself — filtering first meant choosing a PDF from the
  // picker did nothing at all, with no error and no upload. Paste and drop do
  // filter, because there silence is right: a non-image belongs to
  // ProseMirror's default handler, not to an error message.
  img.onStatus?.(files.length > 1 ? `Uploading ${files.length} images…` : 'Uploading image…');
  try {
    for (const file of files) {
      const src = await img.upload(file);
      const alt = img.askAlt ? ((await img.askAlt('')) ?? '') : '';
      editor.chain().focus().setImage({ src, alt }).run();
    }
  } catch (e) {
    img.onError?.(e instanceof Error ? e.message : String(e));
  } finally {
    img.onStatus?.(null);
  }
}

export function mountRichEditor(opts: RichEditorOptions): RichEditorHandle {
  const img = opts.images;
  markHost(opts.editorEl);
  const editor = new Editor({
    element: opts.editorEl,
    extensions: [
      StarterKit,
      Markdown.configure({ breaks: opts.breaks ?? false, transformPastedText: true, transformCopiedText: true }),
      Placeholder.configure({ placeholder: opts.placeholder ?? 'Start writing…' }),
      // `inline: false` — an image is its own block, which is what
      // `![alt](src)` round-trips to and what the reading column wants.
      ...(img ? [Image.configure({ inline: false, allowBase64: false })] : []),
      ...(opts.proofread ? [ProofreadMarks] : []),
    ],
    content: opts.content || '',
    editorProps: {
      attributes: {
        class: `reading tiptap-doc focus:outline-none${opts.docClass ? ` ${opts.docClass}` : ''}`,
        'aria-label': opts.ariaLabel ?? 'Body',
      },
      // Paste and drop are the affordances that actually matter for writing —
      // a screenshot goes ⌘V, not through a file picker. Returning true claims
      // the event so ProseMirror doesn't also insert the file's name as text.
      handlePaste: img
        ? (_view, event) => {
            const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
            if (!files.length) return false;
            event.preventDefault();
            void insertImages(editor, files, img);
            return true;
          }
        : undefined,
      handleDrop: img
        ? (_view, event, _slice, moved) => {
            // `moved` means a node is being dragged WITHIN the document — that's
            // ProseMirror's job, not ours.
            if (moved) return false;
            const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) =>
              f.type.startsWith('image/'),
            );
            if (!files.length) return false;
            event.preventDefault();
            void insertImages(editor, files, img);
            return true;
          }
        : undefined,
    },
  });
  const getMarkdown = () =>
    (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

  // ⚠ EVERY EDITOR IN THE BUILDING GETS THIS, not just the writing sheet, and
  // that is why it is here rather than in the composer. A docked toolbar is a
  // phone problem the capture box has in exactly the same shape (`.cap-tools`
  // sits below `.cap-box` for the same reason `#ws-toolbar` does), and the rule
  // it enforces — the caret keeps a line and a half of air — is not a phone
  // rule at all. It is inert wherever there is no scrollport to be trapped in.
  keepCaretClear(editor, opts.editorEl);

  // ---- toolbar ----
  // Reassigned below when a link dialog is supplied; a no-op otherwise.
  let openLinkDialog = () => {};
  const cmds: Record<string, () => void> = {
    undo: () => editor.chain().focus().undo().run(),
    redo: () => editor.chain().focus().redo().run(),
    h2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    h3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    bold: () => editor.chain().focus().toggleBold().run(),
    italic: () => editor.chain().focus().toggleItalic().run(),
    strike: () => editor.chain().focus().toggleStrike().run(),
    blockquote: () => editor.chain().focus().toggleBlockquote().run(),
    bulletList: () => editor.chain().focus().toggleBulletList().run(),
    orderedList: () => editor.chain().focus().toggleOrderedList().run(),
    hr: () => editor.chain().focus().setHorizontalRule().run(),
    link: () => openLinkDialog(),
  };

  if (img) {
    // A throwaway input rather than markup: nothing else needs to know this
    // exists, and `accept="image/*"` is what makes iOS offer the camera —
    // which is the capture path a phone actually wants.
    cmds.image = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.addEventListener('change', () => {
        const files = Array.from(input.files ?? []);
        if (files.length) void insertImages(editor, files, img);
      });
      input.click();
    };

    // "Editable after": click an image to revise its alt text. The position is
    // resolved BEFORE awaiting the prompt — opening a <dialog> moves focus, and
    // resolving afterwards would risk pointing at whatever is selected then.
    // It also distinguishes two copies of the same picture, which
    // content-addressed paths make likely rather than exotic.
    if (img.askAlt) {
      opts.editorEl.addEventListener('click', (e) => {
        const el = (e.target as HTMLElement)?.closest?.('img');
        if (!el) return;
        const pos = editor.view.posAtDOM(el, 0);
        if (pos < 0) return;
        void img.askAlt!(el.getAttribute('alt') ?? '').then((next) => {
          if (next === null) return;
          editor.chain().focus().setNodeSelection(pos).updateAttributes('image', { alt: next }).run();
        });
      });
    }
  }
  const btns = Array.from(opts.toolbarRoot.querySelectorAll<HTMLButtonElement>('.tt-btn'));
  btns.forEach((b) => b.addEventListener('click', () => cmds[b.dataset.cmd!]?.()));

  function syncToolbar() {
    const active: Record<string, boolean> = {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      blockquote: editor.isActive('blockquote'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      link: editor.isActive('link'),
      h2: editor.isActive('heading', { level: 2 }),
      h3: editor.isActive('heading', { level: 3 }),
    };
    btns.forEach((b) => {
      const on = !!active[b.dataset.cmd!];
      b.classList.toggle('is-active', on);
      if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(on)); // toggles only
    });
  }
  editor.on('selectionUpdate', syncToolbar);
  editor.on('transaction', syncToolbar);
  if (opts.onChange) editor.on('update', opts.onChange);

  // ---- link dialog (optional; class-scoped within the passed dialog element) ----
  if (opts.linkDialog) {
    const linkDialog = opts.linkDialog;
    const linkUrl = linkDialog.querySelector('.link-url') as HTMLInputElement;
    const linkRemove = linkDialog.querySelector('.link-remove') as HTMLButtonElement;
    const linkApply = linkDialog.querySelector('.link-apply') as HTMLButtonElement;
    const linkCancel = linkDialog.querySelector('.link-cancel') as HTMLButtonElement;

    openLinkDialog = () => {
      const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
      linkUrl.value = prev;
      linkRemove.hidden = !prev;
      openDialog(linkDialog);
      linkUrl.focus();
      linkUrl.select();
    };
    // ⚠ THE EDITOR COMMAND FIRES WHILE THE DIALOG IS STILL FADING, and that is
    // right rather than sloppy. `closeWithExit` keeps this dialog open for 0.2s,
    // and the mark being set belongs to the document UNDERNEATH it — deferring
    // the chain until the fade ended would leave the words unlinked for a fifth
    // of a second, in full view, on the one gesture whose whole point is that
    // you can see it take.
    const leave = () => void closeWithExit(linkDialog);
    const applyLink = () => {
      const url = linkUrl.value.trim();
      leave();
      if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    };
    linkApply.addEventListener('click', applyLink);
    linkCancel.addEventListener('click', leave);
    linkRemove.addEventListener('click', () => {
      leave();
      editor.chain().focus().unsetLink().run();
    });
    linkDialog.addEventListener('click', (e) => {
      if (e.target === linkDialog) leave();
    });
    // Escape, intercepted so the keyboard exit animates like the other three.
    linkDialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      leave();
    });
    linkUrl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyLink();
      }
    });
  }

  return { editor, getMarkdown, proofread: opts.proofread ? proofreadHandle(editor) : undefined };
}

export interface MiniEditorOptions {
  editorEl: HTMLElement;
  /** Container holding THIS editor's `.tt-btn` buttons — its own toolbar only,
   *  so two mini editors can sit in one sheet without stealing each other's. */
  toolbarRoot: HTMLElement;
  placeholder?: string;
  ariaLabel?: string;
  onChange?: () => void;
  /**
   * Extra classes for the editable surface, beside `reading tiptap-doc` —
   * `mountRichEditor`'s option of the same name, and it is needed here for the
   * same reason it was needed there.
   *
   * ⚠ `reading` IS AN ESSAY'S TYPOGRAPHY: 1.15rem at 1.8, with 1.4em between
   * paragraphs. That is right for a quote, which is the whole point of the sheet
   * it sits in, and wrong for a field you fill in — mounted bare on the task
   * sheet's notes it came out half again the size of the title input above it.
   * `.f-prose` is the field register (hq.css), exactly the metrics of the
   * `.f textarea` it replaced; `.jot-prose` is the card one.
   */
  docClass?: string;
  /**
   * Treat a lone newline as a hard break, both ways through Markdown —
   * `mountRichEditor`'s option of the same name, and read its note for the why.
   *
   * ⚠ IT MUST MATCH THE RENDERER THIS FIELD IS READ BACK THROUGH, and that is
   * the whole reason it became a parameter (2026-08-20). It was hardcoded `true`
   * while every original caller happened to render with `{ breaks: true }`, so
   * nothing disagreed. The fields converted from plain textareas in plan 43 do
   * NOT all render that way — a goal's *why* is rendered `breaks: false` on the
   * stated reasoning that *"a why is prose, where a wrapped line is not a line
   * break"* — and mounting those at `true` would have made the editor show a
   * line break the page then silently closed up. A WYSIWYG that lies about one
   * character is worse than the textarea it replaced.
   *
   * Defaults to `true`, which is what the five callers that predate the option
   * were already getting.
   */
  breaks?: boolean;
}

/**
 * The short-form editor: bold and italic, line breaks preserved, no headings /
 * lists / rules. That's the register a quote's words and a song's annotation
 * share — a sentence or a few, never an essay — so the composer's full toolbar
 * would be noise. `breaks` defaults to true, which keeps a poem's line breaks
 * through the Markdown round-trip; pass false where the render side says false.
 *
 * Same handle as `mountRichEditor`, so callers serialize the same way.
 */
export function mountMiniEditor(opts: MiniEditorOptions): RichEditorHandle {
  markHost(opts.editorEl);
  const editor = new Editor({
    element: opts.editorEl,
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Markdown.configure({ breaks: opts.breaks ?? true, transformPastedText: true }),
      Placeholder.configure({ placeholder: opts.placeholder ?? 'Write…' }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: `reading tiptap-doc focus:outline-none${opts.docClass ? ` ${opts.docClass}` : ''}`,
        'aria-label': opts.ariaLabel ?? 'Text',
      },
    },
  });
  const getMarkdown = () =>
    (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

  // Same reveal as the full editor — a quote's words are short, but a song
  // sheet on a phone is a drawer with a sticky footer, which is the same trap
  // with a different lid.
  keepCaretClear(editor, opts.editorEl);

  const cmds: Record<string, () => void> = {
    bold: () => editor.chain().focus().toggleBold().run(),
    italic: () => editor.chain().focus().toggleItalic().run(),
  };
  const btns = Array.from(opts.toolbarRoot.querySelectorAll<HTMLButtonElement>('.tt-btn'));
  btns.forEach((b) => b.addEventListener('click', () => cmds[b.dataset.cmd!]?.()));

  function syncToolbar() {
    btns.forEach((b) => {
      const on = editor.isActive(b.dataset.cmd!);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  editor.on('selectionUpdate', syncToolbar);
  editor.on('transaction', syncToolbar);
  if (opts.onChange) editor.on('update', opts.onChange);

  return { editor, getMarkdown };
}
