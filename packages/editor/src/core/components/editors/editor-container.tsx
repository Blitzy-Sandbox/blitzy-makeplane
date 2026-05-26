/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Main interaction shell around the editable ProseMirror document surface.
 *
 * Hosts hash-based navigation, click-to-focus with conditional
 * trailing-paragraph insertion, mouse-leave side-menu hiding, and conditional
 * `LinkContainer` mounting for non-touch devices.
 */

import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
// plane utils
import { cn } from "@plane/utils";
// constants
import { DEFAULT_DISPLAY_CONFIG } from "@/constants/config";
import { CORE_EXTENSIONS } from "@/constants/extension";
// components
import type { TCollabValue } from "@/contexts";
import { LinkContainer } from "@/plane-editor/components/link-container";
// plugins
import { nodeHighlightPluginKey } from "@/plugins/highlight";
// types
import type { TDisplayConfig } from "@/types";

type Props = {
  children: ReactNode;
  displayConfig: TDisplayConfig;
  editor: Editor;
  editorContainerClassName: string;
  id: string;
  isTouchDevice: boolean;
  provider?: HocuspocusProvider | undefined;
  state?: TCollabValue["state"];
};

/**
 * Styled outer `<div>` (the `.editor-container`) that surrounds the editable
 * surface and orchestrates its interactive scaffolding: hash-based node
 * navigation (via `nodeHighlightPluginKey`), click-to-focus with conditional
 * trailing-paragraph insertion, mouse-leave side-menu hiding, and (on
 * non-touch devices) link hover preview via `LinkContainer`.
 *
 * Props are typed by the local `Props` alias — see its declaration above.
 *
 * Side effects:
 * - Reads `window.location.hash` on mount and, when a matching node id is
 *   found, dispatches a highlight transaction via `nodeHighlightPluginKey`
 *   and schedules `scrollIntoView({ behavior: "instant", block: "center" })`
 *   inside `requestAnimationFrame`.
 * - When both `provider` and `state` are present, gates the scroll-to-node
 *   behavior on collaboration sync: checks `state.hasCachedContent` and
 *   `provider.isSynced`, and binds/unbinds a `provider.on("synced", …)`
 *   listener so the highlight + scroll only fire once the document is
 *   ready; the listener is cleaned up on dependency change / unmount.
 * - On container click (only when `event.target === event.currentTarget`),
 *   calls `editor.chain().focus("end", { scrollIntoView: false }).run()`
 *   and conditionally appends an empty paragraph at the end of the doc when
 *   the last node is neither `paragraph` nor `doc` — but skips the append
 *   when the selection sits inside an `orderedList`, `bulletList`,
 *   `taskItem`, `table`, `blockquote`, or `codeBlock` (per `CORE_EXTENSIONS`).
 * - On container mouse-leave, hides the side-menu overlay by adding the
 *   `side-menu-hidden` class to the `#editor-side-menu` element.
 *
 * TipTap surface:
 * - Exposes `editor.commands.focus()` via click-to-focus and
 *   `editor.state.doc` traversal via the hash-navigation lookup.
 * - Overrides the default ProseMirror focus-scroll behavior by explicitly
 *   passing `scrollIntoView: false` to `editor.chain().focus(...)` so the
 *   viewport does not jump on click-to-focus; overrides the default browser
 *   link-click behavior by mounting `LinkContainer` (hover preview) on
 *   non-touch devices — touch devices skip `LinkContainer` entirely.
 * - Hides the default side-menu visibility via the `mouseleave` handler that
 *   toggles the `side-menu-hidden` class on `#editor-side-menu`.
 *
 * Cross-references: `LinkContainer` (`@/plane-editor/components/link-container`)
 * mounts on non-touch devices; `nodeHighlightPluginKey` (`@/plugins/highlight`)
 * is the ProseMirror plugin that renders the highlight; `CORE_EXTENSIONS`
 * (`@/constants/extension`) supplies the node-type names used in the
 * click-handler guards.
 *
 * Consumed by `EditorWrapper` as the outer composition shell for standalone
 * editor variants, and by `document/page-renderer.tsx` for the collaborative
 * document editor — the latter is the call site that supplies `provider` and
 * `state` to drive the sync-gated hash-navigation pathway.
 */
export function EditorContainer(props: Props) {
  const { children, displayConfig, editor, editorContainerClassName, id, isTouchDevice, provider, state } = props;
  // refs
  const containerRef = useRef<HTMLDivElement>(null);
  const hasScrolledOnce = useRef(false);
  const scrollToNode = useCallback(
    (nodeId: string) => {
      if (!editor) return false;

      const doc = editor.state.doc;
      let pos: number | null = null;

      doc.descendants((node, position) => {
        if (node.attrs && node.attrs.id === nodeId) {
          pos = position;
          return false;
        }
      });

      if (pos === null) {
        return false;
      }

      const nodePosition = pos;
      const tr = editor.state.tr.setMeta(nodeHighlightPluginKey, { nodeId });
      editor.view.dispatch(tr);

      requestAnimationFrame(() => {
        const domNode = editor.view.nodeDOM(nodePosition);
        if (domNode instanceof HTMLElement) {
          domNode.scrollIntoView({ behavior: "instant", block: "center" });
        }
      });

      editor.once("focus", () => {
        const clearTr = editor.state.tr.setMeta(nodeHighlightPluginKey, { nodeId: null });
        editor.view.dispatch(clearTr);
      });

      hasScrolledOnce.current = true;
      return true;
    },

    [editor]
  );

  useEffect(() => {
    const nodeId = window.location.href.split("#")[1];

    const handleSynced = () => scrollToNode(nodeId);

    if (nodeId && !hasScrolledOnce.current) {
      if (provider && state) {
        const { hasCachedContent } = state;
        // If the provider is synced or the cached content is available and the server is disconnected, scroll to the node
        if (hasCachedContent) {
          const hasScrolled = handleSynced();
          if (!hasScrolled) {
            provider.on("synced", handleSynced);
          }
        } else if (provider.isSynced) {
          handleSynced();
        } else {
          provider.on("synced", handleSynced);
        }
      } else {
        handleSynced();
      }
      return () => {
        if (provider) {
          provider.off("synced", handleSynced);
        }
      };
    }
  }, [scrollToNode, provider, state]);

  const handleContainerClick = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (event.target !== event.currentTarget) return;
    if (!editor) return;
    if (!editor.isEditable) return;
    try {
      if (editor.isFocused) return; // If editor is already focused, do nothing

      const { selection } = editor.state;
      const currentNode = selection.$from.node();

      editor?.chain().focus("end", { scrollIntoView: false }).run(); // Focus the editor at the end

      if (
        currentNode.content.size === 0 && // Check if the current node is empty
        !(
          editor.isActive(CORE_EXTENSIONS.ORDERED_LIST) ||
          editor.isActive(CORE_EXTENSIONS.BULLET_LIST) ||
          editor.isActive(CORE_EXTENSIONS.TASK_ITEM) ||
          editor.isActive(CORE_EXTENSIONS.TABLE) ||
          editor.isActive(CORE_EXTENSIONS.BLOCKQUOTE) ||
          editor.isActive(CORE_EXTENSIONS.CODE_BLOCK)
        ) // Check if it's an empty node within an orderedList, bulletList, taskItem, table, quote or code block
      ) {
        return;
      }

      // Get the last child node in the document
      const doc = editor.state.doc;
      const lastNode = doc.lastChild;

      // Check if its last node and add new node
      if (lastNode) {
        const isLastNodeParagraph = lastNode.type.name === CORE_EXTENSIONS.PARAGRAPH;
        // Insert a new paragraph if the last node is not a paragraph and not a doc node
        if (!isLastNodeParagraph && lastNode.type.name !== CORE_EXTENSIONS.DOCUMENT) {
          // Only insert a new paragraph if the last node is not an empty paragraph and not a doc node
          const endPosition = editor?.state.doc.content.size;
          editor?.chain().insertContentAt(endPosition, { type: "paragraph" }).focus("end").run();
        }
      }
    } catch (error) {
      console.error("An error occurred while handling container click to insert new empty node at bottom:", error);
    }
  };

  const handleContainerMouseLeave = () => {
    const dragHandleElement = document.querySelector("#editor-side-menu");
    if (!dragHandleElement?.classList.contains("side-menu-hidden")) {
      dragHandleElement?.classList.add("side-menu-hidden");
    }
  };

  return (
    <>
      <div
        ref={containerRef}
        id={`editor-container-${id}`}
        onClick={handleContainerClick}
        onMouseLeave={handleContainerMouseLeave}
        className={cn(
          `editor-container relative cursor-text line-spacing-${displayConfig.lineSpacing ?? DEFAULT_DISPLAY_CONFIG.lineSpacing}`,
          {
            "active-editor": editor?.isFocused && editor?.isEditable,
          },
          displayConfig.fontSize ?? DEFAULT_DISPLAY_CONFIG.fontSize,
          displayConfig.fontStyle ?? DEFAULT_DISPLAY_CONFIG.fontStyle,
          editorContainerClassName
        )}
      >
        {children}
        {!isTouchDevice && <LinkContainer editor={editor} containerRef={containerRef} />}
      </div>
    </>
  );
}
