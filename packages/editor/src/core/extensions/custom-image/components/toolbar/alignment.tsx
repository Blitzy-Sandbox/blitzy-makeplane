/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Image-alignment dropdown action for the custom-image toolbar.
 *
 * Rendered inside `ImageToolbarRoot` (see `./root.tsx`) and lets the user change
 * the active image alignment to `"left" | "center" | "right"`. The list of
 * available options — `{ label, value, icon }` tuples backed by `lucide-react`
 * align icons — is sourced from `IMAGE_ALIGNMENT_OPTIONS` in `../../utils`, so
 * the option metadata is not duplicated here. The selected value is mirrored
 * upward to the parent block via the `handleChange` prop, which is responsible
 * for persisting the new alignment onto the node attrs.
 *
 * Outside-click dismissal is delegated to `useOutsideClickDetector` from
 * `@plane/hooks`, attached to the `dropdownRef` container. To prevent the
 * surrounding toolbar from auto-hiding while the dropdown menu is open (e.g.
 * when the cursor leaves the hover-area of the parent image block), this
 * component mirrors `isDropdownOpen` back up to `ImageToolbarRoot` through the
 * `toggleToolbarViewStatus` callback in a `useEffect`.
 *
 * Accessibility: the trigger and every option are real `<button type="button">`
 * elements, so they participate in the standard browser tab order and respond
 * to Enter/Space as native button activations. No custom arrow-key menu
 * traversal is implemented — the standard tab order IS the implemented
 * keyboard behavior. Tooltips (`"Align"` on the trigger; `"Left" | "Center" |
 * "Right"` per option) are disabled on touch devices via the `isTouchDevice`
 * prop to avoid double-tap conflicts on mobile.
 */
import { useEffect, useRef, useState } from "react";
// plane imports
import { useOutsideClickDetector } from "@plane/hooks";
import { ChevronDownIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
// local imports
import type { TCustomImageAlignment } from "../../types";
import { IMAGE_ALIGNMENT_OPTIONS } from "../../utils";

/**
 * Props for {@link ImageAlignmentAction}.
 *
 * Fields:
 *   - `activeAlignment` ({@link TCustomImageAlignment}) — current alignment
 *     value; used to highlight the matching icon in the trigger button so the
 *     user can see the active selection without opening the dropdown.
 *   - `handleChange` (`(alignment: TCustomImageAlignment) => void`) — invoked
 *     when the user picks an option from the dropdown; the parent (typically
 *     `CustomImageBlock` via `ImageToolbarRoot`) is responsible for persisting
 *     the new value to the node attrs.
 *   - `isTouchDevice` (`boolean`) — when `true`, all tooltips (trigger +
 *     per-option) are disabled to avoid the double-tap conflict that mobile
 *     touch surfaces produce against hover-driven tooltips.
 *   - `toggleToolbarViewStatus` (`(val: boolean) => void`) — callback used to
 *     inform the parent toolbar whether the dropdown is currently open; the
 *     parent keeps the toolbar visible while this is `true` so the menu does
 *     not disappear when the cursor leaves the hover-area.
 */
type Props = {
  activeAlignment: TCustomImageAlignment;
  handleChange: (alignment: TCustomImageAlignment) => void;
  isTouchDevice: boolean;
  toggleToolbarViewStatus: (val: boolean) => void;
};

/**
 * Button-triggered dropdown listing the three image alignment options
 * (Left/Center/Right); selecting an option calls `handleChange(option.value)`
 * and closes the dropdown.
 *
 * Internal state:
 *   - `isDropdownOpen` (boolean) — toggled by clicking the trigger button;
 *     cleared by an outside click (via `useOutsideClickDetector`) or by
 *     selecting an option from the menu.
 *
 * Refs:
 *   - `dropdownRef` — points at the relatively-positioned wrapper `<div>` that
 *     contains both the trigger and the floating menu; passed to
 *     `useOutsideClickDetector` so it knows the dropdown's DOM boundary.
 *
 * Side effects:
 *   - On every change of `isDropdownOpen`, a `useEffect` calls
 *     `toggleToolbarViewStatus(isDropdownOpen)` so the parent toolbar
 *     (`ImageToolbarRoot`) stays visible while the menu is open, even when the
 *     cursor leaves the parent's hover-area.
 *   - On option click, `handleChange(option.value)` is fired so the parent can
 *     persist the new alignment to the node attrs.
 *
 * Accessibility: trigger and option buttons are native `<button type="button">`
 * elements that participate in the standard browser tab order (Tab to focus,
 * Enter/Space to activate); no custom arrow-key traversal is wired in. The
 * `"Align"` trigger tooltip and the per-option (`"Left"` / `"Center"` /
 * `"Right"`) tooltips are suppressed on touch devices via `isTouchDevice`.
 */
export function ImageAlignmentAction(props: Props) {
  const { activeAlignment, handleChange, isTouchDevice, toggleToolbarViewStatus } = props;
  // states
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // refs
  const dropdownRef = useRef<HTMLDivElement>(null);
  // derived values
  const activeAlignmentDetails = IMAGE_ALIGNMENT_OPTIONS.find((option) => option.value === activeAlignment);

  useOutsideClickDetector(dropdownRef, () => setIsDropdownOpen(false));

  useEffect(() => {
    toggleToolbarViewStatus(isDropdownOpen);
  }, [isDropdownOpen, toggleToolbarViewStatus]);

  return (
    <div ref={dropdownRef} className="relative h-full">
      <Tooltip disabled={isTouchDevice} tooltipContent="Align">
        <button
          type="button"
          className="flex h-full items-center gap-1 text-white/60 transition-colors hover:text-white"
          onClick={() => setIsDropdownOpen((prev) => !prev)}
        >
          {activeAlignmentDetails && <activeAlignmentDetails.icon className="size-3 flex-shrink-0" />}
          <ChevronDownIcon className="size-2 flex-shrink-0" />
        </button>
      </Tooltip>
      {isDropdownOpen && (
        <div className="absolute top-full left-1/2 mt-0.5 flex h-7 -translate-x-1/2 items-center gap-2 rounded-sm bg-black/80 px-2">
          {IMAGE_ALIGNMENT_OPTIONS.map((option) => (
            <Tooltip disabled={isTouchDevice} key={option.value} tooltipContent={option.label}>
              <button
                type="button"
                className="grid h-full flex-shrink-0 place-items-center text-white/60 transition-colors hover:text-white"
                onClick={() => {
                  handleChange(option.value);
                  setIsDropdownOpen(false);
                }}
              >
                <option.icon className="size-3" />
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
