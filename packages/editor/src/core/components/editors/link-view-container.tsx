/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Hover-preview orchestration for links inside the editor content surface.
 *
 * Integrates `@floating-ui/react` positioning with TipTap's link-extension
 * `storage` to render a stable hover preview popover; intended for non-touch
 * devices only (mounting is gated upstream by `EditorContainer`).
 */

import { autoUpdate, flip, hide, shift, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";

// components
import type { LinkViewProps } from "@/components/links";
import { LinkView } from "@/components/links";

type Props = {
  editor: Editor;
  containerRef: React.RefObject<HTMLDivElement>;
};

/**
 * Detects pointer hover over anchor tags within `containerRef`, maps DOM
 * positions back into the TipTap document via `editor.view.posAtDOM`,
 * extracts the hovered link URL/text from the link-mark attributes and the
 * editor's `storage.link` slice, and renders a floating `LinkView` popover.
 *
 * A 400ms close timeout keeps the preview stable while the pointer moves
 * between the editor surface and the floating preview.
 *
 * Props are typed by the local `Props` alias (`editor: Editor`,
 * `containerRef: React.RefObject<HTMLDivElement>`) — see its declaration.
 *
 * Side effects:
 * - Installs `mouseover`/`mouseenter`/`mouseleave` listeners on `containerRef`
 *   via `useEffect` (cleaned up on unmount).
 * - Configures `useFloating` (`flip`, `shift`, `hide` middleware) with
 *   `autoUpdate` plus `useDismiss` and `useInteractions` for positioning and
 *   dismissal.
 * - Uses a 400ms `setTimeout` to delay closing the preview so the pointer can
 *   traverse from the editor surface onto the floating popover without flicker.
 * - Coordinates with the global link extension by reading and writing
 *   `storage.linkExtensionStorage.isPreviewOpen` so other UI (e.g. the bubble
 *   menu) can observe that a preview is currently mounted.
 * - Suppresses preview rendering while `linkExtensionStorage.isBubbleMenuOpen`
 *   is true, closing any open preview to keep the two surfaces mutually
 *   exclusive.
 *
 * TipTap surface:
 * - Exposes the editor's `storage.link` slice via `useEditorState` for
 *   reactive reads of `isPreviewOpen`/`isBubbleMenuOpen` without forcing a
 *   full editor re-render.
 * - Overrides default browser link-click behavior — hover triggers preview
 *   only; navigation interception lives at the link-extension layer
 *   (`core/extensions/custom-link/`), not in this component.
 * - Hides the default tippy-style click-to-open popover of
 *   `@tiptap/extension-link`, replacing it with this floating-preview-on-hover
 *   pattern.
 *
 * See `../links/link-view.tsx` for the popover content (preview vs. edit modes)
 * and `core/extensions/custom-link/` for the navigation-suppression layer that
 * supplies the consumed `storage.link` slice.
 *
 * Consumed only by `EditorContainer` on non-touch devices — touch devices skip
 * hover previews entirely.
 */
export function LinkViewContainer({ editor, containerRef }: Props) {
  const [linkViewProps, setLinkViewProps] = useState<LinkViewProps>();
  const [isOpen, setIsOpen] = useState(false);
  const [virtualElement, setVirtualElement] = useState<Element | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);

  const editorState = useEditorState({
    editor,
    selector: ({ editor }: { editor: Editor }) => ({
      linkExtensionStorage: editor.storage.link,
    }),
  });

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    elements: {
      reference: virtualElement,
    },
    middleware: [
      flip({
        fallbackPlacements: ["top", "bottom"],
      }),
      shift({
        padding: 5,
      }),
      hide(),
    ],
    whileElementsMounted: autoUpdate,
    placement: "bottom-start",
  });

  const dismiss = useDismiss(context);

  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  // Clear any existing timeout
  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  // Set timeout to close link view after delay
  const setCloseTimeout = useCallback(() => {
    clearHoverTimeout();
    hoverTimeoutRef.current = window.setTimeout(() => {
      setIsOpen(false);
      editorState.linkExtensionStorage.isPreviewOpen = false;
    }, 400);
  }, [clearHoverTimeout, editorState.linkExtensionStorage]);

  const handleLinkHover = useCallback(
    (event: MouseEvent) => {
      if (!editor || editorState.linkExtensionStorage?.isBubbleMenuOpen) return;

      // Find the closest anchor tag from the event target
      const target = (event.target as HTMLElement)?.closest("a");
      if (!target) return;

      const referenceProps = getReferenceProps();
      Object.entries(referenceProps).forEach(([key, value]) => {
        target.setAttribute(key, value as string);
      });

      const view = editor.view;
      if (!view) return;

      try {
        const pos = view.posAtDOM(target, 0);
        if (pos === undefined || pos < 0) return;

        const node = view.state.doc.nodeAt(pos);
        if (!node) return;

        const linkMark = node.marks?.find((mark) => mark.type.name === "link");
        if (!linkMark) return;

        setVirtualElement(target);

        // Clear any pending close timeout when hovering over a link
        clearHoverTimeout();

        // Only update if not already open or if hovering over a different link
        if (!isOpen || (linkViewProps && (linkViewProps.from !== pos || linkViewProps.to !== pos + node.nodeSize))) {
          setLinkViewProps({
            view: "LinkPreview", // Always start with preview for new links
            url: linkMark.attrs.href,
            text: node.text || "",
            editor: editor,
            from: pos,
            to: pos + node.nodeSize,
            closeLinkView: () => {
              setIsOpen(false);
              editorState.linkExtensionStorage.isPreviewOpen = false;
            },
          });
          setIsOpen(true);
        }
      } catch (error) {
        console.error("Error handling link hover:", error);
      }
    },
    [editor, editorState.linkExtensionStorage, getReferenceProps, isOpen, linkViewProps, clearHoverTimeout]
  );

  // Handle mouse enter on floating element (cancel close timeout)
  const handleFloatingMouseEnter = useCallback(() => {
    clearHoverTimeout();
  }, [clearHoverTimeout]);

  // Handle mouse leave from floating element (start close timeout)
  const handleFloatingMouseLeave = useCallback(() => {
    setCloseTimeout();
  }, [setCloseTimeout]);

  const handleContainerMouseEnter = useCallback(() => {
    // Cancel any pending close timeout when mouse enters container
    clearHoverTimeout();
  }, [clearHoverTimeout]);

  const handleContainerMouseLeave = useCallback(
    (event: MouseEvent) => {
      if (!editor || !isOpen) return;

      // Check if mouse is truly leaving the container area
      const relatedTarget = event.relatedTarget as HTMLElement;
      const container = containerRef.current;
      const floatingElement = refs.floating;

      // Only start close timeout if mouse is not moving to the floating element
      // and is actually leaving the container
      if (
        container &&
        relatedTarget &&
        !container.contains(relatedTarget) &&
        (!floatingElement || !floatingElement.current?.contains(relatedTarget))
      ) {
        setCloseTimeout();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, isOpen, setCloseTimeout, refs.floating]
  );

  // Set up event listeners
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("mouseover", handleLinkHover);
    container.addEventListener("mouseenter", handleContainerMouseEnter);
    container.addEventListener("mouseleave", handleContainerMouseLeave);

    return () => {
      container.removeEventListener("mouseover", handleLinkHover);
      container.removeEventListener("mouseenter", handleContainerMouseEnter);
      container.removeEventListener("mouseleave", handleContainerMouseLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleLinkHover, handleContainerMouseEnter, handleContainerMouseLeave]);

  // Cleanup timeout on unmount
  useEffect(() => () => clearHoverTimeout(), [clearHoverTimeout]);

  // Close link view when bubble menu opens
  useEffect(() => {
    if (editorState.linkExtensionStorage?.isBubbleMenuOpen && isOpen) {
      setIsOpen(false);
    }
  }, [editorState.linkExtensionStorage, isOpen]);

  return (
    <>
      {isOpen && linkViewProps && virtualElement && (
        <div
          ref={refs.setFloating}
          style={{ ...floatingStyles, zIndex: 100 }}
          {...getFloatingProps()}
          onMouseEnter={handleFloatingMouseEnter}
          onMouseLeave={handleFloatingMouseLeave}
        >
          <LinkView {...linkViewProps} style={floatingStyles} />
        </div>
      )}
    </>
  );
}
