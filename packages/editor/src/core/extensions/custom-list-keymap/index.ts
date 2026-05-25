/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the `custom-list-keymap/` feature package.
 *
 * Re-exports every public symbol from `./list-keymap`:
 *   - `ListKeymapOptions` — configuration type pairing list item node
 *     names with their wrapper (container) node names.
 *   - `ListKeymap` — the TipTap extension factory wiring Tab / Shift-Tab /
 *     Backspace / Delete / Mod-Backspace / Mod-Delete keyboard behavior
 *     for nested bullet, ordered, and task lists.
 *
 * Imports of this feature should go through `@/extensions/custom-list-keymap`
 * (this barrel) or through the parent `@/extensions` barrel. Deep imports
 * of `./list-helpers` are reserved for internal use by `./list-keymap`
 * itself — the helpers (`handleBackspace`, `handleDelete`, `nextListIsHigher`,
 * `isCursorInSubList`) are intentionally NOT re-exported here so the public
 * surface is limited to the extension factory and its options type.
 */
export * from "./list-keymap";
