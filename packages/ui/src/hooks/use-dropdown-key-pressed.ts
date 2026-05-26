/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * React hook that returns a stable `onKeyDown` handler for legacy `dropdown/` components
 * (multi-select and single-select), centralizing Enter/Escape/Tab dismissal semantics.
 *
 * Consumed by `packages/ui/src/dropdown/multi-select.tsx` and
 * `packages/ui/src/dropdown/single-select.tsx`.
 */

import { useCallback } from "react";

/**
 * Call signature for {@link useDropdownKeyPressed}: takes Enter and Escape callbacks plus an
 * optional flag controlling whether the produced handler suppresses native event propagation.
 */
type TUseDropdownKeyPressed = {
  (
    onEnterKeyDown: () => void,
    onEscKeyDown: () => void,
    stopPropagation?: boolean
  ): (event: React.KeyboardEvent<HTMLElement>) => void;
};

/**
 * Returns a memoized `onKeyDown` handler bound to Enter (commit), Escape (dismiss), and Tab (dismiss).
 *
 * Behavior:
 *   - Enter invokes `onEnterKeyDown`; when `stopPropagation` is `true` (default) the event has
 *     both `stopPropagation()` and `preventDefault()` called first to prevent ancestor handlers
 *     from also reacting and to block default form-submit behavior inside menus.
 *   - Escape invokes `onEscKeyDown` with the same suppression treatment.
 *   - Tab invokes `onEscKeyDown` WITHOUT suppression so the browser's native focus traversal
 *     still moves the next focusable element — Tab is therefore treated as an implicit dismiss.
 *   - All other keys are intentionally NOT handled; this hook does not implement typeahead
 *     character search.
 *
 * @param onEnterKeyDown Fired when the user presses Enter inside the dropdown surface.
 * @param onEscKeyDown Fired when the user presses Escape OR Tab; the Tab path skips propagation
 *   suppression so default focus traversal still runs.
 * @param stopPropagation When `true` (default), Enter and Escape have `stopPropagation()` and
 *   `preventDefault()` called on the synthetic event before the callback runs. Set `false` to
 *   let surrounding form / parent handlers still observe the key.
 * @returns Stable `onKeyDown` handler suitable for attaching to the dropdown trigger or list.
 */
export const useDropdownKeyPressed: TUseDropdownKeyPressed = (onEnterKeyDown, onEscKeyDown, stopPropagation = true) => {
  const stopEventPropagation = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (stopPropagation) {
        event.stopPropagation();
        event.preventDefault();
      }
    },
    [stopPropagation]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter") {
        stopEventPropagation(event);
        onEnterKeyDown();
      } else if (event.key === "Escape") {
        stopEventPropagation(event);
        onEscKeyDown();
      } else if (event.key === "Tab") onEscKeyDown();
    },
    [onEnterKeyDown, onEscKeyDown, stopEventPropagation]
  );

  return handleKeyDown;
};
