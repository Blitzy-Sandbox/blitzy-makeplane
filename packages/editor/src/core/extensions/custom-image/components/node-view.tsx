/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top-level React node view rendered by `CustomImageExtensionConfig` (the
 * custom-image Tiptap node) via `ReactNodeViewRenderer`. Coordinates two
 * mutually-exclusive display modes for a single custom-image node:
 *
 *   1. `CustomImageBlock` (./block.tsx) — the rendered image with resize
 *      handle, toolbar, and selection overlay; shown once the image is fully
 *      uploaded and a resolved URL is available.
 *   2. `CustomImageUploader` (./uploader.tsx) — the drop zone / file picker
 *      with error and retry UI; shown when the image has not yet been
 *      uploaded, has failed to load, or has failed to duplicate.
 *
 * State coordination owned here:
 *   - Source-resolution lifecycle: drives `extension.options.getImageSource`
 *     and `extension.options.getImageDownloadSource` whenever `node.attrs.src`
 *     changes, surfacing failures via the local `failedToLoadImage` flag.
 *   - Duplication lifecycle: when the node enters
 *     `ECustomImageStatus.DUPLICATING` (typical after a copy-paste of an
 *     existing image), `extension.options.duplicateImage` is invoked and the
 *     resulting asset id + `UPLOADED` status are written back via
 *     `updateAttributes`; on failure the status transitions to
 *     `DUPLICATION_FAILED` instead.
 *   - One-shot auto-retry on mount: a node that mounts already in
 *     `DUPLICATION_FAILED` (e.g., the document was reloaded after a failed
 *     paste) is flipped back to `DUPLICATING` exactly once via the
 *     `hasRetriedOnMount` ref to attempt automatic recovery; after that the
 *     user must use the uploader's manual Retry button.
 *   - Editor-container discovery: walks up the DOM from `imageComponentRef`
 *     to find the nearest `.editor-container`, which `CustomImageBlock`
 *     uses to size the image as a percentage of editor width on first load.
 *
 * Cross-extension dependency: reads `editor.storage.imageComponent.maxFileSize`
 * for the uploader's max-file-size check. The `imageComponent` storage
 * augmentation is declared in `../extension-config.ts`; the
 * `as { maxFileSize?: number }` cast at the read site is a defensive
 * narrowing for the optional read because the storage may be partially
 * initialized during the initial render of the node.
 *
 * The `hasImageDuplicationFailed(status)` predicate (`../utils`) is the
 * duplication-failure check used here; the sibling `isImageDuplicating`
 * predicate is consumed by `./block.tsx` instead.
 *
 * Consumed by: Tiptap's `ReactNodeViewRenderer`, wired in `../extension.tsx`
 * (which is itself registered with the editor through `@/core/extensions`).
 */

import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
// local imports
import type { CustomImageExtensionType, TCustomImageAttributes } from "../types";
import { ECustomImageAttributeNames, ECustomImageStatus } from "../types";
import { hasImageDuplicationFailed } from "../utils";
import { CustomImageBlock } from "./block";
import { CustomImageUploader } from "./uploader";

/**
 * Props for {@link CustomImageNodeView}. A typed extension of Tiptap's
 * `NodeViewProps` that narrows three slots so the rest of the custom-image
 * components module can rely on the custom shape:
 *
 *   - `extension` is narrowed to `CustomImageExtensionType`, exposing the
 *     `getImageSource`, `getImageDownloadSource`, and `duplicateImage`
 *     callbacks declared on the extension's `options`.
 *   - `node.attrs` is narrowed to `TCustomImageAttributes` so attribute
 *     reads are typed against the custom-image attribute schema.
 *   - `updateAttributes` is narrowed from Tiptap's base
 *     `(attrs: Record<string, any>) => void` to
 *     `(attrs: Partial<TCustomImageAttributes>) => void` so callers in this
 *     module cannot accidentally write arbitrary keys.
 *
 * Re-used by `CustomImageBlockProps` (./block.tsx) and
 * `CustomImageUploaderProps` (./uploader.tsx) via type intersection — both
 * child components inherit this narrowed shape.
 */
export type CustomImageNodeViewProps = Omit<NodeViewProps, "extension" | "updateAttributes"> & {
  extension: CustomImageExtensionType;
  node: NodeViewProps["node"] & {
    attrs: TCustomImageAttributes;
  };
  updateAttributes: (attrs: Partial<TCustomImageAttributes>) => void;
};

/**
 * Coordinates the two display modes of a custom-image node — the
 * fully-rendered block view (`CustomImageBlock`) and the uploader / error
 * fallback (`CustomImageUploader`) — based on upload, source-resolution,
 * and duplication state.
 *
 * Required props (all from {@link CustomImageNodeViewProps}):
 *   - `editor`: the active Tiptap `Editor`; only `editor.storage.imageComponent`
 *     is read here (for `maxFileSize`).
 *   - `extension`: the typed `CustomImageExtensionType`; its `options` supply
 *     `getImageSource`, `getImageDownloadSource`, and `duplicateImage`.
 *   - `node`: the ProseMirror node; `node.attrs.src` and `node.attrs.status`
 *     drive every effect below.
 *   - `updateAttributes`: narrowed setter used to commit duplication results
 *     and auto-retry transitions back into the node attrs.
 *   - All other `NodeViewProps` fields (e.g., `getPos`, `selected`) are
 *     forwarded as `{...props}` to the chosen child component.
 *
 * MobX stores read: none (this is editor-internal state only).
 *
 * Side effects:
 *   - On `node.attrs.src` change: invokes
 *     `extension.options.getImageSource(src)` and
 *     `extension.options.getImageDownloadSource(src)` asynchronously; sets
 *     `failedToLoadImage` on rejection.
 *   - On `node.attrs.status === DUPLICATING`: invokes
 *     `extension.options.duplicateImage(src)` and writes
 *     `updateAttributes({ src: newAssetId, status: UPLOADED })` on success
 *     or `updateAttributes({ status: DUPLICATION_FAILED })` on failure.
 *   - On mount when `node.attrs.status === DUPLICATION_FAILED`: writes
 *     `updateAttributes({ status: DUPLICATING })` exactly once to auto-retry.
 *
 * Returns: a `<NodeViewWrapper>` keyed by `node.attrs[ID]` (so a new asset
 * id from duplication forces a clean remount) containing either
 * `<CustomImageBlock>` or `<CustomImageUploader>`.
 */
export function CustomImageNodeView(props: CustomImageNodeViewProps) {
  const { editor, extension, node, updateAttributes } = props;
  const { src: imgNodeSrc, status } = node.attrs;

  const [isUploaded, setIsUploaded] = useState(!!imgNodeSrc);
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(undefined);
  const [resolvedDownloadSrc, setResolvedDownloadSrc] = useState<string | undefined>(undefined);
  const [imageFromFileSystem, setImageFromFileSystem] = useState<string | undefined>(undefined);
  const [failedToLoadImage, setFailedToLoadImage] = useState(false);

  const [editorContainer, setEditorContainer] = useState<HTMLDivElement | null>(null);
  const imageComponentRef = useRef<HTMLDivElement>(null);
  const hasRetriedOnMount = useRef(false);
  const isDuplicatingRef = useRef(false);

  /**
   * Walks up the DOM from this node view to find the nearest `.editor-container`
   * element; `CustomImageBlock` uses this on first image load to size the
   * image as a percentage of editor width.
   */
  useEffect(() => {
    const closestEditorContainer = imageComponentRef.current?.closest(".editor-container");
    if (closestEditorContainer) {
      setEditorContainer(closestEditorContainer as HTMLDivElement);
    }
  }, []);

  // the image is already uploaded if the image-component node has src attribute
  // and we need to remove the blob from our file system
  useEffect(() => {
    if (resolvedSrc || imgNodeSrc) {
      setIsUploaded(true);
      setImageFromFileSystem(undefined);
    } else {
      setIsUploaded(false);
    }
  }, [resolvedSrc, imgNodeSrc]);

  useEffect(() => {
    if (!imgNodeSrc) {
      setResolvedSrc(undefined);
      setResolvedDownloadSrc(undefined);
      return;
    }

    setResolvedSrc(undefined);
    setResolvedDownloadSrc(undefined);
    setFailedToLoadImage(false);

    const getImageSource = async () => {
      try {
        const url = await extension.options.getImageSource?.(imgNodeSrc);
        setResolvedSrc(url);
        const downloadUrl = await extension.options.getImageDownloadSource?.(imgNodeSrc);
        setResolvedDownloadSrc(downloadUrl);
      } catch (error) {
        console.error("Error fetching image source:", error);
        setFailedToLoadImage(true);
      }
    };
    void getImageSource();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgNodeSrc, extension.options.getImageSource, extension.options.getImageDownloadSource]);

  /**
   * Duplication lifecycle: when a copy-pasted image enters DUPLICATING, calls
   * `extension.options.duplicateImage(src)` to create a server-side copy of
   * the asset, then writes the new asset id + UPLOADED status back to node
   * attrs.
   *
   * `isDuplicatingRef` prevents concurrent duplicate calls if React re-runs
   * the effect before the previous in-flight call resolves.
   * `hasRetriedOnMount` is set here so that an in-flight duplicate counts as
   * a retry and we don't loop via the DUPLICATION_FAILED auto-retry effect
   * below.
   */
  useEffect(() => {
    const handleDuplication = async () => {
      if (status !== ECustomImageStatus.DUPLICATING || !extension.options.duplicateImage || !imgNodeSrc) {
        return;
      }

      // Prevent duplicate calls - check if already duplicating this asset
      if (isDuplicatingRef.current) {
        return;
      }

      isDuplicatingRef.current = true;
      try {
        hasRetriedOnMount.current = true;

        const newAssetId = await extension.options.duplicateImage(imgNodeSrc);

        if (!newAssetId) {
          throw new Error("Duplication returned invalid asset ID");
        }

        setFailedToLoadImage(false);
        updateAttributes({ src: newAssetId, status: ECustomImageStatus.UPLOADED });
      } catch (error: unknown) {
        console.error("Failed to duplicate image:", error);
        // Update status to failed
        updateAttributes({ status: ECustomImageStatus.DUPLICATION_FAILED });
      } finally {
        isDuplicatingRef.current = false;
      }
    };

    void handleDuplication();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, imgNodeSrc, extension.options.duplicateImage, updateAttributes]);

  /**
   * One-shot auto-retry: if the node mounts already in DUPLICATION_FAILED,
   * flip status back to DUPLICATING to trigger the duplication useEffect
   * above. Gated by `hasRetriedOnMount.current` so we attempt this exactly
   * once per component lifetime — subsequent failures are surrendered to
   * the uploader's manual Retry button.
   */
  useEffect(() => {
    if (hasImageDuplicationFailed(status) && !hasRetriedOnMount.current && imgNodeSrc) {
      hasRetriedOnMount.current = true;
      // Add a small delay before retrying to avoid immediate retries
      updateAttributes({ status: ECustomImageStatus.DUPLICATING });
    }
  }, [status, imgNodeSrc, updateAttributes]);

  /**
   * Reset retry-tracking + clear failure flags on transition to UPLOADED so
   * a re-upload after a failure cleanly returns to the block view.
   */
  useEffect(() => {
    if (status === ECustomImageStatus.UPLOADED) {
      hasRetriedOnMount.current = false;
      setFailedToLoadImage(false);
    }
  }, [status]);

  const hasDuplicationFailed = hasImageDuplicationFailed(status);
  const hasValidImageSource = imageFromFileSystem || (isUploaded && resolvedSrc);
  const shouldShowBlock = hasValidImageSource && !failedToLoadImage && !hasDuplicationFailed;

  return (
    <NodeViewWrapper key={node.attrs[ECustomImageAttributeNames.ID]}>
      <div className="mx-0 my-2 p-0" data-drag-handle ref={imageComponentRef}>
        {shouldShowBlock && !hasDuplicationFailed ? (
          <CustomImageBlock
            editorContainer={editorContainer}
            imageFromFileSystem={imageFromFileSystem}
            setEditorContainer={setEditorContainer}
            setFailedToLoadImage={setFailedToLoadImage}
            src={resolvedSrc}
            downloadSrc={resolvedDownloadSrc}
            {...props}
          />
        ) : (
          /**
           * `editor.storage.imageComponent.maxFileSize` is augmented onto
           * Tiptap's storage type in `../extension-config.ts`; the defensive
           * `as { maxFileSize?: number }` cast at the read site narrows to
           * the optional shape because the storage may be partially
           * initialized during the initial render of the node.
           */
          <CustomImageUploader
            failedToLoadImage={failedToLoadImage}
            hasDuplicationFailed={hasDuplicationFailed}
            loadImageFromFileSystem={setImageFromFileSystem}
            maxFileSize={(editor.storage.imageComponent as { maxFileSize?: number } | undefined)?.maxFileSize ?? 0}
            setIsUploaded={setIsUploaded}
            {...props}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}
