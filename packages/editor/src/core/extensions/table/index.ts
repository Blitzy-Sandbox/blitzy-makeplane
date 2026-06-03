/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Outer barrel for the editor's table extension surface.
 *
 * Re-exports the four schema-level table primitives that downstream
 * consumers compose into the editor's extension array (see
 * `core/extensions/extensions.ts`):
 *
 *   - `./table`        → `Table` extension + `DEFAULT_COLUMN_WIDTH` constant
 *   - `./table-cell`   → `TableCell` Node extension
 *   - `./table-header` → `TableHeader` Node extension
 *   - `./table-row`    → `TableRow` Node extension
 *
 * The four nodes together implement the ProseMirror table schema
 * (table → tableRow → tableCell|tableHeader → block content) and are
 * required as a group — composing only a subset produces an invalid
 * schema. The main `Table` extension additionally wires custom
 * ProseMirror plugins (`./plugins/drag-state`, `./plugins/drag-handles`,
 * `./plugins/insert-handlers`, `./plugins/selection-outline`) for
 * drag-to-reorder, inline insert affordances, and selected-cell outline
 * rendering — see `./table/table.ts` and `./plugins/` for those layers.
 *
 * First-party note (AAP §0.2.2):
 *   Although these node names parallel the upstream
 *   `@tiptap/extension-table`, `@tiptap/extension-table-cell`,
 *   `@tiptap/extension-table-header`, and `@tiptap/extension-table-row`
 *   packages, the extensions exported here are built from scratch using
 *   `Node.create<>()` from `@tiptap/core` and the ProseMirror table
 *   primitives from `@tiptap/pm/tables`. Treat this code as owned by
 *   `@plane/editor`, not as a thin third-party abstraction.
 */

export * from "./table";
export * from "./table-cell";
export * from "./table-header";
export * from "./table-row";
