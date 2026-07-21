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
  /** The `<dialog>` from LinkDialog.astro (inner controls are class-scoped). */
  linkDialog: HTMLDialogElement;
  placeholder?: string;
  content?: string;
  ariaLabel?: string;
  /** Called on every document change (the caller decides what to do). */
  onChange?: () => void;
}

export function mountRichEditor(opts: RichEditorOptions): RichEditorHandle {
  const editor = new Editor({
    element: opts.editorEl,
    extensions: [
      StarterKit,
      Markdown.configure({ transformPastedText: true, transformCopiedText: true }),
      Placeholder.configure({ placeholder: opts.placeholder ?? 'Start writing…' }),
    ],
    content: opts.content || '',
    editorProps: {
      attributes: { class: 'reading tiptap-doc focus:outline-none', 'aria-label': opts.ariaLabel ?? 'Body' },
    },
  });
  const getMarkdown = () => (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown();

  // ---- toolbar ----
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

  // ---- link dialog (class-scoped within the passed dialog element) ----
  const linkDialog = opts.linkDialog;
  const linkUrl = linkDialog.querySelector('.link-url') as HTMLInputElement;
  const linkRemove = linkDialog.querySelector('.link-remove') as HTMLButtonElement;
  const linkApply = linkDialog.querySelector('.link-apply') as HTMLButtonElement;
  const linkCancel = linkDialog.querySelector('.link-cancel') as HTMLButtonElement;

  function openLinkDialog() {
    const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
    linkUrl.value = prev;
    linkRemove.hidden = !prev;
    linkDialog.showModal();
    linkUrl.focus();
    linkUrl.select();
  }
  function applyLink() {
    const url = linkUrl.value.trim();
    linkDialog.close();
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }
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

  return { editor, getMarkdown };
}
