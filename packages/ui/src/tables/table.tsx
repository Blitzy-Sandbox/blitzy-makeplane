/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Generic typed table component with columns-driven cell rendering.
 *
 * Renders a structured `<table>` whose rows are typed `T` instances and whose
 * cells are produced by per-column `tdRender` callbacks. The component is
 * schema-agnostic — it never inspects row fields directly, so cell formatting
 * and row identity are owned entirely by the caller via the `columns` array and
 * `keyExtractor` prop. Class-name override props give styling control over each
 * structural level (table, thead, header row, header cell, tbody, body row,
 * body cell) without forking the component.
 */

import React from "react";
// helpers
import { cn } from "../utils";
// types
import type { TTableData } from "./types";

/**
 * Generic table component that renders typed row data using caller-supplied
 * column descriptors.
 *
 * Cell rendering is delegated to each `column.tdRender(row)` callback; header
 * rendering prefers `column.thRender()` when defined and truthy, otherwise
 * falls back to the static `column.content` label. Row identity is supplied by
 * `keyExtractor`, which produces React keys for each `<tr>` and is also
 * concatenated with `column.key` to key body `<td>` cells (`${column.key}-${rowKey}`).
 *
 * @template T - Row data type. Each entry in `data` is passed unchanged to
 *               `keyExtractor` and to every `column.tdRender`.
 *
 * @param props - Configuration object typed as `TTableData<T>` from `./types`.
 * @param props.data - Required array of row instances; one `<tr>` is emitted
 *                     per entry in `<tbody>`.
 * @param props.columns - Required ordered column descriptors; controls header
 *                        order, per-cell rendering, and column keys.
 * @param props.keyExtractor - Required row-key function; supplies the React key
 *                             for each body `<tr>` and is composed with
 *                             `column.key` to produce `<td>` keys.
 * @param props.tableClassName - Optional extra classes appended to the outer
 *                               `<table>` element (default base classes:
 *                               `w-full table-auto overflow-hidden whitespace-nowrap`).
 * @param props.tHeadClassName - Optional extra classes appended to `<thead>`
 *                               (default base: `divide-y divide-subtle`).
 * @param props.tHeadTrClassName - Optional extra classes appended to the header
 *                                 `<tr>` (default base:
 *                                 `divide-x divide-subtle text-13 text-primary`).
 * @param props.thClassName - Optional extra classes appended to each `<th>`
 *                            (default base: `px-2.5 py-2`).
 * @param props.tBodyClassName - Optional extra classes appended to `<tbody>`
 *                               (default base: `divide-y divide-subtle`).
 * @param props.tBodyTrClassName - Optional extra classes appended to each body
 *                                 `<tr>` (default base:
 *                                 `divide-x divide-subtle text-13 text-secondary`).
 * @param props.tdClassName - Optional extra classes appended to each `<td>`
 *                            (default base: `px-2.5 py-2`).
 *
 * @returns A native `<table>` element using `<thead>`/`<tbody>` partitioning.
 *
 * Accessibility:
 *   Uses native HTML table semantics so screen readers can announce rows and
 *   columns by default. Header cells are rendered as `<th>` but do NOT set
 *   `scope="col"`, no `aria-sort` is exposed (no sortable column contract
 *   exists in `TTableColumn<T>`), and rows are not keyboard- or
 *   pointer-interactive. See the `// INTENT UNCLEAR` flag inside the function
 *   body regarding the absence of a row-interaction surface.
 *
 * Side effects: none — the component is presentational and does not call APIs,
 *   read from MobX stores, or navigate.
 */
export function Table<T>(props: TTableData<T>) {
  const {
    data,
    columns,
    keyExtractor,
    tableClassName = "",
    tHeadClassName = "",
    tHeadTrClassName = "",
    thClassName = "",
    tBodyClassName = "",
    tBodyTrClassName = "",
    tdClassName = "",
  } = props;

  // INTENT UNCLEAR: <tr> elements carry no tabIndex/role/onClick and <th> cells
  // omit scope="col"/aria-sort — row and header interactivity are not implemented.
  return (
    <table className={cn("w-full table-auto overflow-hidden whitespace-nowrap", tableClassName)}>
      <thead className={cn("divide-y divide-subtle", tHeadClassName)}>
        <tr className={cn("divide-x divide-subtle text-13 text-primary", tHeadTrClassName)}>
          {columns.map((column) => (
            <th key={column.key} className={cn("px-2.5 py-2", thClassName)}>
              {(column?.thRender && column?.thRender()) || column.content}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className={cn("divide-y divide-subtle", tBodyClassName)}>
        {data.map((item) => (
          <tr
            key={keyExtractor(item)}
            className={cn("divide-x divide-subtle text-13 text-secondary", tBodyTrClassName)}
          >
            {columns.map((column) => (
              <td key={`${column.key}-${keyExtractor(item)}`} className={cn("px-2.5 py-2", tdClassName)}>
                {column.tdRender(item)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
