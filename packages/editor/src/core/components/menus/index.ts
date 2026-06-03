/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public API barrel for the `@plane/editor` contextual menu surface.
 *
 * This module is the stable import boundary for every floating, contextual, and
 * command-driven menu rendered inside the editor. It is a pure re-export module
 * (`export *` only — no imports, no logic) and exists so that downstream consumers
 * can depend on a single path (`@/components/menus`) regardless of how the menus
 * directory is internally organized.
 *
 * Surface composition (what each re-export contributes):
 *  - `./ai-menu`     — `AIFeaturesMenu` React component. Manually-positioned `tippy.js`
 *                      popup anchored to the editor's block-level `#ai-handle` DOM
 *                      element; renders whatever React content the consumer supplies
 *                      via the `aiHandler.menu` callback (`TAIHandler["menu"]`).
 *  - `./bubble-menu` — `EditorBubbleMenu` (the inline formatting toolbar that appears
 *                      over a non-empty text selection) plus its node, link, color,
 *                      and alignment selector sub-components.
 *  - `./block-menu`  — `BlockMenu` React component and the `BlockMenuOption` shared
 *                      row contract. Floating block-context menu attached to TipTap
 *                      drag handles; surfaces fixed actions (delete, duplicate) and
 *                      node-specific options (e.g., table "Fit to width").
 *  - `./menu-items`  — Shared menu-item factory layer: the `EditorMenuItem<T>` typed
 *                      contract, per-command builder helpers, and the aggregated
 *                      `getEditorMenuItems(editor)` which is the source of truth for
 *                      command ordering, active highlighting, and command-execution
 *                      wiring across every UI surface that renders editor commands.
 *
 * Consumer surface (WHY this barrel exists):
 *  - The `document` and `rich-text` editor variants under
 *    `packages/editor/src/core/components/editors/` import `EditorBubbleMenu` and
 *    `BlockMenu` directly through this barrel and mount them inside their editor
 *    shells; the `lite-text` variant does not mount floating menus.
 *  - The central command dispatcher `core/helpers/editor-ref.ts` imports
 *    `getEditorMenuItems` from this barrel to resolve menu actions invoked from
 *    toolbars and the slash command.
 *  - The bubble-menu's own sub-modules (`bubble-menu/{root,node-selector,alignment-selector}.tsx`)
 *    import `EditorMenuItem` and per-command factories back through this barrel,
 *    so the barrel is intentionally the internal contract surface as well as the
 *    external one.
 *
 * TipTap framing:
 *  - `@plane/editor` is an internal TipTap wrapper treated as first-party code, not a
 *    third-party abstraction; this barrel is part of that wrapper's documented surface.
 *  - This file introduces no new TipTap behaviors of its own — it is purely structural.
 *    Each re-exported module is where TipTap behavior is exposed, overridden, or hidden;
 *    refer to those modules' file-level JSDoc for the per-component exposed/overridden/hidden
 *    contract.
 */

export * from "./ai-menu";
export * from "./bubble-menu";
export * from "./block-menu";
export * from "./menu-items";
