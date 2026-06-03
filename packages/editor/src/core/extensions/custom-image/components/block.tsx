/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Interactive image-block UI rendered by `CustomImageNodeView` once an upload
 * has resolved to a stable, fetchable URL.
 *
 * Composition:
 *   - `<img>` with size persisted to node attrs.
 *   - Loading skeleton (`animate-pulse`) while the resolved URL or initial
 *     resize is pending.
 *   - `ImageUploadStatus` percentage badge while a network upload is in flight.
 *   - `ImageToolbarRoot` contextual toolbar (alignment, download, resize-aware)
 *     once both `src` and `downloadSrc` are resolved.
 *   - Selection overlay + resize handle when the node is selected and the
 *     editor is editable.
 *
 * Coordination model: extends `CustomImageNodeViewProps` (from `./node-view`)
 * with parent-provided callbacks (`setEditorContainer`, `setFailedToLoadImage`)
 * and resolved URLs (`src`, `downloadSrc`) that the parent computes from the
 * uploader pipeline.
 *
 * Selection & resize: uses `NodeSelection` (`@tiptap/pm/state`) to make this
 * node the editor's current selection on click; tracks pointer position during
 * resize and computes a new width while preserving the image's intrinsic
 * aspect ratio. On touch devices the editor is blurred before selection so the
 * on-screen keyboard does not overlap the image toolbar.
 *
 * Image-load error recovery: when `<img>` fires `onError`, calls
 * `extension.options.restoreImage(src)` exactly once (gated by
 * `hasTriedRestoringImageOnce`) before surrendering to the parent's
 * "failed to load" view.
 *
 * Cross-extension dependency: reads
 * `editor.storage.utility.isTouchDevice` (registered by `UtilityExtension`)
 * to vary touch-device interaction — see also `./uploader.tsx`.
 *
 * Consumed by: `./node-view.tsx` (rendered when `shouldShowBlock` is true).
 */

import { NodeSelection } from "@tiptap/pm/state";
import React, { useRef, useState, useCallback, useLayoutEffect, useEffect } from "react";
// plane imports
import { cn } from "@plane/utils";
// local imports
import { ECustomImageAttributeNames } from "../types";
import type { Pixel, TCustomImageAttributes, TCustomImageSize } from "../types";
import { ensurePixelString, getImageBlockId, isImageDuplicating } from "../utils";
import type { CustomImageNodeViewProps } from "./node-view";
import { ImageToolbarRoot } from "./toolbar";
import { ImageUploadStatus } from "./upload-status";

/**
 * Minimum image width/height in pixels during resize — prevents the resize
 * handle from collapsing the image to zero pixels, which would make further
 * interaction impossible.
 */
const MIN_SIZE = 100;

/**
 * Props for `CustomImageBlock`.
 *
 * Inherits all fields from `CustomImageNodeViewProps` (see `./node-view`) and
 * adds:
 *   - `editorContainer`: cached reference to the closest `.editor-container`
 *     element, used for sizing the image as a percentage of editor width on
 *     first load.
 *   - `imageFromFileSystem`: blob URL of the local file shown as a preview
 *     while the network upload is in flight.
 *   - `setEditorContainer`: parent-provided setter so this component can hand
 *     back the discovered editor container.
 *   - `setFailedToLoadImage`: parent-provided setter; called when restoration
 *     fails and the parent should switch to the uploader/error view.
 *   - `src`: resolved display URL (signed, short-lived) for the uploaded
 *     image.
 *   - `downloadSrc`: resolved download URL (signed, with
 *     `Content-Disposition: attachment`) passed to the toolbar download
 *     action.
 */
type CustomImageBlockProps = CustomImageNodeViewProps & {
  editorContainer: HTMLDivElement | null;
  imageFromFileSystem: string | undefined;
  setEditorContainer: (editorContainer: HTMLDivElement | null) => void;
  setFailedToLoadImage: (isError: boolean) => void;
  src: string | undefined;
  downloadSrc: string | undefined;
};

/**
 * Renders the interactive image block (image, loader, toolbar, selection
 * overlay, and resize handle) for an uploaded custom-image node.
 *
 * Required props: all fields of `CustomImageBlockProps` (see the type's JSDoc
 * above for per-field semantics).
 *
 * MobX stores read: NONE (editor-internal — all state is held on the TipTap
 * editor and on this component's local React state).
 *
 * Side effects:
 *   - On image load: persists computed initial width / aspect ratio to node
 *     attrs via `updateAttributesSafely`.
 *   - On resize end: persists final width/height to node attrs.
 *   - On image-load error: tries `extension.options.restoreImage(src)` once
 *     before reporting failure to the parent.
 *   - On click: dispatches a `NodeSelection` transaction on the editor's
 *     view, making this image the editor's current selection.
 *   - On touch click: calls `editor.commands.blur()` before selecting the
 *     node, dismissing the on-screen keyboard.
 */
export function CustomImageBlock(props: CustomImageBlockProps) {
  // props
  const {
    editor,
    editorContainer,
    extension,
    getPos,
    imageFromFileSystem,
    node,
    selected,
    setEditorContainer,
    setFailedToLoadImage,
    src: resolvedImageSrc,
    downloadSrc: resolvedDownloadSrc,
    updateAttributes,
  } = props;
  const {
    width: nodeWidth,
    height: nodeHeight,
    aspectRatio: nodeAspectRatio,
    src: imgNodeSrc,
    alignment: nodeAlignment,
    status,
  } = node.attrs;
  // states
  const [size, setSize] = useState<TCustomImageSize>({
    width: ensurePixelString(nodeWidth, "35%") ?? "35%",
    height: ensurePixelString(nodeHeight, "auto") ?? "auto",
    aspectRatio: nodeAspectRatio || null,
  });
  const [isResizing, setIsResizing] = useState(false);
  const [initialResizeComplete, setInitialResizeComplete] = useState(false);
  // refs
  const containerRef = useRef<HTMLDivElement>(null);
  const containerRect = useRef<DOMRect | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [hasErroredOnFirstLoad, setHasErroredOnFirstLoad] = useState(false);
  const [hasTriedRestoringImageOnce, setHasTriedRestoringImageOnce] = useState(false);
  // extension options
  // editor.storage.utility is owned by UtilityExtension; isTouchDevice gates
  // keyboard-dismiss-on-tap behavior in handleImageMouseDown. The cast is a
  // defensive narrowing because the cross-extension storage augmentation is
  // declared on UtilityExtension, not on this extension's storage.
  const isTouchDevice = !!(editor.storage.utility as { isTouchDevice?: boolean } | undefined)?.isTouchDevice;

  /**
   * Wraps `updateAttributes` in try/catch because mid-resize the editor state
   * may transition (e.g., node deleted via undo) and `updateAttributes` will
   * throw; swallow the error so an in-flight resize cannot break the editing
   * session.
   */
  const updateAttributesSafely = useCallback(
    (attributes: Partial<TCustomImageAttributes>, errorMessage: string) => {
      try {
        updateAttributes(attributes);
      } catch (error) {
        console.error(`${errorMessage}:`, error);
      }
    },
    [updateAttributes]
  );

  /**
   * On first load: derives initial display width from the editor container
   * width (35% of container, floored to `MIN_SIZE`) when the node has never
   * been sized.
   *
   * On subsequent loads: only updates the stored aspect ratio if the natural
   * ratio disagrees with the stored one — covers older images persisted
   * without an `aspectRatio` attribute.
   */
  const handleImageLoad = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;
    let closestEditorContainer: HTMLDivElement | null = null;

    if (editorContainer) {
      closestEditorContainer = editorContainer;
    } else {
      closestEditorContainer = img.closest(".editor-container");
      if (!closestEditorContainer) {
        console.error("Editor container not found");
        return;
      }
    }
    if (!closestEditorContainer) {
      console.error("Editor container not found");
      return;
    }

    setEditorContainer(closestEditorContainer);
    const aspectRatioCalculated = img.naturalWidth / img.naturalHeight;

    if (nodeWidth === "35%") {
      const editorWidth = closestEditorContainer.clientWidth;
      const initialWidth = Math.max(editorWidth * 0.35, MIN_SIZE);
      const initialHeight = initialWidth / aspectRatioCalculated;

      const initialComputedSize: TCustomImageSize = {
        width: `${Math.round(initialWidth)}px` satisfies Pixel,
        height: `${Math.round(initialHeight)}px` satisfies Pixel,
        aspectRatio: aspectRatioCalculated,
      };
      setSize(initialComputedSize);
      updateAttributesSafely(
        initialComputedSize,
        "Failed to update attributes while initializing an image for the first time:"
      );
    } else {
      // as the aspect ratio in not stored for old images, we need to update the attrs
      // or if aspectRatioCalculated from the image's width and height doesn't match stored aspectRatio then also we'll update the attrs
      if (!nodeAspectRatio || nodeAspectRatio !== aspectRatioCalculated) {
        setSize((prevSize) => {
          const newSize = { ...prevSize, aspectRatio: aspectRatioCalculated };
          updateAttributesSafely(
            newSize,
            "Failed to update attributes while initializing images with width but no aspect ratio:"
          );
          return newSize;
        });
      }
    }
    setInitialResizeComplete(true);
  }, [nodeWidth, updateAttributesSafely, editorContainer, nodeAspectRatio, setEditorContainer]);

  // for real time resizing
  useLayoutEffect(() => {
    setSize((prevSize) => ({
      ...prevSize,
      width: ensurePixelString(nodeWidth) ?? "35%",
      height: ensurePixelString(nodeHeight) ?? "auto",
      aspectRatio: nodeAspectRatio,
    }));
  }, [nodeWidth, nodeHeight, nodeAspectRatio]);

  /**
   * Tracks pointer motion during resize. When the image is right-aligned, the
   * resize handle is on the left edge, so the width is computed from
   * `containerRect.right - clientX` rather than `clientX - containerRect.left`.
   * Width is clamped to `MIN_SIZE`; height is derived from
   * `width / aspectRatio` to preserve the image's intrinsic proportions.
   */
  const handleResize = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current || !containerRect.current || !size.aspectRatio) return;

      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;

      if (nodeAlignment === "right") {
        const newWidth = Math.max(containerRect.current.right - clientX, MIN_SIZE);
        const newHeight = newWidth / size.aspectRatio;
        setSize((prevSize) => ({ ...prevSize, width: `${newWidth}px`, height: `${newHeight}px` }));
      } else {
        const newWidth = Math.max(clientX - containerRect.current.left, MIN_SIZE);
        const newHeight = newWidth / size.aspectRatio;
        setSize((prevSize) => ({ ...prevSize, width: `${newWidth}px`, height: `${newHeight}px` }));
      }
    },
    [nodeAlignment, size.aspectRatio]
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    updateAttributesSafely(size, "Failed to update attributes at the end of resizing:");
  }, [size, updateAttributesSafely]);

  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    if (containerRef.current) {
      containerRect.current = containerRef.current.getBoundingClientRect();
    }
  }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", handleResize);
      window.addEventListener("mouseup", handleResizeEnd);
      window.addEventListener("mouseleave", handleResizeEnd);
      window.addEventListener("touchmove", handleResize);
      window.addEventListener("touchend", handleResizeEnd);

      return () => {
        window.removeEventListener("mousemove", handleResize);
        window.removeEventListener("mouseup", handleResizeEnd);
        window.removeEventListener("mouseleave", handleResizeEnd);
        window.removeEventListener("touchmove", handleResize);
        window.removeEventListener("touchend", handleResizeEnd);
      };
    }
  }, [isResizing, handleResize, handleResizeEnd]);

  /**
   * On touch devices, blurs the editor first so the on-screen keyboard is
   * dismissed before the image selection takes focus — without this, the
   * keyboard remains open and overlaps the image toolbar.
   */
  const handleImageMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isTouchDevice) {
        e.preventDefault();
        editor.commands.blur();
      }
      const pos = getPos();
      if (pos === undefined) return;
      const nodeSelection = NodeSelection.create(editor.state.doc, pos);
      editor.view.dispatch(editor.state.tr.setSelection(nodeSelection));
    },
    [editor, getPos, isTouchDevice]
  );

  /**
   * Derived visibility predicates that gate which UI elements are rendered:
   *   - `showImageLoader`: pulse skeleton during initial resolve /
   *     aspect-ratio normalization / first-load error / duplication.
   *   - `showUploadStatus`: percentage badge while no resolved `src` and not
   *     duplicating.
   *   - `showImageToolbar`: contextual toolbar once `src` + `downloadSrc`
   *     are resolved and the initial resize has completed.
   *   - `showImageResizer`: resize handle only when the editor is editable
   *     and the image has settled into its computed size.
   */
  const isDuplicating = isImageDuplicating(status);
  // show the image loader if the remote image's src or preview image from filesystem is not set yet (while loading the image post upload) (or)
  // if the initial resize (from 35% width and "auto" height attrs to the actual size in px) is not complete
  const showImageLoader =
    (!resolvedImageSrc && !isDuplicating) || !initialResizeComplete || hasErroredOnFirstLoad || isDuplicating; // show the image upload status only when the resolvedImageSrc is not ready
  const showUploadStatus = !resolvedImageSrc && !isDuplicating;
  // show the image utils only if the remote image's (post upload) src is set and the initial resize is complete (but not while we're showing the preview imageFromFileSystem)
  const showImageToolbar = resolvedImageSrc && resolvedDownloadSrc && initialResizeComplete && !isDuplicating;
  // show the image resizer only if the editor is editable, the remote image's (post upload) src is set and the initial resize is complete (but not while we're showing the preview imageFromFileSystem)
  const showImageResizer = editor.isEditable && resolvedImageSrc && initialResizeComplete && !isDuplicating;
  // show the preview image from the file system if the remote image's src is not set
  const displayedImageSrc = resolvedImageSrc || imageFromFileSystem;

  return (
    <div
      id={
        node.attrs[ECustomImageAttributeNames.ID]
          ? getImageBlockId(node.attrs[ECustomImageAttributeNames.ID])
          : undefined
      }
      className={cn("w-fit max-w-full transition-all", {
        "ml-[50%] -translate-x-1/2": nodeAlignment === "center",
        "ml-[100%] -translate-x-full": nodeAlignment === "right",
      })}
    >
      <div
        ref={containerRef}
        className="group/image-component relative inline-block max-w-full"
        onMouseDown={handleImageMouseDown}
        style={{
          width: size.width,
          ...(size.aspectRatio && { aspectRatio: size.aspectRatio }),
        }}
      >
        {showImageLoader && (
          <div className="animate-pulse rounded-md bg-layer-1" style={{ width: size.width, height: size.height }} />
        )}
        <img
          ref={imageRef}
          src={displayedImageSrc}
          alt=""
          onLoad={handleImageLoad}
          /**
           * Image-load error recovery: tries `extension.options.restoreImage(src)`
           * once (gated by `hasTriedRestoringImageOnce`) before surrendering to
           * the parent's failure view. On touch devices, re-resolves via
           * `getImageSource` because the signed URL may have expired between
           * the failed load and the retry.
           */
          onError={(_e) =>
            void (async () => {
              // for old image extension this command doesn't exist or if the image failed to load for the first time
              if (!extension.options.restoreImage || hasTriedRestoringImageOnce) {
                setFailedToLoadImage(true);
                return;
              }

              try {
                setHasErroredOnFirstLoad(true);
                // this is a type error from tiptap, don't remove await until it's fixed
                if (!imgNodeSrc) {
                  throw new Error("No source image to restore from");
                }
                await extension.options.restoreImage?.(imgNodeSrc);
                if (!imageRef.current) {
                  throw new Error("Image reference not found");
                }
                if (!resolvedImageSrc) {
                  throw new Error("No resolved image source available");
                }
                if (isTouchDevice) {
                  const refreshedSrc = await extension.options.getImageSource?.(imgNodeSrc);
                  imageRef.current.src = refreshedSrc;
                } else {
                  imageRef.current.src = resolvedImageSrc;
                }
              } catch (error) {
                // if the image failed to even restore, then show the error state
                setFailedToLoadImage(true);
                console.error("Error while loading image", error);
              } finally {
                setHasErroredOnFirstLoad(false);
                setHasTriedRestoringImageOnce(true);
              }
            })()
          }
          width={size.width}
          className={cn("image-component block rounded-md", {
            // hide the image while the background calculations of the image loader are in progress (to avoid flickering) and show the loader until then
            hidden: showImageLoader,
            "read-only-image": !editor.isEditable,
            "loading-image opacity-80 blur-sm": !resolvedImageSrc,
          })}
          style={{
            width: size.width,
            ...(size.aspectRatio && { aspectRatio: size.aspectRatio }),
          }}
        />
        {showUploadStatus && node.attrs[ECustomImageAttributeNames.ID] && (
          <ImageUploadStatus editor={editor} nodeId={node.attrs[ECustomImageAttributeNames.ID]} />
        )}
        {showImageToolbar && (
          <ImageToolbarRoot
            alignment={nodeAlignment ?? "left"}
            editor={editor}
            aspectRatio={size.aspectRatio === null ? 1 : size.aspectRatio}
            downloadSrc={resolvedDownloadSrc}
            handleAlignmentChange={(alignment) =>
              updateAttributesSafely({ alignment }, "Failed to update attributes while changing alignment:")
            }
            height={size.height}
            isTouchDevice={isTouchDevice}
            width={size.width}
            src={resolvedImageSrc}
          />
        )}
        {selected && displayedImageSrc === resolvedImageSrc && (
          <div className="pointer-events-none absolute inset-0 size-full bg-accent-primary/30" />
        )}
        {showImageResizer && (
          <>
            <div
              className={cn(
                "pointer-events-none absolute inset-0 rounded-md border-2 border-accent-strong transition-opacity duration-100 ease-in-out",
                {
                  "opacity-100": isResizing,
                  "opacity-0 group-hover/image-component:opacity-100": !isResizing,
                }
              )}
            />
            <div
              className={cn(
                "absolute bottom-0 size-4 translate-y-1/2 rounded-full border-2 border-white bg-accent-primary transition-opacity duration-100 ease-in-out",
                {
                  "pointer-events-auto opacity-100": isResizing,
                  "pointer-events-none opacity-0 group-hover/image-component:pointer-events-auto group-hover/image-component:opacity-100":
                    !isResizing,
                  "left-0 -translate-x-1/2 cursor-nesw-resize": nodeAlignment === "right",
                  "right-0 translate-x-1/2 cursor-nwse-resize": nodeAlignment !== "right",
                }
              )}
              onMouseDown={handleResizeStart}
              onTouchStart={handleResizeStart}
            />
          </>
        )}
      </div>
    </div>
  );
}
