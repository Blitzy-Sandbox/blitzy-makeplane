/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * React hook that auto-resizes a textarea element to fit its content height as the user types.
 *
 * Consumed by `packages/ui/src/form-fields/textarea.tsx` to give variable-length inputs
 * (issue descriptions, comments) a flicker-free growing/shrinking surface.
 */

import { useLayoutEffect } from "react";

/**
 * Imperatively resizes a textarea's `style.height` to match its content's `scrollHeight`.
 *
 * Runs in `useLayoutEffect` so the resize is committed before the browser paints, avoiding
 * the single-frame flicker that `useEffect` would introduce. Re-runs whenever `value` changes;
 * no window-resize listener is attached, so layout-driven width changes do not retrigger sizing.
 *
 * @param textAreaRef Ref to the `<textarea>` element whose `style.height` is mutated in place.
 * @param value Current controlled value of the textarea; identity change drives reflow.
 */
export const useAutoResizeTextArea = (
  textAreaRef: React.RefObject<HTMLTextAreaElement>,
  value: string | number | readonly string[]
) => {
  useLayoutEffect(() => {
    const textArea = textAreaRef.current;
    if (!textArea) return;

    // We need to reset the height momentarily to get the correct scrollHeight for the textarea
    textArea.style.height = "0px";
    const scrollHeight = textArea.scrollHeight;
    textArea.style.height = scrollHeight + "px";
  }, [textAreaRef, value]);
};
