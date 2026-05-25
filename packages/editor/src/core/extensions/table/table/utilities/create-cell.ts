/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Schema-aware ProseMirror cell constructor.
 *
 * PURE — no editor state mutation, no transaction dispatch. Returns either
 * the newly constructed cell node or `null`/`undefined` if construction
 * fails (e.g., the cell type's required content cannot be filled).
 *
 * Used by `./create-table.ts` to assemble fresh tables and is also
 * directly invokable by any caller that needs to construct a table cell
 * outside of the canonical `insertTable` command flow.
 */

import type { Fragment, Node as ProsemirrorNode, NodeType } from "@tiptap/pm/model";

/**
 * Construct a ProseMirror table cell of the given type.
 *
 * Input:
 *   - `cellType` (`NodeType`): the `tableCell` or `tableHeader` NodeType
 *     resolved from the active schema via `getTableNodeTypes` (see
 *     `./get-table-node-types.ts`).
 *   - `cellContent` (optional `Fragment | Node | Node[]`): if provided,
 *     the cell is created with this content via `createChecked` — useful
 *     when copying or duplicating cells. If omitted, the cell is created
 *     empty via `createAndFill` (which fills required content slots like
 *     a default paragraph automatically).
 *   - `attrs` (optional `Record<string, unknown>`): attribute overrides
 *     applied at creation — e.g., `{ colwidth: [DEFAULT_COLUMN_WIDTH] }`
 *     to seed a column-width.
 *
 * Output:
 *   - The constructed `ProsemirrorNode`, OR
 *   - `null` (when `createAndFill` cannot satisfy the cell's content
 *     expression), OR
 *   - `undefined` (when `createChecked` rejects the provided content as
 *     incompatible with the cell schema).
 *
 * WHY a local helper (vs the upstream `createCell` from
 * `@tiptap/pm/tables`):
 *   This helper has the SAME branching logic as upstream, but it's
 *   inlined here so the call sites in this directory don't need to
 *   import from `@tiptap/pm/tables` — keeping the table feature's
 *   internal API surface tight and self-contained.
 */
export function createCell(
  cellType: NodeType,
  cellContent?: Fragment | ProsemirrorNode | Array<ProsemirrorNode>,
  attrs?: Record<string, unknown>
): ProsemirrorNode | null | undefined {
  if (cellContent) {
    return cellType.createChecked(attrs, cellContent);
  }

  return cellType.createAndFill(attrs);
}
