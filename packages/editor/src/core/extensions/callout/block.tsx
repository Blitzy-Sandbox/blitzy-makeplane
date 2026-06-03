/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * React `NodeView` for the editor's callout block.
 *
 * Rendered by `CustomCalloutExtension` (in `./extension.tsx`) via TipTap's
 * `ReactNodeViewRenderer`. This module paints the callout's visual shell —
 * rounded `bg-layer-3` background, optional active color override, the
 * logo and color selectors that auto-reveal on hover, and an editable
 * inner block (`NodeViewContent`).
 *
 * First-party presentation component, not a wrapper of an upstream
 * extension's view. Presentation only — no MobX store reads.
 *
 * Side effects: writes the chosen background color to `localStorage` via
 * `updateStoredBackgroundColor` (in `./utils`) so the next callout
 * inserted in the same browser tab pre-seeds the same swatch. Logo
 * persistence is delegated to `CalloutBlockLogoSelector`, which calls
 * `updateStoredLogo` internally.
 */

import type { NodeViewProps } from "@tiptap/react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { useState } from "react";
// constants
import { COLORS_LIST } from "@/constants/common";
// local components
import { CalloutBlockColorSelector } from "./color-selector";
import { CalloutBlockLogoSelector } from "./logo-selector";
// types
import type { TCalloutBlockAttributes } from "./types";
import { ECalloutAttributeNames } from "./types";
// utils
import { updateStoredBackgroundColor } from "./utils";

/**
 * Prop shape for `CustomCalloutBlock`'s React NodeView, narrowing
 * TipTap's generic `NodeViewProps` so `node.attrs` is typed as
 * `TCalloutBlockAttributes` and `updateAttributes` accepts a
 * `Partial<TCalloutBlockAttributes>`.
 *
 * TipTap otherwise types `node.attrs` as `Record<string, any>`, which
 * silently accepts attribute-key typos (e.g. `data-backgound`) and
 * forfeits IntelliSense on the `ECalloutAttributeNames` keys read here
 * and in the selector children.
 */
export type CustomCalloutNodeViewProps = NodeViewProps & {
  node: NodeViewProps["node"] & {
    attrs: TCalloutBlockAttributes;
  };
  updateAttributes: (attrs: Partial<TCalloutBlockAttributes>) => void;
};

/**
 * Renders a single callout block in the editor.
 *
 * Mounts the visual shell, the logo picker (`CalloutBlockLogoSelector`),
 * the color picker (`CalloutBlockColorSelector`), and the editable inner
 * content area (`NodeViewContent`). Both pickers auto-reveal on cursor
 * hover and stay visible while their dropdowns are open so the user can
 * finish selecting even after the cursor leaves the callout.
 *
 * Props (`CustomCalloutNodeViewProps`):
 *   - `editor` — TipTap `Editor` instance; `editor.isEditable` gates both
 *     selectors via `disabled` so picker interactivity is suppressed in
 *     read-only viewers.
 *   - `node` — ProseMirror node narrowed to carry
 *     `TCalloutBlockAttributes` on `node.attrs`; persisted callout state
 *     lives here.
 *   - `updateAttributes` — TipTap-provided setter accepting a partial
 *     attributes object; writes attribute changes back into the document.
 *
 * Local state:
 *   - `isEmojiPickerOpen` — controls visibility of the logo picker
 *     dropdown so it can remain open when the cursor leaves the callout.
 *   - `isColorPickerOpen` — same role for the color picker dropdown.
 *
 * Derived state:
 *   - `activeBackgroundColor` — resolved CSS color string for the swatch
 *     whose `key` matches the persisted `data-background` attribute,
 *     looked up in `COLORS_LIST` from `@/constants/common`. When the
 *     attribute is unset or unknown the lookup yields `undefined`, the
 *     inline `style.backgroundColor` becomes a no-op, and the shell's
 *     default `bg-layer-3` background governs.
 *
 * MobX stores consumed: none — this component holds no domain state and
 * reads no stores; all callout state is carried by ProseMirror attributes.
 *
 * Side effects:
 *   - On color selection: `updateAttributes` mutates the document, and
 *     `updateStoredBackgroundColor(val)` writes the choice to
 *     `localStorage` so the next inserted callout pre-seeds the same
 *     swatch.
 *   - On logo selection: the full transition (attribute write +
 *     `localStorage` write via `updateStoredLogo`) is delegated to
 *     `CalloutBlockLogoSelector`; this component only owns the
 *     open/close flag through `handleOpen`.
 */
export function CustomCalloutBlock(props: CustomCalloutNodeViewProps) {
  const { editor, node, updateAttributes } = props;
  // states
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  // derived values
  const activeBackgroundColor = COLORS_LIST.find((c) => node.attrs["data-background"] === c.key)?.backgroundColor;

  return (
    <NodeViewWrapper
      key={node.attrs[ECalloutAttributeNames.ID]}
      className="editor-callout-component group/callout-node relative my-2 flex items-start gap-4 rounded-lg bg-layer-3 p-4 break-words text-primary transition-colors duration-500"
      style={{
        backgroundColor: activeBackgroundColor,
      }}
    >
      <CalloutBlockLogoSelector
        key={node.attrs[ECalloutAttributeNames.ID]}
        blockAttributes={node.attrs}
        disabled={!editor.isEditable}
        isOpen={isEmojiPickerOpen}
        handleOpen={(val) => setIsEmojiPickerOpen(val)}
        updateAttributes={updateAttributes}
      />
      <CalloutBlockColorSelector
        disabled={!editor.isEditable}
        isOpen={isColorPickerOpen}
        toggleDropdown={() => setIsColorPickerOpen((prev) => !prev)}
        onSelect={(val) => {
          updateAttributes({
            [ECalloutAttributeNames.BACKGROUND]: val,
          });
          updateStoredBackgroundColor(val);
        }}
      />
      <NodeViewContent as="div" className="w-full break-words" />
    </NodeViewWrapper>
  );
}
