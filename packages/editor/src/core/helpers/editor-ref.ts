/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Builds the imperative `EditorRefApi` exposed through `useImperativeHandle` in `core/hooks/use-editor.ts`.
 *
 * The ref API is the consumer surface for everything that needs to drive the editor from outside React: page providers triggering content sync, the comment composer reading selection text, the document title flow injecting Y.js updates, the headings outline jumping to anchors, and the formatting toolbar invoking menu items by key.
 *
 * Wraps three underlying sources: the TipTap `Editor`, the Hocuspocus `provider` (for Y.js binary state and stateless real-time messages), and a caller-provided `getEditorMetaData` (for HTML→markdown conversion that needs custom-component metadata).
 */

import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Editor } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import * as Y from "yjs";
// plane imports
import { convertHTMLToMarkdown } from "@plane/utils";
// components
import { getEditorMenuItems } from "@/components/menus";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
import { CORE_EDITOR_META } from "@/constants/meta";
// types
import type { EditorRefApi, IEditorProps, TEditorCommands } from "@/types";
// local imports
import { getParagraphCount } from "./common";
import { insertContentAtSavedSelection } from "./insert-content-at-cursor-position";
import { scrollSummary, scrollToNodeViaDOMCoordinates } from "./scroll-to-node";

type TArgs = Pick<IEditorProps, "getEditorMetaData"> & {
  editor: Editor | null;
  provider: HocuspocusProvider | undefined;
};

/**
 * Constructs the `EditorRefApi` object returned from the editor's `useImperativeHandle`; methods on the returned object are stable references that close over `editor`, `provider`, and `getEditorMetaData`.
 *
 * @param args.editor - TipTap `Editor` instance (nullable while the editor is mounting).
 * @param args.provider - Hocuspocus provider for collaborative documents; `undefined` for non-collaborative variants (`getDocument` returns a null binary in that case).
 * @param args.getEditorMetaData - Callback returning custom-component metadata for HTML→markdown conversion (see `convertHTMLToMarkdown` in `@plane/utils`).
 * @returns The full `EditorRefApi` shape consumed by the four editor `*WithRef` exports.
 */
export const getEditorRefHelpers = (args: TArgs): EditorRefApi => {
  const { editor, getEditorMetaData, provider } = args;

  return {
    /** Blurs the editor (removes keyboard focus). */
    blur: () => editor?.commands.blur(),
    /** Clears the editor content; sets `SKIP_FILE_DELETION` meta so the file-handling extension does not enqueue uploaded assets for deletion. */
    clearEditor: (emitUpdate = false) => {
      editor?.chain().setMeta(CORE_EDITOR_META.SKIP_FILE_DELETION, true).clearContent(emitUpdate).run();
    },
    /** Expands an empty selection at the cursor into a word-range by walking `\w` boundaries left and right; used by AI / mention flows that need a "current word" anchor. */
    createSelectionAtCursorPosition: () => {
      if (!editor) return;
      const { empty } = editor.state.selection;

      if (empty) {
        // Get the text content and position info
        const { $from } = editor.state.selection;
        const textContent = $from.parent.textContent;
        const posInNode = $from.parentOffset;

        // Find word boundaries
        let start = posInNode;
        let end = posInNode;

        // Move start position backwards until we hit a word boundary
        while (start > 0 && /\w/.test(textContent[start - 1])) {
          start--;
        }

        // Move end position forwards until we hit a word boundary
        while (end < textContent.length && /\w/.test(textContent[end])) {
          end++;
        }

        // If we found a word, select it using editor commands
        if (start !== end) {
          const from = $from.start() + start;
          const to = $from.start() + end;
          editor.commands.setTextSelection({ from, to });
        }
      }
    },
    /** Returns the document in three formats: binary (Y.js update, or null when not collaborative), HTML, and JSON; used by autosave snapshots and Y.js fallback recovery. */
    getDocument: () => {
      const documentBinary = provider?.document ? Y.encodeStateAsUpdate(provider?.document) : null;
      const documentHTML = editor?.getHTML() ?? "<p></p>";
      const documentJSON = editor?.getJSON() ?? null;

      return {
        binary: documentBinary,
        html: documentHTML,
        json: documentJSON,
      };
    },
    /** Returns `{ characters, paragraphs, words }` derived from the character-count extension's storage and `getParagraphCount` from `helpers/common.ts`. */
    getDocumentInfo: () => ({
      characters: editor?.storage.characterCount?.characters?.() ?? 0,
      paragraphs: getParagraphCount(editor?.state),
      words: editor?.storage.characterCount?.words?.() ?? 0,
    }),
    /** Returns the `IMarking[]` produced by the `headingsList` extension storage; consumed by the table-of-contents outline panel. */
    getHeadings: () => (editor ? editor.storage.headingsList?.headings : []),
    /** Converts the editor's HTML to markdown via `convertHTMLToMarkdown`, using the caller-provided `getEditorMetaData` so custom components round-trip through markdown serialization. */
    getMarkDown: () => {
      if (!editor) return "";
      const editorHTML = editor.getHTML();
      const metaData = getEditorMetaData(editorHTML);
      // convert to markdown
      const markdown = convertHTMLToMarkdown({
        description_html: editorHTML,
        metaData,
      });
      return markdown;
    },
    /**
     * Copies the document as markdown to the clipboard while also publishing `text/html` and `text/plane-editor-html` payloads on the same event.
     *
     * The `text/plane-editor-html` payload is one of three anchors of the closed copy-paste protocol:
     * - This handler (`editor-ref.ts:112`) SETS it on explicit ref-API copy.
     * - `core/plugins/markdown-clipboard.ts:41` ALSO SETS it on user-triggered copy via the editor's clipboard plugin.
     * - `core/props.ts:41` READS it on paste and routes the HTML through `helpers/paste-asset.ts:processAssetDuplication`.
     *
     * The triple-write (plain, html, plane-editor-html) ensures the editor's paste handler can preserve full fidelity, while external apps can still consume the plain or html payloads.
     */
    copyMarkdownToClipboard: () => {
      if (!editor) return;

      const html = editor.getHTML();
      const metaData = getEditorMetaData(html);
      const markdown = convertHTMLToMarkdown({
        description_html: html,
        metaData,
      });

      const copyHandler = (event: ClipboardEvent) => {
        event.preventDefault();
        event.clipboardData?.setData("text/plain", markdown);
        event.clipboardData?.setData("text/html", html);
        event.clipboardData?.setData("text/plane-editor-html", html);
        document.removeEventListener("copy", copyHandler);
      };

      document.addEventListener("copy", copyHandler);
      document.execCommand("copy");
    },
    /** Returns `true` when any dropbar / floating panel registered via the `utility` extension storage is open; used by hosts that need to suppress competing UI. */
    isAnyDropbarOpen: () => {
      if (!editor) return false;
      const utilityStorage = editor.storage.utility;
      return utilityStorage.activeDropbarExtensions.length > 0;
    },
    /** Delegates to `helpers/scroll-to-node.ts:scrollSummary` to jump to the Nth heading of the given level for the outline panel. */
    scrollSummary: (marking) => {
      if (!editor) return;
      scrollSummary(editor, marking);
    },
    /** Replaces the editor content with `content`; sets `SKIP_FILE_DELETION` + `INTENTIONAL_DELETION` meta so the file-handler does not flag previously uploaded assets for deletion and so the deletion is recorded as intentional in the history. */
    setEditorValue: (content, emitUpdate = false) => {
      editor
        ?.chain()
        .setMeta(CORE_EDITOR_META.SKIP_FILE_DELETION, true)
        .setMeta(CORE_EDITOR_META.INTENTIONAL_DELETION, true)
        .setContent(content, emitUpdate, {
          preserveWhitespace: true,
        })
        .run();
    },
    /** Sends a stateless message over the Hocuspocus provider; used by the page lifecycle layer to broadcast lock / unlock / archive / restore commands to all connected clients (see `helpers/get-document-server-event.ts` for the event-name mapping). */
    emitRealTimeUpdate: (message) => provider?.sendStateless(message),
    /** Looks up a menu item by `itemKey` from `getEditorMenuItems` and invokes its `command(props)`; the central dispatcher used by toolbars and slash-command menus. */
    executeMenuItemCommand: (props) => {
      const { itemKey } = props;
      const editorItems = getEditorMenuItems(editor);

      const getEditorMenuItem = (itemKey: TEditorCommands) => editorItems.find((item) => item.key === itemKey);

      const item = getEditorMenuItem(itemKey);
      if (item) {
        item.command(props);
      } else {
        console.warn(`No command found for item: ${itemKey}`);
      }
    },
    /** Focuses the editor; arguments are forwarded to TipTap's `focus` command (position, scrollIntoView flag). */
    focus: (args) => editor?.commands.focus(args),
    /** Returns the DOM coordinates of a document position via `view.coordsAtPos`; used by floating popovers anchored to a specific node. */
    getCoordsFromPos: (pos) => editor?.view.coordsAtPos(pos ?? editor.state.selection.from),
    /** Returns the current selection's `from` anchor; used as a stable cursor position to reapply after an external operation. */
    getCurrentCursorPosition: () => editor?.state.selection.from,
    /** Extends the current selection to cover the full range of a given mark, then returns the requested attribute set; used by the link toolbar to read the full href even when the cursor is inside the link. */
    getAttributesWithExtendedMark: (mark, attribute) => {
      if (!editor) return;
      editor.commands.extendMarkRange(mark);
      return editor.getAttributes(attribute);
    },
    /** Serializes the current selection to HTML by walking immediate document children with `DOMSerializer.fromSchema` and joining their serialized output; returns `null` for an empty selection. */
    getSelectedText: () => {
      if (!editor) return null;

      const { state } = editor;
      const { from, to, empty } = state.selection;

      if (empty) return null;

      const nodesArray: string[] = [];
      state.doc.nodesBetween(from, to, (node, _pos, parent) => {
        if (parent === state.doc && editor) {
          const serializer = DOMSerializer.fromSchema(editor.schema);
          const dom = serializer.serializeNode(node);
          const tempDiv = document.createElement("div");
          tempDiv.appendChild(dom);
          nodesArray.push(tempDiv.innerHTML);
        }
      });
      const selection = nodesArray.join("");
      return selection;
    },
    /** Inserts `contentHTML` either replacing the current selection (default) or appended after a `<br />` on the next line (when `insertOnNextLine` is true); used by AI completions. */
    insertText: (contentHTML, insertOnNextLine) => {
      if (!editor) return;
      const { from, to, empty } = editor.state.selection;
      if (empty) return;
      if (insertOnNextLine) {
        // move cursor to the end of the selection and insert a new line
        editor.chain().focus().setTextSelection(to).insertContent("<br />").insertContent(contentHTML).run();
      } else {
        // replace selected text with the content provided
        editor.chain().focus().deleteRange({ from, to }).insertContent(contentHTML).run();
      }
    },
    /** Returns `true` only when the `utility` extension reports `uploadInProgress === false`; consumers use this as a guard before discarding unsaved drafts. */
    isEditorReadyToDiscard: () => editor?.storage?.utility?.uploadInProgress === false,
    /** Returns whether a given menu item is currently "active" (e.g., the bold button is active when the selection is bold); delegates to the menu item's `isActive` callback. */
    isMenuItemActive: (props) => {
      const { itemKey } = props;
      const editorItems = getEditorMenuItems(editor);

      const getEditorMenuItem = (itemKey: TEditorCommands) => editorItems.find((item) => item.key === itemKey);
      const item = getEditorMenuItem(itemKey);
      if (!item) return false;

      return item.isActive(props);
    },
    /** Returns the Hocuspocus provider's `on` / `off` pair for subscribing to stateless real-time messages; returns `undefined` when no provider is wired (non-collaborative editor). */
    listenToRealTimeUpdate: () => provider && { on: provider.on.bind(provider), off: provider.off.bind(provider) },
    /** Subscribes a callback to TipTap's `update` event that re-emits `{ characters, paragraphs, words }`; returns an unsubscribe function the consumer MUST call on unmount. */
    onDocumentInfoChange: (callback) => {
      const handleDocumentInfoChange = () => {
        if (!editor?.storage) return;
        callback({
          characters: editor.storage.characterCount?.characters?.() ?? 0,
          paragraphs: getParagraphCount(editor?.state),
          words: editor.storage.characterCount?.words?.() ?? 0,
        });
      };

      // Subscribe to update event emitted from character count extension
      editor?.on("update", handleDocumentInfoChange);
      // Return a function to unsubscribe to the continuous transactions of
      // the editor on unmounting the component that has subscribed to this
      // method
      return () => {
        editor?.off("update", handleDocumentInfoChange);
      };
    },
    /** Subscribes a callback to TipTap's `update` event that re-emits the headings array from the `headingsList` extension storage; returns an unsubscribe function the consumer MUST call on unmount. */
    onHeadingChange: (callback) => {
      const handleHeadingChange = () => {
        if (!editor) return;
        const headings = editor.storage.headingsList?.headings;
        if (headings) {
          callback(headings);
        }
      };

      // Subscribe to update event emitted from headers extension
      editor?.on("update", handleHeadingChange);
      // Return a function to unsubscribe to the continuous transactions of
      // the editor on unmounting the component that has subscribed to this
      // method
      return () => {
        editor?.off("update", handleHeadingChange);
      };
    },
    /** Subscribes a callback to TipTap's `transaction` event (every state change); returns an unsubscribe function the consumer MUST call on unmount. */
    onStateChange: (callback) => {
      // Subscribe to editor state changes
      editor?.on("transaction", callback);

      // Return a function to unsubscribe to the continuous transactions of
      // the editor on unmounting the component that has subscribed to this
      // method
      return () => {
        editor?.off("transaction", callback);
      };
    },
    /** Redoes the last undone change via the history extension. */
    redo: () => editor?.commands.redo(),
    /** Delegates to `helpers/scroll-to-node.ts:scrollToNodeViaDOMCoordinates`; defaults to the current selection's `from` and `"smooth"` behavior. */
    scrollToNodeViaDOMCoordinates({ pos, behavior = "smooth" }) {
      const resolvedPos = pos ?? editor?.state.selection.from;
      if (!editor || !resolvedPos) return;
      scrollToNodeViaDOMCoordinates(editor, resolvedPos, behavior);
    },
    /** Delegates to `helpers/insert-content-at-cursor-position.ts:insertContentAtSavedSelection` for safe (range-clamped) insertion at the saved cursor anchor. */
    setEditorValueAtCursorPosition: (content) => {
      if (editor?.state.selection) {
        insertContentAtSavedSelection(editor, content);
      }
    },
    /** Inserts an empty paragraph at the clamped `position` and moves focus there; used to recover from an invalid editor state where the cursor would otherwise be lost. */
    setFocusAtPosition: (position) => {
      if (!editor || editor.isDestroyed) {
        console.error("Editor reference is not available or has been destroyed.");
        return;
      }
      try {
        const docSize = editor.state.doc.content.size;
        const safePosition = Math.max(0, Math.min(position, docSize));
        editor
          .chain()
          .insertContentAt(safePosition, [{ type: CORE_EXTENSIONS.PARAGRAPH }])
          .focus()
          .run();
      } catch (error) {
        console.error("An error occurred while setting focus at position:", error);
      }
    },
    /** Applies a Y.js binary update to the Hocuspocus provider's document via `Y.applyUpdate`; the CRDT merge guarantees the result converges with any concurrent updates. See `helpers/yjs-utils.ts` for CRDT semantics. */
    setProviderDocument: (value) => {
      const document = provider?.document;
      if (!document) return;
      Y.applyUpdate(document, value);
    },
    /** Undoes the last change via the history extension. */
    undo: () => editor?.commands.undo(),
  };
};
