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

export interface RichEditorHandle {
  editor: Editor;
  getMarkdown: () => string;
}

export interface RichEditorOptions {
  /** The element TipTap renders into. */
  editorEl: HTMLElement;
  /** Container holding the `.tt-btn` toolbar buttons (see EditorToolbar.astro). */
  toolbarRoot: HTMLElement;
  /**
   * The `<dialog>` from LinkDialog.astro (inner controls are class-scoped).
   * Optional: omit it for a slim, link-free toolbar (e.g. the interest notes) —
   * the link command becomes a no-op and no dialog is required.
   */
  linkDialog?: HTMLDialogElement | null;
  placeholder?: string;
  content?: string;
  ariaLabel?: string;
  /** Called on every document change (the caller decides what to do). */
  onChange?: () => void;
  /**
   * Enables images (docs/plans/03). Omit and there is no image node at all —
   * the toolbar button, paste and drop all stay off, which is what the quote
   * and song editors want.
   */
  images?: ImageSupport;
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
  const editor = new Editor({
    element: opts.editorEl,
    extensions: [
      StarterKit,
      Markdown.configure({ transformPastedText: true, transformCopiedText: true }),
      Placeholder.configure({ placeholder: opts.placeholder ?? 'Start writing…' }),
      // `inline: false` — an image is its own block, which is what
      // `![alt](src)` round-trips to and what the reading column wants.
      ...(img ? [Image.configure({ inline: false, allowBase64: false })] : []),
    ],
    content: opts.content || '',
    editorProps: {
      attributes: { class: 'reading tiptap-doc focus:outline-none', 'aria-label': opts.ariaLabel ?? 'Body' },
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
      linkDialog.showModal();
      linkUrl.focus();
      linkUrl.select();
    };
    const applyLink = () => {
      const url = linkUrl.value.trim();
      linkDialog.close();
      if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    };
    linkApply.addEventListener('click', applyLink);
    linkCancel.addEventListener('click', () => linkDialog.close());
    linkRemove.addEventListener('click', () => {
      linkDialog.close();
      editor.chain().focus().unsetLink().run();
    });
    linkDialog.addEventListener('click', (e) => {
      if (e.target === linkDialog) linkDialog.close();
    });
    linkUrl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyLink();
      }
    });
  }

  return { editor, getMarkdown };
}

export interface MiniEditorOptions {
  editorEl: HTMLElement;
  /** Container holding THIS editor's `.tt-btn` buttons — its own toolbar only,
   *  so two mini editors can sit in one sheet without stealing each other's. */
  toolbarRoot: HTMLElement;
  placeholder?: string;
  ariaLabel?: string;
  onChange?: () => void;
}

/**
 * The short-form editor: bold and italic, line breaks preserved, no headings /
 * lists / rules. That's the register a quote's words and a song's annotation
 * share — a sentence or a few, never an essay — so the composer's full toolbar
 * would be noise. `breaks: true` keeps a poem's line breaks through the
 * Markdown round-trip.
 *
 * Same handle as `mountRichEditor`, so callers serialize the same way.
 */
export function mountMiniEditor(opts: MiniEditorOptions): RichEditorHandle {
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
      Markdown.configure({ breaks: true, transformPastedText: true }),
      Placeholder.configure({ placeholder: opts.placeholder ?? 'Write…' }),
    ],
    content: '',
    editorProps: {
      attributes: { class: 'reading tiptap-doc focus:outline-none', 'aria-label': opts.ariaLabel ?? 'Text' },
    },
  });
  const getMarkdown = () =>
    (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

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
