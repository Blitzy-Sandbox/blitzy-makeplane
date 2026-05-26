/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Drag affordance button used as a handle to initiate drag interactions in sortable lists.
 */

import { MoreVertical } from "lucide-react";
import React, { forwardRef } from "react";
// helpers
import { cn } from "./utils";

interface IDragHandle {
  className?: string;
  disabled?: boolean;
}

/**
 * Ref-forwarding drag-affordance button rendering stacked `MoreVertical` icons as a grip handle.
 *
 * When `disabled=true`, returns a non-interactive sized placeholder `div` to preserve layout
 * without exposing a draggable target. The button suppresses the native right-click menu so it
 * does not interfere with drag-and-drop gestures attached by consumers (e.g., Atlaskit pragmatic DnD).
 *
 * Props (see `IDragHandle`):
 *   - `className`: extra Tailwind classes merged onto the rendered button.
 *   - `disabled`: when true, renders a layout-preserving placeholder instead of the button.
 *
 * Accessibility: native `<button type="button">` semantics; ref is forwarded so consumers can
 * attach drag listeners. INTENT UNCLEAR: `disabled` does not add `aria-disabled` because the
 * disabled branch removes the button element entirely rather than disabling it in place.
 */
export const DragHandle = forwardRef(function DragHandle(
  props: IDragHandle,
  ref: React.ForwardedRef<HTMLButtonElement | null>
) {
  const { className, disabled = false } = props;

  if (disabled) {
    return <div className="h-[18px] w-[14px]" />;
  }

  return (
    <button
      type="button"
      className={cn("flex flex-shrink-0 cursor-grab rounded-sm bg-surface-2 p-0.5 text-secondary", className)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      ref={ref}
    >
      <MoreVertical className="h-3.5 w-3.5 stroke-placeholder" />
      <MoreVertical className="-ml-5 h-3.5 w-3.5 stroke-placeholder" />
    </button>
  );
});

DragHandle.displayName = "DragHandle";
