/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Central constants and type definitions for editor toolbar and command
 * metadata: editor-variant discriminator, the {@link ToolbarMenuItem} shape,
 * the per-category item rosters, the composed `TOOLBAR_ITEMS` map, and the
 * shared `COLORS_LIST` palette.
 *
 * Consumers (UI surfaces that render editor buttons, shortcuts, icons, menu
 * groupings, or color chips):
 *  - `core/extensions/callout/{block,color-selector}.tsx`
 *  - `core/extensions/custom-color.ts`
 *  - `core/extensions/slash-commands/command-items-list.tsx`
 *  - `core/extensions/table/plugins/drag-handles/color-selector.tsx`
 *  - `core/components/menus/bubble-menu/{color-selector,root}.tsx`
 *  - Downstream applications via the `@plane/editor` barrel (e.g.,
 *    `apps/space/components/editor/toolbar.tsx`).
 *
 * This module is part of the `@plane/editor` public API surface: it is
 * re-exported by `packages/editor/src/index.ts` via
 * `export * from "@/constants/common"`, so every exported symbol below is a
 * stable boundary for downstream consumers.
 */

import type { LucideIcon } from "lucide-react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CaseSensitive,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Strikethrough,
  Table,
  TextQuote,
  Underline,
} from "lucide-react";
import type { TCommandExtraProps, TEditorCommands } from "@/types/editor";

/**
 * Discriminator for which editor variant a toolbar item applies to.
 *
 * - `"lite"` — the lite text editor used for comments and descriptions.
 * - `"document"` — the full document editor used for pages.
 *
 * Consumed by {@link ToolbarMenuItem.editors} so that the same item roster
 * can be filtered into per-variant toolbars without duplicating definitions.
 */
export type TEditorTypes = "lite" | "document";

/**
 * Conditional narrowing of `extraProps` to the per-command shape declared in
 * `TCommandExtraProps` (defined in `@/types/editor`), or `object` when the
 * command declares no extras.
 *
 * Some toolbar commands need extra arguments to dispatch (e.g., `text-align`
 * requires `{ alignment }`, `image` requires a saved `Selection`), while
 * marks like `bold` or `italic` require none — this utility keeps the
 * `extraProps` field strongly typed per command without forcing every item
 * to declare an empty payload.
 */
// Utility type to enforce the necessary extra props or make extraProps optional
export type ExtraPropsForCommand<T extends TEditorCommands> = T extends keyof TCommandExtraProps
  ? TCommandExtraProps[T]
  : object; // Default to empty object for commands without extra props

/**
 * Declarative shape for a single toolbar menu item rendered by editor UI
 * components.
 *
 * Field semantics:
 *  - `itemKey`    — command identifier dispatched into the editor on click.
 *  - `renderKey`  — stable React `key` string, unique within a toolbar group;
 *                   distinct from `itemKey` because multiple items can share
 *                   the same `itemKey` with different `extraProps` (e.g., the
 *                   three `text-align` variants all use `itemKey: "text-align"`
 *                   but differ by `extraProps.alignment`).
 *  - `name`       — human-readable label shown in tooltips and menus.
 *  - `icon`       — Lucide icon component rendered alongside the label.
 *  - `shortcut`   — optional keyboard-shortcut segments (e.g., `["Cmd", "B"]`).
 *  - `editors`    — which editor variants the item applies to; the same item
 *                   roster is filtered into per-variant toolbars by this field.
 *  - `extraProps` — optional per-command extra arguments, narrowed to the
 *                   command's payload shape by {@link ExtraPropsForCommand}.
 */
export type ToolbarMenuItem<T extends TEditorCommands = TEditorCommands> = {
  itemKey: T;
  renderKey: string;
  name: string;
  icon: LucideIcon;
  shortcut?: string[];
  editors: TEditorTypes[];
  extraProps?: ExtraPropsForCommand<T>;
};

/**
 * Toolbar item rosters by command category — typography, text alignment,
 * basic marks, lists, user actions, and complex inserts.
 *
 * Each roster is filtered into {@link TOOLBAR_ITEMS} per editor variant via
 * its items' `.editors` field, and items render in declaration order.
 */

/** Heading and text-style options for the document editor only — the lite editor does not render typography. */
export const TYPOGRAPHY_ITEMS: ToolbarMenuItem<"text" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6">[] = [
  { itemKey: "text", renderKey: "text", name: "Text", icon: CaseSensitive, editors: ["document"] },
  { itemKey: "h1", renderKey: "h1", name: "Heading 1", icon: Heading1, editors: ["document"] },
  { itemKey: "h2", renderKey: "h2", name: "Heading 2", icon: Heading2, editors: ["document"] },
  { itemKey: "h3", renderKey: "h3", name: "Heading 3", icon: Heading3, editors: ["document"] },
  { itemKey: "h4", renderKey: "h4", name: "Heading 4", icon: Heading4, editors: ["document"] },
  { itemKey: "h5", renderKey: "h5", name: "Heading 5", icon: Heading5, editors: ["document"] },
  { itemKey: "h6", renderKey: "h6", name: "Heading 6", icon: Heading6, editors: ["document"] },
];

/**
 * Three text-align variants (`left` / `center` / `right`) that share `itemKey: "text-align"`
 * but differ by `extraProps.alignment`; see {@link ToolbarMenuItem.renderKey} for React-key disambiguation.
 */
export const TEXT_ALIGNMENT_ITEMS: ToolbarMenuItem<"text-align">[] = [
  {
    itemKey: "text-align",
    renderKey: "text-align-left",
    name: "Left align",
    icon: AlignLeft,
    shortcut: ["Cmd", "Shift", "L"],
    editors: ["lite", "document"],
    extraProps: {
      alignment: "left",
    },
  },
  {
    itemKey: "text-align",
    renderKey: "text-align-center",
    name: "Center align",
    icon: AlignCenter,
    shortcut: ["Cmd", "Shift", "E"],
    editors: ["lite", "document"],
    extraProps: {
      alignment: "center",
    },
  },
  {
    itemKey: "text-align",
    renderKey: "text-align-right",
    name: "Right align",
    icon: AlignRight,
    shortcut: ["Cmd", "Shift", "R"],
    editors: ["lite", "document"],
    extraProps: {
      alignment: "right",
    },
  },
];

// Private — composed into `TOOLBAR_ITEMS` below; not part of the public API surface.
const BASIC_MARK_ITEMS: ToolbarMenuItem<"bold" | "italic" | "underline" | "strikethrough">[] = [
  {
    itemKey: "bold",
    renderKey: "bold",
    name: "Bold",
    icon: Bold,
    shortcut: ["Cmd", "B"],
    editors: ["lite", "document"],
  },
  {
    itemKey: "italic",
    renderKey: "italic",
    name: "Italic",
    icon: Italic,
    shortcut: ["Cmd", "I"],
    editors: ["lite", "document"],
  },
  {
    itemKey: "underline",
    renderKey: "underline",
    name: "Underline",
    icon: Underline,
    shortcut: ["Cmd", "U"],
    editors: ["lite", "document"],
  },
  {
    itemKey: "strikethrough",
    renderKey: "strikethrough",
    name: "Strikethrough",
    icon: Strikethrough,
    shortcut: ["Cmd", "Shift", "S"],
    editors: ["lite", "document"],
  },
];

// Private — composed into `TOOLBAR_ITEMS` below; not part of the public API surface.
const LIST_ITEMS: ToolbarMenuItem<"bulleted-list" | "numbered-list" | "to-do-list">[] = [
  {
    itemKey: "bulleted-list",
    renderKey: "bulleted-list",
    name: "Bulleted list",
    icon: List,
    shortcut: ["Cmd", "Shift", "7"],
    editors: ["lite", "document"],
  },
  {
    itemKey: "numbered-list",
    renderKey: "numbered-list",
    name: "Numbered list",
    icon: ListOrdered,
    shortcut: ["Cmd", "Shift", "8"],
    editors: ["lite", "document"],
  },
  {
    itemKey: "to-do-list",
    renderKey: "to-do-list",
    name: "To-do list",
    icon: ListTodo,
    shortcut: ["Cmd", "Shift", "9"],
    editors: ["lite", "document"],
  },
];

/** Quote and inline-code toolbar items, available in both editor variants. */
export const USER_ACTION_ITEMS: ToolbarMenuItem<"quote" | "code">[] = [
  { itemKey: "quote", renderKey: "quote", name: "Quote", icon: TextQuote, editors: ["lite", "document"] },
  { itemKey: "code", renderKey: "code", name: "Code", icon: Code2, editors: ["lite", "document"] },
];

/**
 * "Complex" inserts requiring richer prompts or dialogs: `table` (document
 * editor only) and `image` (both editor variants).
 */
export const COMPLEX_ITEMS: ToolbarMenuItem<"table" | "image">[] = [
  { itemKey: "table", renderKey: "table", name: "Table", icon: Table, editors: ["document"] },
  { itemKey: "image", renderKey: "image", name: "Image", icon: Image, editors: ["lite", "document"] },
];

/**
 * Composed toolbar roster keyed by {@link TEditorTypes}.
 *
 * The inner object's keys are toolbar group names (`basic`, `alignment`,
 * `list`, `userAction`, `complex`); each value is the corresponding pre-
 * filtered item array. Consumers (`apps/web` lite/sticky/page toolbars,
 * `apps/space` lite toolbar, etc.) render groups in this object's
 * declaration order.
 */
export const TOOLBAR_ITEMS: {
  [editorType in TEditorTypes]: {
    [key: string]: ToolbarMenuItem[];
  };
} = {
  lite: {
    basic: BASIC_MARK_ITEMS.filter((item) => item.editors.includes("lite")),
    alignment: TEXT_ALIGNMENT_ITEMS.filter((item) => item.editors.includes("lite")),
    list: LIST_ITEMS.filter((item) => item.editors.includes("lite")),
    userAction: USER_ACTION_ITEMS.filter((item) => item.editors.includes("lite")),
    complex: COMPLEX_ITEMS.filter((item) => item.editors.includes("lite")),
  },
  document: {
    basic: BASIC_MARK_ITEMS.filter((item) => item.editors.includes("document")),
    alignment: TEXT_ALIGNMENT_ITEMS.filter((item) => item.editors.includes("document")),
    list: LIST_ITEMS.filter((item) => item.editors.includes("document")),
    userAction: USER_ACTION_ITEMS.filter((item) => item.editors.includes("document")),
    complex: COMPLEX_ITEMS.filter((item) => item.editors.includes("document")),
  },
};

/**
 * Shared color palette for editor text color and background highlights.
 *
 * Each entry exposes:
 *  - `key`             — programmatic identifier persisted as the value on
 *                        TipTap `textStyle` / `highlight` marks.
 *  - `label`           — UI-facing display name shown in pickers.
 *  - `textColor`       — CSS variable reference resolved by the editor theme.
 *  - `backgroundColor` — CSS variable reference resolved by the editor theme.
 *
 * Consumers:
 *  - `core/extensions/callout/{block,color-selector}.tsx`
 *  - `core/extensions/custom-color.ts` (validates persisted color keys)
 *  - `core/extensions/slash-commands/command-items-list.tsx`
 *  - `core/extensions/table/plugins/drag-handles/color-selector.tsx`
 *  - `core/components/menus/bubble-menu/{color-selector,root}.tsx`
 *
 * The palette references CSS variables rather than literal colors because
 * the theme is consumer-controlled: the editor never bakes a palette in,
 * and the `var(--editor-colors-*)` tokens are defined by the consuming
 * application's stylesheets. The trailing commented-out
 * `pink-blue-gradient` entry is intentionally retained as a reference for
 * a future re-enable.
 */
export const COLORS_LIST: {
  key: string;
  label: string;
  textColor: string;
  backgroundColor: string;
}[] = [
  {
    key: "gray",
    label: "Gray",
    textColor: "var(--editor-colors-gray-text)",
    backgroundColor: "var(--editor-colors-gray-background)",
  },
  {
    key: "peach",
    label: "Peach",
    textColor: "var(--editor-colors-peach-text)",
    backgroundColor: "var(--editor-colors-peach-background)",
  },
  {
    key: "pink",
    label: "Pink",
    textColor: "var(--editor-colors-pink-text)",
    backgroundColor: "var(--editor-colors-pink-background)",
  },
  {
    key: "orange",
    label: "Orange",
    textColor: "var(--editor-colors-orange-text)",
    backgroundColor: "var(--editor-colors-orange-background)",
  },
  {
    key: "green",
    label: "Green",
    textColor: "var(--editor-colors-green-text)",
    backgroundColor: "var(--editor-colors-green-background)",
  },
  {
    key: "light-blue",
    label: "Light blue",
    textColor: "var(--editor-colors-light-blue-text)",
    backgroundColor: "var(--editor-colors-light-blue-background)",
  },
  {
    key: "dark-blue",
    label: "Dark blue",
    textColor: "var(--editor-colors-dark-blue-text)",
    backgroundColor: "var(--editor-colors-dark-blue-background)",
  },
  {
    key: "purple",
    label: "Purple",
    textColor: "var(--editor-colors-purple-text)",
    backgroundColor: "var(--editor-colors-purple-background)",
  },
  // {
  //   key: "pink-blue-gradient",
  //   label: "Pink blue gradient",
  //   textColor: "var(--editor-colors-pink-blue-gradient-text)",
  //   backgroundColor: "var(--editor-colors-pink-blue-gradient-background)",
  // },
];
