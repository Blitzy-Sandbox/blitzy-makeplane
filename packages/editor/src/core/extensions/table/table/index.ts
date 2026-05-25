/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Inner barrel for the table NodeView module.
 *
 * Re-exports:
 *   - `Table` — the canonical `Table` Node extension from `./table.ts`.
 *
 * Defines:
 *   - `DEFAULT_COLUMN_WIDTH` (150) — the single source of truth for the
 *     default column width (in pixels) seeded into every freshly-created
 *     table cell's `colwidth` attribute.
 *
 * WHY a separate inner barrel:
 *   Keeps the `table/table/` directory self-contained — siblings inside
 *   this directory (`./table.ts`, `./table-view.tsx`, `./icons.ts`,
 *   `./utilities/`) can import the `Table` extension and the default
 *   column width through one path without reaching up into the outer
 *   `../table-cell.ts` / `../table-header.ts` siblings, and the outer
 *   schema files (`../table-cell.ts`, `../table-header.ts`) reach back
 *   into this barrel via `from "./table"` to consume
 *   `DEFAULT_COLUMN_WIDTH` without depending on `./table.ts` directly.
 *
 * Consumers of `DEFAULT_COLUMN_WIDTH`:
 *   - `./table.ts` — passes to `createTable` in the `insertTable` command.
 *   - `../table-cell.ts` — default value of the `TableCell.colwidth`
 *     attribute (every fresh cell starts with `[DEFAULT_COLUMN_WIDTH]`).
 *   - `../table-header.ts` — same default for the `TableHeader.colwidth`
 *     attribute.
 *
 * Changing `DEFAULT_COLUMN_WIDTH` cascades to every freshly-created
 * cell's initial width across the entire table extension.
 *
 * First-party note (AAP §0.2.2):
 *   The `Table` symbol re-exported here is a Plane-built extension that
 *   parallels `@tiptap/extension-table`. Treat it as owned code, not a
 *   third-party abstraction.
 */

export { Table } from "./table";

/**
 * Default column width (in CSS pixels) seeded into every freshly-created
 * table cell's `colwidth` attribute array.
 *
 * Consumed by `../table-cell.ts` (default attribute value), by
 * `../table-header.ts` (default attribute value), and by `./table.ts`
 * (passed to `createTable` in the `insertTable` command). Also used by
 * the column drag-handle width math in
 * `../plugins/drag-handles/column/` for the initial pre-resize layout.
 *
 * Pixel value (150) chosen to match the upstream
 * `@tiptap/extension-table` default while giving Plane's column-resize
 * UX enough room for the drag-handle hit area defined by
 * `Table.options.handleWidth` (default 5px).
 */
export const DEFAULT_COLUMN_WIDTH = 150;
