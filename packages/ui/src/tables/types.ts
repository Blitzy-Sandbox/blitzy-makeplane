/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared type contracts for the generic `Table` component.
 *
 * Splits the column descriptor (`TTableColumn<T>`) and the component props
 * shape (`TTableData<T>`) out of the React component file so callers can
 * declare column lists in type-only or non-JSX modules without pulling the
 * `<Table>` runtime into their dependency graph.
 */

/**
 * Column descriptor consumed by `<Table<T>>` to render one header cell and one
 * body cell per row.
 *
 * @template T - Row data type; passed unchanged to `tdRender` so the callback
 *               can project a single cell value out of the row.
 *
 * Fields:
 *  - `key` (required, `string`): Stable column identifier. Used as the React
 *    key for the `<th>` header cell and concatenated with the row key
 *    (`${key}-${rowKey}`) for each `<td>` body cell — must therefore be unique
 *    across the `columns` array.
 *  - `content` (required, `string`): Default header label rendered inside
 *    `<th>` when `thRender` is not supplied or returns a falsy value.
 *  - `thRender` (optional, `() => React.ReactNode`): Custom header renderer.
 *    When defined and returning a truthy node, it takes precedence over
 *    `content` (see `table.tsx`: `(column?.thRender && column?.thRender()) || column.content`).
 *  - `tdRender` (required, `(rowData: T) => React.ReactNode`): Body-cell
 *    renderer; receives the row instance and returns the React node placed
 *    inside the `<td>`. Required because `<Table>` is schema-agnostic and
 *    never reads row fields directly.
 */
export type TTableColumn<T> = {
  key: string;
  content: string;
  thRender?: () => React.ReactNode;
  tdRender: (rowData: T) => React.ReactNode;
};

/**
 * Full props shape for the generic `Table<T>` component.
 *
 * @template T - Row data type shared with each `TTableColumn<T>.tdRender` so
 *               the column callbacks receive correctly typed rows.
 *
 * Required fields:
 *  - `data` (`T[]`): Row instances; one `<tr>` is rendered in `<tbody>` per
 *    entry, in the order provided.
 *  - `columns` (`TTableColumn<T>[]`): Ordered column descriptors; controls
 *    header order and per-cell rendering.
 *  - `keyExtractor` (`(rowData: T) => string`): Derives the React key for each
 *    body `<tr>`. The returned value is also composed with `column.key` to key
 *    every `<td>` (`${column.key}-${rowKey}`), so it MUST be unique per row.
 *
 * Optional class-name overrides (each appended to the component's base classes
 * via `cn(...)` — they extend, not replace, the defaults):
 *  - `tableClassName`     — outer `<table>` element.
 *  - `tHeadClassName`     — `<thead>` element.
 *  - `tHeadTrClassName`   — header `<tr>` row.
 *  - `thClassName`        — every `<th>` header cell.
 *  - `tBodyClassName`     — `<tbody>` element.
 *  - `tBodyTrClassName`   — every body `<tr>` row.
 *  - `tdClassName`        — every `<td>` body cell.
 */
export type TTableData<T> = {
  data: T[];
  columns: TTableColumn<T>[];
  keyExtractor: (rowData: T) => string;
  // classNames
  tableClassName?: string;
  tHeadClassName?: string;
  tHeadTrClassName?: string;
  thClassName?: string;
  tBodyClassName?: string;
  tBodyTrClassName?: string;
  tdClassName?: string;
};
