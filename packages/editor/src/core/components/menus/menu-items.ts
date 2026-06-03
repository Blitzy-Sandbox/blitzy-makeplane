/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared menu-item factory layer for the entire `@plane/editor` menu surface.
 *
 * This module defines the `EditorMenuItem<T extends TEditorCommands>` contract and a
 * collection of item-builder helpers that translate a live TipTap `Editor` instance
 * into typed action entries with labels, icons, active-state predicates, and command
 * callbacks. The builders do NOT introduce new TipTap behaviors — they are typed
 * adapters between TipTap's untyped chainable API and the menu UI's typed contract.
 *
 * TipTap framing: each builder helper EXPOSES one specific TipTap StarterKit (or
 * custom) command through its `command` callback and EXPOSES the corresponding
 * `isActive` predicate from TipTap editor state through its `isActive` callback.
 * The underlying chainable commands live in `@/helpers/editor-commands`; the
 * extension keys consulted by `isActive` live in `@/constants/extension`.
 *
 * Cross-consumers — `EditorMenuItem<T>` is the unified contract for every UI surface
 * that renders editor commands:
 *   - Block menu node options       — `./block-menu.tsx`
 *   - Bubble menu selectors         — `./bubble-menu/` (node, color, alignment)
 *   - Slash command                 — `@/extensions/slash-commands/` (consumes
 *                                     `getEditorMenuItems(editor)` directly)
 *
 * The aggregated `getEditorMenuItems(editor)` below is the SOURCE OF TRUTH for
 * command ordering, active highlighting, and command execution wiring for any
 * surface that needs the full menu list (currently the slash command).
 */

import type { Editor } from "@tiptap/react";
import {
  BoldIcon,
  Heading1,
  CheckSquare,
  Heading2,
  Heading3,
  TextQuote,
  ImageIcon,
  TableIcon,
  ListIcon,
  ListOrderedIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  CodeIcon,
  Heading4,
  Heading5,
  Heading6,
  CaseSensitive,
  MinusSquare,
  Palette,
  AlignCenter,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LinkIcon } from "@plane/propel/icons";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// helpers
import {
  insertHorizontalRule,
  insertImage,
  insertTableCommand,
  setLinkEditor,
  setText,
  setTextAlign,
  toggleBackgroundColor,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleCodeBlock,
  toggleHeading,
  toggleItalic,
  toggleOrderedList,
  toggleStrike,
  toggleTaskList,
  toggleTextColor,
  toggleUnderline,
  unsetLinkEditor,
} from "@/helpers/editor-commands";
// types
import type { TCommandWithProps, TEditorCommands } from "@/types";
import type { ISvgIcons } from "@plane/propel/icons";
type isActiveFunction<T extends TEditorCommands> = (params?: TCommandWithProps<T>) => boolean;
type commandFunction<T extends TEditorCommands> = (params?: TCommandWithProps<T>) => void;

/**
 * Shared contract for any UI surface that renders editor commands — the block menu,
 * the bubble menu selectors, the slash command, etc.
 *
 * Generic over `T extends TEditorCommands` so each menu item is statically typed
 * against its command discriminator key and the command-specific extra props that
 * key carries (see `TCommandWithProps<T>` in `@/types`, which maps each command key
 * to its required extra props or to an empty object when the command takes none).
 *
 * The five fields are intentionally minimal to keep this contract universal across
 * surfaces:
 *   - `key`      — the command discriminator from `TEditorCommands`
 *   - `name`     — the user-visible label rendered by the consuming surface
 *   - `command`  — the action callback, invoked with optional command-specific props
 *   - `icon`     — Lucide icon component or Plane SVG icon component
 *   - `isActive` — active-state predicate evaluated against current editor state
 *
 * Field types are documented inline in the TypeScript declaration below — this
 * JSDoc describes the semantic contract only.
 */
export type EditorMenuItem<T extends TEditorCommands> = {
  key: T;
  name: string;
  command: commandFunction<T>;
  icon: LucideIcon | React.FC<ISvgIcons>;
  isActive: isActiveFunction<T>;
};

/**
 * Builds the "Text" (paragraph) menu entry. Exposes `setText(editor)` from
 * `@/helpers/editor-commands`, which dispatches `editor.chain().focus().setNode(PARAGRAPH).run()`.
 * `isActive` is true when the current selection sits inside a `CORE_EXTENSIONS.PARAGRAPH` node.
 */
export const TextItem = (editor: Editor): EditorMenuItem<"text"> => ({
  key: "text",
  name: "Text",
  isActive: () => editor.isActive(CORE_EXTENSIONS.PARAGRAPH),
  command: () => setText(editor),
  icon: CaseSensitive,
});

type SupportedHeadingLevels = Extract<TEditorCommands, "h1" | "h2" | "h3" | "h4" | "h5" | "h6">;

/**
 * Internal generic factory for heading-level menu items.
 *
 * The six `HeadingOneItem` … `HeadingSixItem` exports below all delegate here so the
 * heading-level → icon + key + name mapping stays in one place. Intentionally
 * module-internal (NOT exported) — consumers should always go through the per-level
 * exports so their typed `EditorMenuItem<"hN">` return type carries the correct
 * discriminant.
 */
const HeadingItem = <T extends SupportedHeadingLevels>(
  editor: Editor,
  level: 1 | 2 | 3 | 4 | 5 | 6,
  key: T,
  name: string,
  icon: LucideIcon
): EditorMenuItem<T> => ({
  key,
  name,
  isActive: () => editor.isActive(CORE_EXTENSIONS.HEADING, { level }),
  command: () => toggleHeading(editor, level),
  icon,
});

/**
 * Builds the "Heading 1" menu entry. Exposes `toggleHeading(editor, 1)` which dispatches
 * `editor.chain().focus().toggleHeading({ level: 1 }).run()`. `isActive` is true when
 * the selection is inside a `CORE_EXTENSIONS.HEADING` node with `{ level: 1 }`.
 */
export const HeadingOneItem = (editor: Editor): EditorMenuItem<"h1"> =>
  HeadingItem(editor, 1, "h1", "Heading 1", Heading1);

/**
 * Builds the "Heading 2" menu entry. Exposes `toggleHeading(editor, 2)`; `isActive`
 * is true when the selection is inside a `CORE_EXTENSIONS.HEADING` node with `{ level: 2 }`.
 */
export const HeadingTwoItem = (editor: Editor): EditorMenuItem<"h2"> =>
  HeadingItem(editor, 2, "h2", "Heading 2", Heading2);

/**
 * Builds the "Heading 3" menu entry. Exposes `toggleHeading(editor, 3)`; `isActive`
 * is true when the selection is inside a `CORE_EXTENSIONS.HEADING` node with `{ level: 3 }`.
 */
export const HeadingThreeItem = (editor: Editor): EditorMenuItem<"h3"> =>
  HeadingItem(editor, 3, "h3", "Heading 3", Heading3);

/**
 * Builds the "Heading 4" menu entry. Exposes `toggleHeading(editor, 4)`; `isActive`
 * is true when the selection is inside a `CORE_EXTENSIONS.HEADING` node with `{ level: 4 }`.
 */
export const HeadingFourItem = (editor: Editor): EditorMenuItem<"h4"> =>
  HeadingItem(editor, 4, "h4", "Heading 4", Heading4);

/**
 * Builds the "Heading 5" menu entry. Exposes `toggleHeading(editor, 5)`; `isActive`
 * is true when the selection is inside a `CORE_EXTENSIONS.HEADING` node with `{ level: 5 }`.
 */
export const HeadingFiveItem = (editor: Editor): EditorMenuItem<"h5"> =>
  HeadingItem(editor, 5, "h5", "Heading 5", Heading5);

/**
 * Builds the "Heading 6" menu entry. Exposes `toggleHeading(editor, 6)`; `isActive`
 * is true when the selection is inside a `CORE_EXTENSIONS.HEADING` node with `{ level: 6 }`.
 */
export const HeadingSixItem = (editor: Editor): EditorMenuItem<"h6"> =>
  HeadingItem(editor, 6, "h6", "Heading 6", Heading6);

/**
 * Builds the "Bold" inline-mark toggle entry. Exposes `toggleBold(editor)`; `isActive`
 * is true when the `CORE_EXTENSIONS.BOLD` mark is active at the current selection.
 */
export const BoldItem = (editor: Editor): EditorMenuItem<"bold"> => ({
  key: "bold",
  name: "Bold",
  isActive: () => editor?.isActive(CORE_EXTENSIONS.BOLD),
  command: () => toggleBold(editor),
  icon: BoldIcon,
});

/**
 * Builds the "Italic" inline-mark toggle entry. Exposes `toggleItalic(editor)`; `isActive`
 * is true when the `CORE_EXTENSIONS.ITALIC` mark is active at the current selection.
 */
export const ItalicItem = (editor: Editor): EditorMenuItem<"italic"> => ({
  key: "italic",
  name: "Italic",
  isActive: () => editor?.isActive(CORE_EXTENSIONS.ITALIC),
  command: () => toggleItalic(editor),
  icon: ItalicIcon,
});

/**
 * Builds the "Underline" inline-mark toggle entry. Exposes `toggleUnderline(editor)`;
 * `isActive` is true when the `CORE_EXTENSIONS.UNDERLINE` mark is active at the current
 * selection. The capital-L spelling (`UnderLineItem`) is intentional and load-bearing —
 * existing consumers import this symbol by name; do NOT "fix" it to `UnderlineItem`.
 */
export const UnderLineItem = (editor: Editor): EditorMenuItem<"underline"> => ({
  key: "underline",
  name: "Underline",
  isActive: () => editor?.isActive(CORE_EXTENSIONS.UNDERLINE),
  command: () => toggleUnderline(editor),
  icon: UnderlineIcon,
});

/**
 * Builds the "Strikethrough" inline-mark toggle entry. Exposes `toggleStrike(editor)`;
 * `isActive` is true when the `CORE_EXTENSIONS.STRIKETHROUGH` mark is active at the
 * current selection. The capital-T spelling (`StrikeThroughItem`) is intentional and
 * load-bearing — existing consumers import this symbol by name.
 */
export const StrikeThroughItem = (editor: Editor): EditorMenuItem<"strikethrough"> => ({
  key: "strikethrough",
  name: "Strikethrough",
  isActive: () => editor?.isActive(CORE_EXTENSIONS.STRIKETHROUGH),
  command: () => toggleStrike(editor),
  icon: StrikethroughIcon,
});

/**
 * Builds the "Bulleted list" entry. Exposes `toggleBulletList(editor)`; `isActive` is
 * true when the selection is inside a `CORE_EXTENSIONS.BULLET_LIST` node.
 */
export const BulletListItem = (editor: Editor): EditorMenuItem<"bulleted-list"> => ({
  key: "bulleted-list",
  name: "Bulleted list",
  isActive: () => editor?.isActive(CORE_EXTENSIONS.BULLET_LIST),
  command: () => toggleBulletList(editor),
  icon: ListIcon,
});

/**
 * Builds the "Numbered list" entry. Exposes `toggleOrderedList(editor)`; `isActive` is
 * true when the selection is inside a `CORE_EXTENSIONS.ORDERED_LIST` node.
 */
export const NumberedListItem = (editor: Editor): EditorMenuItem<"numbered-list"> => ({
  key: "numbered-list",
  name: "Numbered list",
  isActive: () => editor?.isActive(CORE_EXTENSIONS.ORDERED_LIST),
  command: () => toggleOrderedList(editor),
  icon: ListOrderedIcon,
});

/**
 * Builds the "To-do list" entry. Exposes `toggleTaskList(editor)`; `isActive` is true
 * when the selection is inside a `CORE_EXTENSIONS.TASK_ITEM` (a single task line within
 * the surrounding task list), so the menu highlights per-item rather than per-list.
 */
export const TodoListItem = (editor: Editor): EditorMenuItem<"to-do-list"> => ({
  key: "to-do-list",
  name: "To-do list",
  isActive: () => editor.isActive(CORE_EXTENSIONS.TASK_ITEM),
  command: () => toggleTaskList(editor),
  icon: CheckSquare,
});

/**
 * Builds the "Quote" entry. Exposes `toggleBlockquote(editor)`; `isActive` is true when
 * the selection is inside a `CORE_EXTENSIONS.BLOCKQUOTE` node.
 */
export const QuoteItem = (editor: Editor): EditorMenuItem<"quote"> => ({
  key: "quote",
  name: "Quote",
  isActive: () => editor?.isActive(CORE_EXTENSIONS.BLOCKQUOTE),
  command: () => toggleBlockquote(editor),
  icon: TextQuote,
});

/**
 * Builds the "Code" entry. Exposes `toggleCodeBlock(editor)` (which itself toggles
 * between inline code, multi-line code block, and plain text based on selection shape).
 *
 * `isActive` highlights for EITHER `CORE_EXTENSIONS.CODE_INLINE` OR
 * `CORE_EXTENSIONS.CODE_BLOCK` — the OR is intentional: TipTap models inline `code`
 * and `codeBlock` as two separate extensions, but the user-facing concept is a single
 * "Code" toggle, so a single menu entry must light up for either.
 */
export const CodeItem = (editor: Editor): EditorMenuItem<"code"> => ({
  key: "code",
  name: "Code",
  isActive: () => editor?.isActive(CORE_EXTENSIONS.CODE_INLINE) || editor?.isActive(CORE_EXTENSIONS.CODE_BLOCK),
  command: () => toggleCodeBlock(editor),
  icon: CodeIcon,
});

/**
 * Builds the "Table" entry. Exposes `insertTableCommand(editor)` from
 * `@/helpers/editor-commands`, which inserts a 3×3 table only when the cursor is not
 * already inside a table (avoids nested-table insertion). `isActive` is true when the
 * selection is inside a `CORE_EXTENSIONS.TABLE` node.
 */
export const TableItem = (editor: Editor): EditorMenuItem<"table"> => ({
  key: "table",
  name: "Table",
  isActive: () => editor?.isActive(CORE_EXTENSIONS.TABLE),
  command: () => insertTableCommand(editor),
  icon: TableIcon,
});

/**
 * Builds the "Image" entry. Exposes `insertImage({ editor, event: "insert", pos: <selectionStart> })`,
 * which inserts an image at the current selection's start position via the Plane
 * custom-image extension's upload pipeline.
 *
 * `isActive` highlights for EITHER `CORE_EXTENSIONS.IMAGE` (legacy upstream TipTap
 * image extension) OR `CORE_EXTENSIONS.CUSTOM_IMAGE` (Plane's custom image with the
 * full upload-to-asset-pipeline behavior) — the OR is intentional so the menu lights
 * up for both extension kinds across document migrations.
 */
export const ImageItem = (editor: Editor): EditorMenuItem<"image"> => ({
  key: "image",
  name: "Image",
  isActive: () => editor?.isActive(CORE_EXTENSIONS.IMAGE) || editor?.isActive(CORE_EXTENSIONS.CUSTOM_IMAGE),
  command: () => insertImage({ editor, event: "insert", pos: editor.state.selection.from }),
  icon: ImageIcon,
});

/**
 * Builds the "Divider" entry (note: the user-visible label is "Divider", not
 * "Horizontal rule"; the command discriminator is `"divider"`). Exposes
 * `insertHorizontalRule(editor)`; `isActive` is true when the selection is inside a
 * `CORE_EXTENSIONS.HORIZONTAL_RULE` node.
 *
 * The trailing `as const` cast is SEMANTIC and load-bearing — without it, TypeScript
 * widens the `key` literal `"divider"` to `string`, which collapses the
 * `EditorMenuItem<"divider">` discriminant union and breaks consumer narrowing.
 * Preserve the cast exactly.
 */
export const HorizontalRuleItem = (editor: Editor): EditorMenuItem<"divider"> =>
  ({
    key: "divider",
    name: "Divider",
    isActive: () => editor?.isActive(CORE_EXTENSIONS.HORIZONTAL_RULE),
    command: () => insertHorizontalRule(editor),
    icon: MinusSquare,
  }) as const;

/**
 * Builds the "Link" entry. Exposes `setLinkEditor(editor, url, text)` from
 * `@/helpers/editor-commands` when `props.url` is provided, or `unsetLinkEditor(editor)`
 * when the caller wants to clear the link mark from the current selection.
 *
 * `isActive` checks `editor?.isActive("link")` against the literal string `"link"`
 * rather than `CORE_EXTENSIONS.CUSTOM_LINK` because the underlying TipTap link
 * extension registers its mark name as the literal `"link"`; the Plane custom link
 * extension at `@/extensions/custom-link/` preserves that name. Do NOT "consistency-fix"
 * this to the enum — the active check would silently stop firing.
 *
 * The trailing `as const` cast is SEMANTIC and load-bearing for the same reason as
 * `HorizontalRuleItem` — it preserves the `EditorMenuItem<"link">` discriminant.
 */
export const LinkItem = (editor: Editor): EditorMenuItem<"link"> =>
  ({
    key: "link",
    name: "Link",
    isActive: () => editor?.isActive("link"),

    command: (props) => {
      if (!props) return;
      if (props.url) setLinkEditor(editor, props.url, props.text);
      else unsetLinkEditor(editor);
    },

    icon: LinkIcon,
  }) as const;

/**
 * Builds the text-color menu entry consumed by the bubble menu color selector.
 * Exposes `toggleTextColor(props.color, editor)`.
 *
 * `isActive` is per-color: it checks `CORE_EXTENSIONS.CUSTOM_COLOR` with the specific
 * `{ color: props?.color }` the caller passes in (typically the swatch the consumer
 * is rendering), so each swatch can independently report whether its color is the
 * active one at the current selection.
 */
export const TextColorItem = (editor: Editor): EditorMenuItem<"text-color"> => ({
  key: "text-color",
  name: "Color",
  isActive: (props) => editor.isActive(CORE_EXTENSIONS.CUSTOM_COLOR, { color: props?.color }),
  command: (props) => {
    if (!props) return;
    toggleTextColor(props.color, editor);
  },
  icon: Palette,
});

/**
 * Builds the background-color menu entry consumed by the bubble menu color selector.
 * Exposes `toggleBackgroundColor(props.color, editor)`.
 *
 * `isActive` is per-color, same shape as `TextColorItem`, but checks the
 * `backgroundColor` attribute on `CORE_EXTENSIONS.CUSTOM_COLOR` rather than `color`,
 * so text-color and background-color swatches can highlight independently of each
 * other at the same selection.
 */
export const BackgroundColorItem = (editor: Editor): EditorMenuItem<"background-color"> => ({
  key: "background-color",
  name: "Background color",
  isActive: (props) => editor.isActive(CORE_EXTENSIONS.CUSTOM_COLOR, { backgroundColor: props?.color }),
  command: (props) => {
    if (!props) return;
    toggleBackgroundColor(props.color, editor);
  },
  icon: Palette,
});

/**
 * Builds the text-alignment menu entry consumed by the bubble menu alignment selector.
 * Exposes `setTextAlign(props.alignment, editor)`.
 *
 * `isActive` uses the attribute-form `editor.isActive({ textAlign: props?.alignment })`
 * with no extension-name key because `@tiptap/extension-text-align` attaches the
 * `textAlign` attribute to multiple node types (paragraph, heading, etc.) — there is
 * no single "text-align node" to check, so the alignment is queried as a generic
 * attribute across whatever node currently holds the selection.
 */
export const TextAlignItem = (editor: Editor): EditorMenuItem<"text-align"> => ({
  key: "text-align",
  name: "Text align",
  isActive: (props) => editor.isActive({ textAlign: props?.alignment }),
  command: (props) => {
    if (!props) return;
    setTextAlign(props.alignment, editor);
  },
  icon: AlignCenter,
});

/**
 * Returns the ordered list of all editor menu items for the given editor instance,
 * or `[]` when `editor` is `null` — defensive against callers that may invoke during
 * the editor's initialization window before the TipTap instance is ready.
 *
 * This function is the SOURCE OF TRUTH for command ordering, active highlighting, and
 * command execution wiring for any surface that needs the full menu list. It is
 * currently consumed by the slash command (`@/extensions/slash-commands/`); other
 * surfaces (block menu, bubble menu) consume the individual `*Item` builders above.
 *
 * @param editor - Live TipTap `Editor` instance from `@tiptap/react`, or `null` when
 *                 the editor has not yet mounted.
 * @returns Array of `EditorMenuItem<TEditorCommands>` in the curated UX order below,
 *          or an empty array when `editor` is `null`.
 *
 * Order rationale (changing the order changes slash-command UX directly — coordinate
 * any reorder with the slash-command consumer):
 *   1. Text + headings   — most common block conversions, surfaced first
 *   2. Inline marks      — bold, italic, underline, strikethrough
 *   3. Lists             — bulleted, to-do (deliberately before code), then numbered
 *   4. Blocks            — code, quote, table, image, divider
 *   5. Link              — separated from inline marks because of its dialog flow
 *   6. Colors & align    — bubble-menu-only operations last
 *
 * The final `as EditorMenuItem<TEditorCommands>[]` cast widens each item's specific
 * key discriminant ("text", "h1", …) up to the union `TEditorCommands` so the
 * heterogeneous array has a single uniform element type for downstream iteration.
 */
export const getEditorMenuItems = (editor: Editor | null): EditorMenuItem<TEditorCommands>[] => {
  if (!editor) return [];

  return [
    TextItem(editor),
    HeadingOneItem(editor),
    HeadingTwoItem(editor),
    HeadingThreeItem(editor),
    HeadingFourItem(editor),
    HeadingFiveItem(editor),
    HeadingSixItem(editor),
    BoldItem(editor),
    ItalicItem(editor),
    UnderLineItem(editor),
    StrikeThroughItem(editor),
    BulletListItem(editor),
    TodoListItem(editor),
    CodeItem(editor),
    NumberedListItem(editor),
    QuoteItem(editor),
    TableItem(editor),
    ImageItem(editor),
    HorizontalRuleItem(editor),
    LinkItem(editor),
    TextColorItem(editor),
    BackgroundColorItem(editor),
    TextAlignItem(editor),
  ] as EditorMenuItem<TEditorCommands>[];
};
