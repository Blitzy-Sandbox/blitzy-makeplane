/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Schema-driven `tableRole` lookup for ProseMirror table helpers.
 *
 * PURE — no editor state mutation. The returned map is memoized on
 * `schema.cached.tableNodeTypes` so subsequent calls return the cached
 * value without re-scanning the schema.
 *
 * Enables `./create-table.ts` and `./create-cell.ts` to be
 * schema-agnostic — they work with any schema that registers nodes with
 * a `tableRole` spec, not just the canonical Plane schema (the
 * `tableRole` field is added to `NodeConfig` by the module augmentation
 * in `../table.ts`).
 */

import type { NodeType, Schema } from "@tiptap/pm/model";

/**
 * Build (or return the cached) `{ [role]: NodeType }` map by scanning
 * the schema for nodes that declare a `tableRole` spec.
 *
 * Input:
 *   - `schema` (`Schema`): the active document schema. The function
 *     iterates `schema.nodes` and reads `nodeType.spec.tableRole` on
 *     each.
 *
 * Output:
 *   - A frozen map of `tableRole` string (`"table"` / `"row"` /
 *     `"cell"` / `"header_cell"`) → `NodeType`. The map is stored on
 *     `schema.cached.tableNodeTypes` so subsequent calls bypass the
 *     scan.
 *
 * Cache key: `schema.cached.tableNodeTypes`. The cache is per-schema,
 * so multiple schemas (e.g., editor + sub-editor) maintain independent
 * lookups.
 *
 * WHY schema-driven (vs hardcoded node names):
 *   ProseMirror schemas can be composed with different node-name
 *   conventions (Plane uses `tableCell`, `tableHeader`, `tableRow`,
 *   `table`; other adopters might use other names). Scanning for the
 *   `tableRole` spec lets the table utilities work with ANY schema that
 *   participates in the role convention.
 */
export function getTableNodeTypes(schema: Schema): { [key: string]: NodeType } {
  if (schema.cached.tableNodeTypes) {
    return schema.cached.tableNodeTypes;
  }

  const roles: { [key: string]: NodeType } = {};

  Object.keys(schema.nodes).forEach((type) => {
    const nodeType = schema.nodes[type];

    if (nodeType.spec.tableRole) {
      roles[nodeType.spec.tableRole] = nodeType;
    }
  });

  schema.cached.tableNodeTypes = roles;

  return roles;
}
