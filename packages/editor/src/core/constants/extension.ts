/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Canonical TipTap extension name registry for `@plane/editor`.
 *
 * This module is the single source of truth for "which TipTap nodes,
 * marks, and extensions are wired into the Plane editor". Per the
 * architectural contract, `@plane/editor` is an internal TipTap wrapper
 * treated as first-party code (not a third-party abstraction), so the
 * names declared here are owned identifiers — not pass-through
 * references.
 *
 * Consumers:
 *  - Every file under `packages/editor/src/core/extensions/` references
 *    its corresponding enum member when registering the underlying
 *    TipTap `Node.create()`, `Mark.create()`, or `Extension.create()`,
 *    ensuring one stable identifier per feature across schema, commands,
 *    and feature-flag gating.
 *  - `packages/editor/src/core/types/asset.ts` discriminates the asset
 *    union (`CORE_EXTENSIONS.IMAGE` vs. `CORE_EXTENSIONS.CUSTOM_IMAGE`)
 *    using these values.
 *  - `packages/editor/src/core/helpers/assets.ts` keys the asset
 *    metadata record by these enum values to drive the upload /
 *    deletion lifecycle.
 *  - `packages/editor/src/index.ts` re-exports `CORE_EXTENSIONS` as part
 *    of the public `@plane/editor` API; downstream apps (apps/web,
 *    apps/space) consume it for extension allowlists, conditional
 *    rendering, and feature-flag wiring.
 *
 * Invariant: each enum value MUST equal the runtime `name` returned by
 * the corresponding TipTap registration. Drift between this enum and
 * any `create()` call site silently breaks the editor schema — schema
 * lookups, `editor.commands.<name>(...)` calls, and `isActive(name)`
 * checks all key off these strings.
 */

/**
 * Enum mapping symbolic extension names to the exact string identifiers
 * used by TipTap's schema, command system, and feature registration.
 * Each value matches the `name` property of a corresponding node, mark,
 * or extension registered under `packages/editor/src/core/extensions/`.
 *
 * Per Directive 3, this is the canonical place where exposed /
 * overridden / intentionally-hidden TipTap behaviors for the Plane
 * editor are recorded. Members below are grouped by category for
 * readability; the runtime declaration order of the enum is unaffected
 * by these groupings.
 *
 * Block formatting / structure:
 *  - `BLOCKQUOTE` ("blockquote") — TipTap blockquote node; default
 *    block-quote behavior is preserved.
 *  - `PARAGRAPH` ("paragraph") — TipTap paragraph node; the default
 *    text container.
 *  - `HEADING` ("heading") — TipTap heading node; H1–H6 levels (the
 *    permitted level set may be constrained by per-editor
 *    configuration).
 *  - `CODE_BLOCK` ("codeBlock") — TipTap codeBlock node; fenced code
 *    with language attribute.
 *  - `HORIZONTAL_RULE` ("horizontalRule") — TipTap horizontalRule;
 *    renders as `<hr/>`.
 *  - `DOCUMENT` ("doc") — TipTap top-level doc node (schema root).
 *
 * List behavior:
 *  - `BULLET_LIST` ("bulletList") — TipTap bulletList node.
 *  - `ORDERED_LIST` ("orderedList") — TipTap orderedList node.
 *  - `LIST_ITEM` ("listItem") — TipTap listItem; shared by bullet and
 *    ordered lists.
 *  - `TASK_LIST` ("taskList") — TipTap taskList node.
 *  - `TASK_ITEM` ("taskItem") — TipTap taskItem with checkbox;
 *    user-toggleable completion state.
 *
 * Tables:
 *  - `TABLE` ("table") — TipTap table node; resizable with header
 *    support.
 *  - `TABLE_ROW` ("tableRow") — TipTap tableRow.
 *  - `TABLE_CELL` ("tableCell") — TipTap tableCell.
 *  - `TABLE_HEADER` ("tableHeader") — TipTap tableHeader (top-row
 *    cells).
 *
 * Inline marks:
 *  - `BOLD` ("bold") — TipTap bold mark.
 *  - `ITALIC` ("italic") — TipTap italic mark.
 *  - `UNDERLINE` ("underline") — TipTap underline mark.
 *  - `STRIKETHROUGH` ("strike") — TipTap strike mark.
 *  - `CODE_INLINE` ("code") — TipTap code mark (inline backtick code).
 *  - `TEXT_STYLE` ("textStyle") — TipTap textStyle mark; substrate
 *    that `CUSTOM_COLOR` layers on top of.
 *
 * Document / cursor behavior:
 *  - `HISTORY` ("history") — TipTap history extension; powers
 *    undo/redo.
 *  - `GAP_CURSOR` ("gapCursor") — TipTap gapCursor; cursor placement
 *    between adjacent block nodes.
 *  - `DROP_CURSOR` ("dropCursor") — TipTap dropCursor; visual
 *    indicator during drag-and-drop.
 *  - `HARD_BREAK` ("hardBreak") — TipTap hardBreak; shift+enter line
 *    break.
 *
 * Media and embeds:
 *  - `IMAGE` ("image") — built-in TipTap image node; legacy / fallback
 *    path for documents authored before `CUSTOM_IMAGE` existed.
 *  - `CUSTOM_IMAGE` ("imageComponent") — Plane-owned image component
 *    node; supports the upload lifecycle, asset linking, and resize
 *    handles (see `core/extensions/custom-image/`).
 *  - `WORK_ITEM_EMBED` ("issue-embed-component") — Plane-owned node
 *    for embedding work items / issues inline within a document.
 *  - `EMOJI` ("emoji") — TipTap emoji node; integrates the emoji
 *    picker and `:shortcode:` substitution.
 *
 * Utility features:
 *  - `PLACEHOLDER` ("placeholder") — TipTap placeholder extension;
 *    renders contextual placeholder text in empty nodes.
 *  - `TYPOGRAPHY` ("typography") — TipTap typography extension; smart
 *    quotes, dashes, and ellipsis substitution.
 *  - `TEXT_ALIGN` ("textAlign") — TipTap textAlign; left/center/right
 *    alignment for block nodes.
 *  - `CUSTOM_COLOR` ("customColor") — Plane-owned mark layered atop
 *    `TEXT_STYLE`; consumes `COLORS_LIST` from
 *    `core/constants/common.ts`.
 *  - `CHARACTER_COUNT` ("characterCount") — TipTap characterCount;
 *    exposes current character-count metrics on the editor instance.
 *  - `MARKDOWN_CLIPBOARD` ("markdownClipboard") — Plane-owned
 *    extension for markdown-aware clipboard paste / copy.
 *  - `UTILITY` ("utility") — Plane-owned bundle of catch-all editor
 *    storage behaviors (asset list, helper commands); see
 *    `core/extensions/utility.ts`.
 *  - `ENTER_KEY` ("enterKey") — Plane-owned enter-key handler that
 *    overrides Enter behavior in specific contexts (e.g., single-line
 *    inputs that should submit on Enter).
 *  - `UNIQUE_ID` ("uniqueID") — Plane-owned extension assigning stable
 *    UUID ids to block nodes; reads `BLOCK_NODE_TYPES` (below) to
 *    decide which nodes receive ids.
 *
 * Specialized integrations:
 *  - `SLASH_COMMANDS` ("slash-command") — Plane-owned slash-command
 *    extension; opens the command menu on `/` keystroke.
 *  - `MENTION` ("mention") — TipTap mention extension; user @-mention
 *    with suggestion popup.
 *  - `CUSTOM_LINK` ("link") — Plane-owned link mark; overrides default
 *    TipTap link behavior (e.g., new-tab semantics, URL validation).
 *  - `CALLOUT` ("calloutComponent") — Plane-owned callout node; a
 *    colored emphasis box that consumes `COLORS_LIST` from
 *    `core/constants/common.ts`.
 *  - `HEADINGS_LIST` ("headingsList") — Plane-owned extension that
 *    maintains an outline / table-of-contents view derived from
 *    heading nodes.
 *  - `SIDE_MENU` ("editorSideMenu") — Plane-owned editor-side-menu
 *    extension; renders the drag / options handle next to block nodes.
 */
export enum CORE_EXTENSIONS {
  BLOCKQUOTE = "blockquote",
  BOLD = "bold",
  BULLET_LIST = "bulletList",
  CALLOUT = "calloutComponent",
  CHARACTER_COUNT = "characterCount",
  CODE_BLOCK = "codeBlock",
  CODE_INLINE = "code",
  CUSTOM_COLOR = "customColor",
  CUSTOM_IMAGE = "imageComponent",
  CUSTOM_LINK = "link",
  DOCUMENT = "doc",
  DROP_CURSOR = "dropCursor",
  ENTER_KEY = "enterKey",
  GAP_CURSOR = "gapCursor",
  HARD_BREAK = "hardBreak",
  HEADING = "heading",
  HEADINGS_LIST = "headingsList",
  HISTORY = "history",
  HORIZONTAL_RULE = "horizontalRule",
  IMAGE = "image",
  ITALIC = "italic",
  LIST_ITEM = "listItem",
  MARKDOWN_CLIPBOARD = "markdownClipboard",
  MENTION = "mention",
  ORDERED_LIST = "orderedList",
  PARAGRAPH = "paragraph",
  PLACEHOLDER = "placeholder",
  SIDE_MENU = "editorSideMenu",
  SLASH_COMMANDS = "slash-command",
  STRIKETHROUGH = "strike",
  TABLE = "table",
  TABLE_CELL = "tableCell",
  TABLE_HEADER = "tableHeader",
  TABLE_ROW = "tableRow",
  TASK_ITEM = "taskItem",
  TASK_LIST = "taskList",
  TEXT_ALIGN = "textAlign",
  TEXT_STYLE = "textStyle",
  TYPOGRAPHY = "typography",
  UNDERLINE = "underline",
  UTILITY = "utility",
  WORK_ITEM_EMBED = "issue-embed-component",
  EMOJI = "emoji",
  UNIQUE_ID = "uniqueID",
}

/**
 * Ordered subset of `CORE_EXTENSIONS` whose members are block-level nodes
 * eligible for editor-wide block operations.
 *
 * Why this subset exists: editor features that need to enumerate "what
 * counts as a block-level node" (stable-id assignment, drag-handle target
 * matching, block-scoped slash-command insertions, side-menu anchoring)
 * need a single canonical list rather than duplicating the predicate at
 * each call site. Mark types, inline nodes, and behavior-only extensions
 * (history, placeholder, typography, etc.) are intentionally excluded.
 *
 * Consumer:
 *  - `core/extensions/unique-id/extension.ts` concatenates this list
 *    with `ADDITIONAL_BLOCK_NODE_TYPES` from
 *    `@/plane-editor/constants/extensions` into
 *    `COMBINED_BLOCK_NODE_TYPES`, then passes the result as the `types`
 *    option to the unique-id plugin so each block of these types is
 *    assigned a stable UUID during ProseMirror schema initialization.
 *
 * Order is intentional, not incidental: entries are grouped by category
 * (Basic block nodes → List nodes → Table nodes → Media and embed
 * nodes) and the resulting ordering is load-bearing for any consumer
 * that iterates in declared order.
 */
export const BLOCK_NODE_TYPES = [
  // Basic block nodes
  CORE_EXTENSIONS.PARAGRAPH,
  CORE_EXTENSIONS.HEADING,
  CORE_EXTENSIONS.BLOCKQUOTE,
  CORE_EXTENSIONS.CODE_BLOCK,
  CORE_EXTENSIONS.HORIZONTAL_RULE,

  // List nodes
  CORE_EXTENSIONS.BULLET_LIST,
  CORE_EXTENSIONS.ORDERED_LIST,
  CORE_EXTENSIONS.LIST_ITEM,
  CORE_EXTENSIONS.TASK_LIST,
  CORE_EXTENSIONS.TASK_ITEM,

  // Table nodes
  CORE_EXTENSIONS.TABLE,

  // Media and embed nodes
  CORE_EXTENSIONS.IMAGE,
  CORE_EXTENSIONS.CUSTOM_IMAGE,
  CORE_EXTENSIONS.CALLOUT,
  CORE_EXTENSIONS.WORK_ITEM_EMBED,
];
