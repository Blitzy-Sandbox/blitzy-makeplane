/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * React hook providing an Enter/Escape `onKeyDown` handler for dropdown components.
 *
 * Consumed by `dropdowns/custom-select.tsx`, `dropdowns/custom-menu.tsx`, and
 * `dropdowns/custom-search-select.tsx` so they share identical open/close keyboard semantics.
 */

import { useCallback } from "react";

/**
 * Call signature for {@link useDropdownKeyDown}: produces a memoized keyboard handler from
 * the dropdown's open/close callbacks, current open state, and optional active-item selector.
 */
type TUseDropdownKeyDown = {
  (
    onOpen: () => void,
    onClose: () => void,
    isOpen: boolean,
    selectActiveItem?: () => void
  ): (event: React.KeyboardEvent<HTMLElement>) => void;
};

/**
 * Returns a memoized `onKeyDown` handler that opens/closes a dropdown via Enter/Escape.
 *
 * Behavior:
 *   - Enter (and not during IME composition) opens the dropdown when closed; when already
 *     open, it invokes `selectActiveItem` if one was supplied. `stopPropagation` is called
 *     on the open path so the parent doesn't also react to the key.
 *   - Escape closes the dropdown only when it is currently open, also stopping propagation.
 *   - All other keys (including ArrowUp/ArrowDown/Home/End) are intentionally NOT handled
 *     here — caller components own option-cursor movement.
 *
 * The handler is memoized on `[isOpen, onOpen, onClose]`; `selectActiveItem` is intentionally
 * excluded from the dependency array to preserve referential stability across renders that
 * pass new inline callbacks for option selection.
 *
 * @param onOpen Invoked on Enter when the dropdown is currently closed.
 * @param onClose Invoked on Escape when the dropdown is currently open.
 * @param isOpen Current open state — controls which branch of the Enter/Escape logic fires.
 * @param selectActiveItem Optional callback invoked on Enter when the dropdown is already open.
 * @returns Stable `onKeyDown` handler suitable for attaching to the dropdown's root element.
 */
export const useDropdownKeyDown: TUseDropdownKeyDown = (onOpen, onClose, isOpen, selectActiveItem?) => {
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        if (!isOpen) {
          event.stopPropagation();
          onOpen();
        } else {
          selectActiveItem && selectActiveItem();
        }
      } else if (event.key === "Escape" && isOpen) {
        event.stopPropagation();
        onClose();
      }
    },
    [isOpen, onOpen, onClose]
  );

  return handleKeyDown;
};
