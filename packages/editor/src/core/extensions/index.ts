/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for `packages/editor/src/core/extensions/`.
 *
 * Aggregates every extension module that should be importable via the
 * `@/extensions` path alias. Imports in `extensions.ts` and downstream
 * consumers go through this barrel; deep imports from individual files
 * are reserved for cases where the barrel is intentionally bypassed
 * (e.g., `extensions.ts` imports `./placeholder`, `./starter-kit`,
 * `./custom-image/extension`, `./emoji/extension`, `./unique-id/extension`
 * directly because those modules are NOT part of the barrel surface — they
 * are private to the composition factory).
 *
 * Sub-folder re-exports (each is a self-contained feature package):
 *   - `./callout` — callout block (logo + color selector)
 *   - `./code` — code block with lowlight syntax highlighting
 *   - `./code-inline` — inline code mark
 *   - `./custom-link` — link mark with bubble-menu integration
 *   - `./custom-list-keymap` — Tab/Backspace/Delete list traversal
 *   - `./image` — base image extension (schema + runtime)
 *   - `./mentions` — `@`-trigger mention node with suggestion dropdown
 *   - `./slash-commands` — `/`-trigger command menu
 *   - `./table` — table node tree with NodeView, plugins, utilities
 *   - `./typography` — typography input rules
 *   - `./work-item-embed` — embedded Plane work-item node
 *
 * Sibling file re-exports:
 *   - `./core-without-props` — extension bundles for non-interactive contexts
 *   - `./custom-color` — text + background color mark
 *   - `./enter-key` — Enter / Shift-Enter shortcut orchestration (lite-text)
 *   - `./extensions` — `CoreEditorExtensions` main composition factory
 *   - `./headings-list` — live heading inventory for outline UI
 *   - `./horizontal-rule` — custom `<div>`-based HR node
 *   - `./keymap` — Mod-a select-all + list-merging plugin
 *   - `./quote` — blockquote with Enter-to-exit
 *   - `./side-menu` — floating drag/AI handle container
 *   - `./text-align` — text alignment (heading/paragraph, left/center/right)
 *   - `./utility` — file/drop/clipboard/codemark glue + cross-extension storage
 *
 * NOT re-exported here (deep-imported by composition factories):
 *   `./placeholder`, `./starter-kit`, `./trailing-node`, `./title-extension`,
 *   `./custom-image/extension`, `./emoji/extension`, `./unique-id/extension`.
 *   `TrailingNode` from `./trailing-node` is exported from the package's
 *   top-level `packages/editor/src/index.ts` instead.
 */

export * from "./callout";
export * from "./code";
export * from "./code-inline";
export * from "./custom-link";
export * from "./custom-list-keymap";
export * from "./image";
export * from "./mentions";
export * from "./slash-commands";
export * from "./table";
export * from "./typography";
export * from "./work-item-embed";
export * from "./core-without-props";
export * from "./custom-color";
export * from "./enter-key";
export * from "./extensions";
export * from "./headings-list";
export * from "./horizontal-rule";
export * from "./keymap";
export * from "./quote";
export * from "./side-menu";
export * from "./text-align";
export * from "./utility";
