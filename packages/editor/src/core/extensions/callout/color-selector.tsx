/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Callout background-color picker — the small "Color ▾" dropdown anchored to the
 * top-right of a callout. Hidden by default and revealed on hover of the parent
 * `group/callout-node` (the `NodeViewWrapper` rendered by `block.tsx`), or pinned
 * visible while the dropdown is open.
 *
 * First-party UI: not a wrapper of any upstream picker. The dropdown primitive is
 * in-file JSX; only the icons (`lucide-react` `Ban`, `@plane/propel/icons`
 * `ChevronDownIcon`) and the `cn` class-composition helper (`@plane/utils`) come
 * from external packages, and the palette comes from the in-repo `COLORS_LIST`
 * (`@/constants/common`).
 *
 * WHY a trailing clear/reset entry: a callout with no `data-background` falls
 * back to the editor's default `bg-layer-3` shell, so users need an explicit way
 * to return to that state after experimenting with colors. The `Ban` button
 * dispatches `null` to `onSelect`, and the consumer (`block.tsx`) is what
 * interprets `null` as "remove background override" — pairing with the `null`
 * clearing branch in `updateStoredBackgroundColor` (see `./utils.ts`).
 *
 * Side effects: none of its own. The component is fully controlled — it neither
 * writes attributes nor persists state. `block.tsx` owns the `updateAttributes`
 * call (which sets `data-background`) and the `updateStoredBackgroundColor`
 * localStorage write.
 */

import { Ban } from "lucide-react";
import { ChevronDownIcon } from "@plane/propel/icons";
// plane utils
import { cn } from "@plane/utils";
// constants
import { COLORS_LIST } from "@/constants/common";

type Props = {
  disabled: boolean;
  isOpen: boolean;
  onSelect: (color: string | null) => void;
  toggleDropdown: () => void;
};

/**
 * Dropdown UI for selecting (or clearing) the callout's background color. Renders
 * the "Color ▾" trigger plus, when open, a row of swatches drawn from
 * `COLORS_LIST` followed by a `Ban`-icon reset button.
 *
 * Props:
 * - `disabled` (`boolean`, required): forwarded to the trigger `<button>`; also
 *   suppresses the hover-reveal class so the dropdown does not flash open in
 *   read-only mode (`!editor.isEditable` from `block.tsx`).
 * - `isOpen` (`boolean`, required): controlled open state. When `true`, the
 *   wrapper is pinned visible even after the cursor leaves the callout — the
 *   default hover-reveal behavior would otherwise hide the menu mid-selection.
 * - `onSelect` (`(color: string | null) => void`, required): called with the
 *   selected swatch `key`, or `null` to clear. The consumer (`block.tsx`) is
 *   responsible for the `updateAttributes` write and the
 *   `updateStoredBackgroundColor` localStorage persistence; this component does
 *   not touch either.
 * - `toggleDropdown` (`() => void`, required): controlled toggle. Invoked once
 *   from the trigger button and once again inside `handleColorSelect` so the
 *   dropdown closes after every selection (including clear).
 *
 * Swatch source: `COLORS_LIST` from `@/constants/common`. Each entry exposes a
 * `key` (the persisted token written to `data-background` by `block.tsx`) and a
 * `backgroundColor` (the resolved CSS value rendered both as the swatch preview
 * here and as the active callout background in `block.tsx`).
 *
 * Reset behavior: the trailing `<Ban />` button dispatches `onSelect(null)`.
 * `null` means "clear" — this dropdown does not enforce a default color, only
 * the consumer's interpretation of `null` does.
 *
 * MobX stores consumed: none.
 *
 * Keyboard / focus: standard `<button type="button">` elements receive focus
 * naturally; no custom ARIA roles or key handlers are wired here. The trigger
 * calls `e.stopPropagation()` so the click does not bubble to ProseMirror,
 * which would otherwise move the cursor or deselect the callout node.
 */
export function CalloutBlockColorSelector(props: Props) {
  const { disabled, isOpen, onSelect, toggleDropdown } = props;

  const handleColorSelect = (val: string | null) => {
    onSelect(val);
    toggleDropdown();
  };

  return (
    <div
      className={cn("pointer-events-none absolute top-2 right-2 z-10 opacity-0 transition-opacity", {
        "group-hover/callout-node:pointer-events-auto group-hover/callout-node:opacity-100": !disabled,
        "pointer-events-auto opacity-100": isOpen,
      })}
      contentEditable={false}
    >
      <div className="relative">
        <button
          type="button"
          onClick={(e) => {
            toggleDropdown();
            e.stopPropagation();
          }}
          className={cn(
            "flex h-full items-center gap-1 rounded-sm px-2.5 py-1 text-13 font-medium whitespace-nowrap text-tertiary transition-colors hover:bg-layer-1-hover active:bg-layer-1-active",
            {
              "bg-layer-1": isOpen,
            }
          )}
          disabled={disabled}
        >
          <span className="text-12">Color</span>
          <ChevronDownIcon className="size-3 flex-shrink-0" />
        </button>
        {isOpen && (
          <section className="animate-in fade-in slide-in-from-top-1 absolute top-full right-0 z-10 mt-1 rounded-md border-[0.5px] border-strong bg-surface-1 p-2 shadow-raised-200">
            <div className="flex items-center gap-2">
              {COLORS_LIST.map((color) => (
                <button
                  key={color.key}
                  type="button"
                  className="size-6 flex-shrink-0 rounded-sm border-[0.5px] border-strong-1 transition-opacity hover:opacity-60"
                  style={{
                    backgroundColor: color.backgroundColor,
                  }}
                  onClick={() => handleColorSelect(color.key)}
                />
              ))}
              <button
                type="button"
                className="grid size-6 flex-shrink-0 place-items-center rounded-sm border-[0.5px] border-strong-1 text-tertiary transition-colors hover:bg-layer-1-hover"
                onClick={() => handleColorSelect(null)}
              >
                <Ban className="size-4" />
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
