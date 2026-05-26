/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Thin CE wrapper around `LinkViewContainer` from `core/components/editors/link-view-container`.
 *
 * This component forwards the editor instance and container DOM ref unchanged
 * to the shared link-view UI. The wrapper exists to preserve a stable mount
 * point so the EE namespace can substitute an alternative link-view container
 * (e.g., one that adds enterprise-specific link previews) without changing the
 * consumer call sites in `core/components/editors/`.
 */

import type { Editor } from "@tiptap/core";
import { LinkViewContainer } from "@/components/editors/link-view-container";

/**
 * Mounts the shared link-view UI bound to the given TipTap `Editor` instance and container DOM ref.
 *
 * The indirection through this CE wrapper (rather than importing
 * `LinkViewContainer` directly at consumer call sites) is the substitution
 * seam for the EE namespace — EE may swap this file to inject enterprise-specific
 * link rendering without modifying any consumer.
 *
 * @param editor       TipTap `Editor` instance the link view reads link state from.
 * @param containerRef DOM ref to the editor container element that anchors the
 *                     link-view positioning.
 */
export function LinkContainer({
  editor,
  containerRef,
}: {
  editor: Editor;
  containerRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <>
      <LinkViewContainer editor={editor} containerRef={containerRef} />
    </>
  );
}
