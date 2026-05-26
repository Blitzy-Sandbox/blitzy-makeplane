/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compact upload-progress badge rendered as an overlay on a custom-image node while the
 * image is being uploaded to object storage.
 *
 * Cross-extension contract: progress is read from
 * `editor.storage.utility?.assetsUploadStatus?.[nodeId]` — a `Record<string, number>` map
 * owned by the `UtilityExtension` and written by `CustomImageUploader.handleProgressStatus`
 * in `./uploader.tsx`. The partner boolean `editor.storage.utility.uploadInProgress` is
 * also written from that uploader callback and consumed by external code (e.g., the
 * document save pipeline) to detect any in-progress upload.
 *
 * Returns `null` when no upload is in progress for `nodeId` (i.e., `uploadStatus === undefined`).
 * The source progress value may jump in discrete steps (e.g., 0 → 25 → 50 → 100); a local
 * `displayStatus` interpolates between consecutive samples over 200ms with an `easeOutCubic`
 * curve via `requestAnimationFrame`, and the pending frame is cancelled on unmount with
 * `cancelAnimationFrame` to avoid setState-after-unmount warnings.
 *
 * Subscribes via `useEditorState` so the component only re-renders when
 * `assetsUploadStatus[nodeId]` changes — not on every editor transaction.
 *
 * Consumer: rendered by `./block.tsx` inside the custom-image node view as
 * `<ImageUploadStatus editor={editor} nodeId={node.attrs[ECustomImageAttributeNames.ID]} />`.
 */

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

/**
 * Props for {@link ImageUploadStatus}.
 *
 * - `editor`: the Tiptap `Editor` instance whose `storage.utility.assetsUploadStatus` map
 *   is read for the current upload progress.
 * - `nodeId`: the per-image UUID (set as `node.attrs.id` at insertion time) used as the
 *   key into `assetsUploadStatus` — uniquely identifies which image's progress to render.
 */
type Props = {
  editor: Editor;
  nodeId: string;
};

/**
 * Renders a compact percentage badge in the top-right corner of an uploading image,
 * hidden when no upload is in progress for the given node.
 *
 * Side effects: none on editor state — owns only local `displayStatus` React state and an
 * `animationFrameRef` whose pending `requestAnimationFrame` is cancelled on unmount.
 *
 * Returns: a `<div>` percentage badge positioned absolutely over the image, or `null`
 * when `uploadStatus === undefined` (no upload in progress for this `nodeId`).
 */
export function ImageUploadStatus(props: Props) {
  const { editor, nodeId } = props;
  // Displayed status that will animate smoothly
  const [displayStatus, setDisplayStatus] = useState(0);
  // Animation frame ID for cleanup
  const animationFrameRef = useRef<number | null>(null);
  // subscribe to image upload status
  const uploadStatus: number | undefined = useEditorState({
    editor,
    selector: ({ editor }) => editor.storage.utility?.assetsUploadStatus?.[nodeId],
  });

  useEffect(() => {
    // Smooth out discrete upload-progress jumps (e.g., 0→25→50→100) so the badge counts up visually rather than snapping; eases over 200ms with cubic deceleration.
    const animateToValue = (start: number, end: number, startTime: number) => {
      const duration = 200;

      const animation = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function for smooth animation
        const easeOutCubic = 1 - Math.pow(1 - progress, 3);

        // Calculate current display value
        const currentValue = Math.floor(start + (end - start) * easeOutCubic);
        setDisplayStatus(currentValue);

        // Continue animation if not complete
        if (progress < 1) {
          animationFrameRef.current = requestAnimationFrame((time) => animation(time));
        }
      };
      animationFrameRef.current = requestAnimationFrame((time) => animation(time));
    };
    animateToValue(displayStatus, uploadStatus == undefined ? 100 : uploadStatus, performance.now());

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [displayStatus, uploadStatus]);

  if (uploadStatus === undefined) return null;

  return (
    <div className="absolute top-1 right-1 z-20 w-10 rounded-sm bg-black/60 text-center text-11 font-medium">
      {displayStatus}%
    </div>
  );
}
