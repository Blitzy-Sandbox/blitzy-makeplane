/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public API barrel for the bubble-menu feature surface inside the `@plane/editor`
 * TipTap wrapper.
 *
 * This module consolidates the inline contextual formatting toolbar's exports into
 * one stable import boundary so consumers outside this directory remain insulated
 * from internal reorganizations of the bubble-menu directory.
 *
 * Surface composition (what each re-export contributes):
 *  - `./color-selector` — `BubbleMenuColorSelector`: text + background color picker
 *                         driven by the curated `COLORS_LIST` palette from
 *                         `@/constants/common`.
 *  - `./node-selector`  — `BubbleMenuNodeSelector`: block-type dropdown for Text /
 *                         H1–H6 / bullet list / numbered list / todo list / quote /
 *                         code block.
 *  - `./root`           — `EditorBubbleMenu` (the orchestrator component that renders
 *                         the floating toolbar over a non-empty editor selection) and
 *                         the exported `EditorStateType` type, the discriminated
 *                         derivation result produced by `useEditorState` and consumed
 *                         by the alignment and color selectors.
 *
 * Intentionally NOT re-exported from this barrel:
 *  - `./alignment-selector` and `./link-selector` are private composition details of
 *    `EditorBubbleMenu`. Their only consumer is `./root.tsx`, and both depend on the
 *    `EditorStateType` derivation owned by `./root.tsx`; surfacing them through the
 *    barrel would falsely imply standalone reusability.
 *
 * Consumer surface (WHY this barrel exists):
 *  - Re-exported transitively through the parent menus barrel (`../index.ts`) so
 *    downstream code imports through `@/components/menus`.
 *  - Mounted by the `document` and `rich-text` editor variants under
 *    `packages/editor/src/core/components/editors/`. The `lite-text` variant does
 *    NOT mount the bubble menu — single-line input contexts (e.g., comment
 *    composers) suppress this toolbar by design to avoid visual disruption.
 *
 * TipTap framing:
 *  - `@plane/editor` is an internal TipTap wrapper treated as first-party code, not
 *    a third-party abstraction; this barrel is part of that wrapper's documented
 *    surface.
 *  - This file introduces no TipTap behavior of its own — it is purely structural.
 *    The exposed/overridden/hidden TipTap extension behaviors live in the
 *    re-exported components (`./root` and the two selectors); refer to those files'
 *    JSDoc for the per-component contract.
 *
 * Architecturally relevant siblings consumed by the re-exported selectors:
 *  - `../menu-items` — command-builder factories (the `EditorMenuItem<T>` contract).
 *  - `../floating-menu/` — shared floating-overlay infrastructure (`useFloatingMenu`,
 *    `FloatingMenuRoot`) that anchors each selector's dropdown to its trigger button.
 */

export * from "./color-selector";
export * from "./node-selector";
export * from "./root";
