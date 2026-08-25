/**
 * TiptapEditor — drop-in replacement for the <textarea> in InputBar.
 *
 * Exposes an imperative API (via ref) that mirrors the subset of textarea
 * behaviour that InputBar relies on:  getText(), setText(), focus(),
 * insertFileChip(), isEmpty().
 *
 * Internally uses a Tiptap editor with the StarterKit + custom FileChipExtension.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { FileChipExtension, type FileChipAttrs } from './file-chip-extension';
import { FileChipView } from './FileChipView';

/* ------------------------------------------------------------------ */
/*  Imperative handle                                                  */
/* ------------------------------------------------------------------ */

export interface TiptapEditorHandle {
  /** Extract plain text for submission. FileChips become `path` */
  getText(): string;
  /** Replace editor content with plain text (used by setInput) */
  setText(text: string): void;
  /** Focus the editor */
  focus(): void;
  /** Insert a file chip at the current cursor position */
  insertFileChip(attrs: FileChipAttrs): void;
  /** Insert plain text at the current cursor position */
  insertTextAtCursor(text: string): void;
  /** Whether the editor has no content */
  isEmpty(): boolean;
  /** Whether an IME composition is in progress */
  isComposing(): boolean;
  /** Get the underlying Tiptap editor instance (escape hatch) */
  getEditor(): ReturnType<typeof useEditor> | null;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface TiptapEditorProps {
  /** Placeholder text */
  placeholder?: string;
  /** Called whenever the content changes (debounce-free) */
  onUpdate?: (text: string) => void;
  /** Called on keydown — receives the native keyboard event */
  onKeyDown?: (e: KeyboardEvent) => boolean | void;
  /** Called on paste */
  onPaste?: (e: ClipboardEvent) => boolean | void;
  /** Additional CSS class for the wrapper */
  className?: string;
  /** data attribute for external querySelector targeting */
  'data-chat-input'?: boolean;
}

/* ------------------------------------------------------------------ */
/*  FileChip extension with React NodeView                             */
/* ------------------------------------------------------------------ */

const FileChipWithView = FileChipExtension.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FileChipView);
  },
});

/* ------------------------------------------------------------------ */
/*  Serializer: editor JSON → plain text with `path` for file chips    */
/* ------------------------------------------------------------------ */

function editorToPlainText(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return '';
  const json = editor.getJSON();
  const parts: string[] = [];
  for (const block of (json.content ?? []) as any[]) {
    const lineParts: string[] = [];
    for (const node of (block.content ?? []) as any[]) {
      if (node.type === 'fileChip') {
        const displayPath = node.attrs?.label ?? node.attrs?.fullPath ?? '';
        lineParts.push(`\`${displayPath}\``);
      } else if (node.type === 'text') {
        lineParts.push(node.text ?? '');
      } else if (node.type === 'hardBreak') {
        lineParts.push('\n');
      }
    }
    parts.push(lineParts.join(''));
  }
  return parts.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  function TiptapEditor(props, ref) {
    const {
      placeholder = '',
      onUpdate,
      onKeyDown,
      onPaste,
      className,
    } = props;

    const wrapperRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    // Last cursor position while the editor had focus — external insertions
    // (file tree "insert path", paste/drag of paths) restore this instead of
    // appending to the end of the document.
    const savedSelectionRef = useRef<{ from: number; to: number } | null>(null);
    const onUpdateRef = useRef(onUpdate);
    onUpdateRef.current = onUpdate;

    const onKeyDownRef = useRef(onKeyDown);
    onKeyDownRef.current = onKeyDown;

    const onPasteRef = useRef(onPaste);
    onPasteRef.current = onPaste;

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // Disable all block-level nodes except paragraph + hardBreak
          heading: false,
          blockquote: false,
          codeBlock: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          horizontalRule: false,
          // Keep bold/italic/code inline marks
        }),
        Placeholder.configure({ placeholder }),
        FileChipWithView,
      ],
      editorProps: {
        attributes: {
          class: 'tiptap outline-none',
          'data-chat-input': '',
        },
        handleKeyDown: (_view, event) => {
          // Auto-unstick composingRef if browser says not composing.
          // compositionend can be missed on macOS WebKit (focus change, click outside),
          // leaving composingRef stuck true and blocking Enter. See issue #66.
          if (composingRef.current && !event.isComposing && event.keyCode !== 229) {
            composingRef.current = false;
          }
          return onKeyDownRef.current?.(event) === true;
        },
        handlePaste: (_view, event) => {
          // File-path pastes (file chips) are handled by InputBar's onPaste
          if (onPasteRef.current?.(event as unknown as ClipboardEvent) === true) return true;
          // Strip rich-text formatting: insert plain text instead of TipTap's
          // default HTML paste, which would carry bold/italic marks into the
          // editor (and later get dropped silently at send time anyway).
          const cd = (event as ClipboardEvent).clipboardData;
          if (!cd || !editor) return false;
          let text = cd.getData('text/plain');
          if (!text) {
            const html = cd.getData('text/html');
            if (html) {
              // HTML-only clipboard: rebuild line breaks, then extract text
              const doc = new DOMParser().parseFromString(html, 'text/html');
              doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
              doc.querySelectorAll('p, div, li').forEach((el) => el.append('\n'));
              text = doc.body.textContent ?? '';
            }
          }
          if (!text) return false; // non-text clipboard (e.g. image) → default handling
          text = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
          // Lines joined by hardBreaks (same convention as Shift+Enter and
          // the editorToPlainText serializer)
          const content = text.split('\n').flatMap((line, i) => {
            const nodes: { type: string; text?: string }[] = [];
            if (i > 0) nodes.push({ type: 'hardBreak' });
            if (line) nodes.push({ type: 'text', text: line });
            return nodes;
          });
          editor.chain().insertContent(content).run();
          return true;
        },
      },
      onUpdate: ({ editor: ed }) => {
        // Skip store updates during IME composition to avoid React re-renders
        // that can disrupt WebKit's contentEditable composition state
        if (composingRef.current) return;
        const text = editorToPlainText(ed);
        onUpdateRef.current?.(text);
      },
      onBlur: ({ editor: ed }) => {
        savedSelectionRef.current = {
          from: ed.state.selection.from,
          to: ed.state.selection.to,
        };
      },
    });

    // Track IME composition state and flush text on compositionend
    useEffect(() => {
      const el = editor?.view?.dom;
      if (!el) return;
      const onStart = () => { composingRef.current = true; };
      const onEnd = () => {
        composingRef.current = false;
        // Flush the final composed text to the store
        const text = editorToPlainText(editor);
        onUpdateRef.current?.(text);
      };
      el.addEventListener('compositionstart', onStart);
      el.addEventListener('compositionend', onEnd);
      return () => {
        el.removeEventListener('compositionstart', onStart);
        el.removeEventListener('compositionend', onEnd);
      };
    }, [editor]);

    // Update placeholder when prop changes
    useEffect(() => {
      if (!editor) return;
      // Access the placeholder extension and reconfigure
      editor.extensionManager.extensions.forEach((ext) => {
        if (ext.name === 'placeholder') {
          (ext.options as any).placeholder = placeholder;
          // Force re-render of decorations
          editor.view.dispatch(editor.view.state.tr);
        }
      });
    }, [editor, placeholder]);

    useImperativeHandle(ref, () => ({
      getText() {
        return editorToPlainText(editor);
      },
      setText(text: string) {
        if (!editor) return;
        if (!text) {
          editor.commands.clearContent();
          return;
        }
        // Set plain text content (preserving newlines as hard breaks)
        editor.commands.setContent(
          text.split('\n').map((line) => ({
            type: 'paragraph',
            content: line ? [{ type: 'text', text: line }] : [],
          })),
        );
      },
      focus() {
        editor?.commands.focus();
      },
      insertFileChip(attrs: FileChipAttrs) {
        if (!editor) return;
        editor.commands.focus();
        editor
          .chain()
          .insertContent({
            type: 'fileChip',
            attrs,
          })
          .insertContent(' ')  // space after chip for typing
          .run();
      },
      insertTextAtCursor(text: string) {
        if (!editor) return;
        editor.commands.focus();
        // Restore the cursor position from before the editor lost focus —
        // clicking in the file tree blurs the editor, after which a plain
        // insertContent would land at the end of the document instead of
        // where the user was last editing.
        const saved = savedSelectionRef.current;
        if (saved && saved.from <= editor.state.doc.content.size && saved.to <= editor.state.doc.content.size) {
          editor.chain().focus().setTextSelection(saved).insertContent(text).run();
        } else {
          editor.chain().insertContent(text).run();
        }
      },
      isEmpty() {
        return editor?.isEmpty ?? true;
      },
      isComposing() {
        return composingRef.current;
      },
      getEditor() {
        return editor;
      },
    }));

    return (
      <div
        ref={wrapperRef}
        className={className}
        data-chat-input={props['data-chat-input'] ? '' : undefined}
      >
        <EditorContent editor={editor} />
      </div>
    );
  },
);
