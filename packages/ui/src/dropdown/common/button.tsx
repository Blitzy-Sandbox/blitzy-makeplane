/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared trigger button for the dropdown variants in `@plane/ui/dropdown`.
 *
 * Wraps a native `<button>` inside Headless UI `Combobox.Button` (`as={Fragment}`) so the
 * native element receives the popper-js ref, click handler, and tab/focus management while
 * still benefiting from Headless UI's combobox keyboard wiring.
 */

import { Combobox } from "@headlessui/react";
import React, { Fragment } from "react";
// helper
import { cn } from "../../utils";
import type { IMultiSelectDropdownButton, ISingleSelectDropdownButton } from "../dropdown";

/**
 * Native button rendered as the trigger for both single-select and multi-select dropdowns.
 *
 * When `buttonContent` is provided, the consumer's renderer is called with `(isOpen, value)`
 * and rendered inside the button. Otherwise the button falls back to plain text rendering
 * of `value` (which is a string for single-select and a stringified array for multi-select).
 *
 * Props (see `IDropdownButton` and its variant narrowings in `../dropdown.d.ts`):
 *   - `isOpen`: parent-owned open state; passed to `buttonContent` for stateful rendering.
 *   - `value`: parent-owned selection; string for single-select, string[] for multi-select.
 *   - `buttonContent`: optional custom renderer of the button label.
 *   - `buttonClassName` / `buttonContainerClassName`: optional Tailwind overrides.
 *   - `handleOnClick`: pre-wired by the parent to toggle open state with propagation stopped.
 *   - `setReferenceElement`: popper-js setter used as the button's `ref` so the panel anchors
 *     to the trigger element.
 *   - `disabled`: switches cursor + text color to the disabled treatment.
 *
 * Accessibility: `Combobox.Button` from Headless UI applies `aria-haspopup="listbox"` and
 * `aria-expanded` (mirroring the combobox's open state). Native `<button type="button">`
 * provides keyboard focus and Space/Enter activation. INTENT UNCLEAR: `aria-disabled` is not
 * applied when `disabled=true`; the disabled state is conveyed via cursor and color only.
 */
export function DropdownButton(props: IMultiSelectDropdownButton | ISingleSelectDropdownButton) {
  const {
    isOpen,
    buttonContent,
    buttonClassName,
    buttonContainerClassName,
    handleOnClick,
    value,
    setReferenceElement,
    disabled,
  } = props;
  return (
    <Combobox.Button as={Fragment}>
      <button
        ref={setReferenceElement}
        type="button"
        className={cn(
          "clickable block h-full max-w-full outline-none",
          {
            "cursor-not-allowed text-secondary": disabled,
            "cursor-pointer": !disabled,
          },
          buttonContainerClassName
        )}
        onClick={handleOnClick}
      >
        {buttonContent ? <>{buttonContent(isOpen, value)}</> : <span className={cn("", buttonClassName)}>{value}</span>}
      </button>
    </Combobox.Button>
  );
}
