/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Callout block logo picker — the small button anchored to the leading edge of
 * a callout that opens a popup letting the user pick either an Apple-style
 * emoji or a Lucide icon as the callout's leading glyph.
 *
 * First-party UI: wraps `@plane/propel`'s shared `EmojiPicker` (also used for
 * project icons, page icons, sticky icons, etc.) and adapts its output to the
 * callout's `data-*` attribute schema declared in `./types.ts`.
 *
 * WHY the emoji-OR-icon discriminant exists: Plane lets users mix Apple emoji
 * (image-backed for cross-platform rendering fidelity) with Lucide icons
 * (vector, theme-color-aware). The `data-logo-in-use` attribute records which
 * mode is active so downstream renderers (markdown serializer, PDF export,
 * NodeView) pick the correct primitive — `TCalloutBlockEmojiAttributes` carries
 * the code-point + image-URL pair, `TCalloutBlockIconAttributes` carries the
 * Lucide name + color.
 *
 * Side effects on selection: writes back through `updateAttributes` to the
 * in-document node, AND persists the chosen logo to `localStorage` via
 * `updateStoredLogo` (from `./utils.ts`) so the next inserted callout pre-seeds
 * with the user's most-recently-used logo.
 */

// plane imports
import { EmojiPicker, EmojiIconPickerTypes, Logo } from "@plane/propel/emoji-icon-picker";
import type { TLogoProps } from "@plane/types";
import { cn } from "@plane/utils";
// types
import type { TCalloutBlockAttributes } from "./types";
// utils
import { DEFAULT_CALLOUT_BLOCK_ATTRIBUTES, updateStoredLogo } from "./utils";

type Props = {
  blockAttributes: TCalloutBlockAttributes;
  disabled: boolean;
  handleOpen: (val: boolean) => void;
  isOpen: boolean;
  updateAttributes: (attrs: Partial<TCalloutBlockAttributes>) => void;
};

/**
 * Renders the callout's logo button plus its emoji/icon picker popup; on
 * selection, persists the chosen logo to both the document attributes and
 * `localStorage`.
 *
 * Props:
 * - `blockAttributes` (`TCalloutBlockAttributes`, required): the callout node's
 *   current attributes. Used to derive the preview label (`logoValue`) and to
 *   choose the picker's initial tab (`defaultOpen`).
 * - `disabled` (`boolean`, required): forwarded to `EmojiPicker.disabled` and
 *   used to suppress the trigger's hover-style class; typically supplied as
 *   `!editor.isEditable` by the NodeView.
 * - `handleOpen` (`(val: boolean) => void`, required): controlled toggle for
 *   the picker popup. Invoked by `EmojiPicker.handleToggle` and explicitly with
 *   `false` after a successful selection to dismiss the popup.
 * - `isOpen` (`boolean`, required): controlled open state of the picker popup.
 * - `updateAttributes` (`(attrs: Partial<TCalloutBlockAttributes>) => void`,
 *   required): TipTap-provided setter; receives a partial attribute update on
 *   each selection.
 *
 * Derived state: `logoValue` (`TLogoProps`) is assembled on render from the
 * four logo-related `data-*` attributes. WHY derive on render: `EmojiPicker`
 * expects a `TLogoProps` for its preview label — this component is the adapter
 * between the `data-*` attribute storage shape (declared in `./types.ts`) and
 * the shared `TLogoProps` shape (declared in `@plane/types`).
 *
 * Side effects on selection (`onChange` callback):
 * - Emoji branch: writes `data-emoji-unicode` (the decimal code-point string
 *   yielded by `EmojiPicker`, e.g. `"128512"` for 😀) and clears
 *   `data-emoji-url` (the URL is re-resolved on render where needed). Persists
 *   to localStorage with `in_use: "emoji"`, `emoji: { value, url: undefined }`.
 * - Icon branch: writes `data-icon-name` and `data-icon-color` from the Lucide
 *   selection (cast in source because `EmojiPicker`'s union yields a struct
 *   only when `val.type === "icon"`). Persists to localStorage with
 *   `in_use: "icon"`, `icon: { name, color }`.
 * - Both branches: sets `data-logo-in-use` to `val.type`, then closes the
 *   picker via `handleOpen(false)`.
 *
 * MobX stores consumed: none.
 *
 * Accessibility / keyboard behavior: delegated to the shared
 * `@plane/propel/emoji-icon-picker` `EmojiPicker` — Plane's design system owns
 * focus management, keyboard navigation, and ARIA attributes for the popup; do
 * not duplicate that here.
 *
 * Initial tab: `defaultOpen` resolves to `EmojiIconPickerTypes.EMOJI` when the
 * current logo is an emoji, otherwise `EmojiIconPickerTypes.ICON`. WHY: opening
 * the picker to the user's current mode reduces friction when they intend to
 * swap within the same family.
 */
export function CalloutBlockLogoSelector(props: Props) {
  const { blockAttributes, disabled, handleOpen, isOpen, updateAttributes } = props;

  const logoValue: TLogoProps = {
    in_use: blockAttributes["data-logo-in-use"],
    icon: {
      color: blockAttributes["data-icon-color"],
      name: blockAttributes["data-icon-name"],
    },
    emoji: {
      value: blockAttributes["data-emoji-unicode"]?.toString(),
      url: blockAttributes["data-emoji-url"],
    },
  };

  return (
    <div contentEditable={false}>
      <EmojiPicker
        closeOnSelect={true}
        isOpen={isOpen}
        handleToggle={handleOpen}
        className="grid flex-shrink-0 place-items-center"
        buttonClassName={cn("grid size-8 flex-shrink-0 place-items-center rounded-lg text-primary", {
          "hover:bg-layer-1-hover": !disabled,
        })}
        label={<Logo logo={logoValue} size={18} type="lucide" />}
        onChange={(val) => {
          // construct the new logo value based on the type of value
          let newLogoValue: Partial<TCalloutBlockAttributes> = {};
          let newLogoValueToStoreInLocalStorage: TLogoProps = {
            in_use: "emoji",
            emoji: {
              value: DEFAULT_CALLOUT_BLOCK_ATTRIBUTES["data-emoji-unicode"],
              url: DEFAULT_CALLOUT_BLOCK_ATTRIBUTES["data-emoji-url"],
            },
          };
          if (val.type === "emoji") {
            // val.value is now a string in decimal format (e.g. "128512")
            const emojiValue = val.value;
            newLogoValue = {
              "data-emoji-unicode": emojiValue,
              "data-emoji-url": undefined,
            };
            newLogoValueToStoreInLocalStorage = {
              in_use: "emoji",
              emoji: {
                value: emojiValue,
                url: undefined,
              },
            };
          } else if (val.type === "icon") {
            const iconValue = val.value as { name: string; color: string };
            newLogoValue = {
              "data-icon-name": iconValue.name,
              "data-icon-color": iconValue.color,
            };
            newLogoValueToStoreInLocalStorage = {
              in_use: "icon",
              icon: {
                name: iconValue.name,
                color: iconValue.color,
              },
            };
          }
          // update node attributes
          updateAttributes({
            "data-logo-in-use": val.type,
            ...newLogoValue,
          });
          // update stored logo in local storage
          updateStoredLogo(newLogoValueToStoreInLocalStorage);
          handleOpen(false);
        }}
        defaultIconColor={logoValue?.in_use && logoValue.in_use === "icon" ? logoValue?.icon?.color : undefined}
        defaultOpen={logoValue.in_use === "emoji" ? EmojiIconPickerTypes.EMOJI : EmojiIconPickerTypes.ICON}
        disabled={disabled}
        searchDisabled
      />
    </div>
  );
}
