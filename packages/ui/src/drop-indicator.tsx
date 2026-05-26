/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Visual insertion marker rendered between drag-and-drop list items to indicate the active drop position.
 */

import React from "react";
import { cn } from "./utils";

type Props = {
  isVisible: boolean;
  classNames?: string;
};

/**
 * Renders a purely visual horizontal accent bar (with circular end-caps via `before`/`after`
 * pseudo-elements) used as the drop-position indicator inside drag-and-drop list interactions.
 *
 * The DOM node is always rendered so its layout slot is reserved across drag states; only the
 * accent color toggles via `isVisible`, avoiding layout shift on drag-enter/drag-leave.
 *
 * Props (see local `Props` type):
 *   - `isVisible`: when true, paints the accent color; when false, the element renders transparently.
 *   - `classNames`: optional Tailwind class overrides merged after the built-in geometry classes.
 *
 * Accessibility: presentational only — no ARIA role is applied because drag-and-drop semantics
 * are owned by the surrounding sortable container, not this leaf marker.
 */
export function DropIndicator(props: Props) {
  const { isVisible, classNames = "" } = props;

  return (
    <div
      className={cn(
        `relative block h-[2px] w-full before:relative before:top-[-2px] before:left-0 before:block before:h-[6px] before:w-[6px] before:rounded-sm after:relative after:top-[-8px] after:left-[calc(100%-6px)] after:block after:h-[6px] after:w-[6px] after:rounded-sm`,
        {
          "bg-accent-primary before:bg-accent-primary after:bg-accent-primary": isVisible,
        },
        classNames
      )}
    />
  );
}
