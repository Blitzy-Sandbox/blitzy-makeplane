/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the generic `Table` component.
 *
 * Re-exports only the runtime `Table` symbol from `./table` so consumers can
 * import from the directory path (`packages/ui/src/tables`) rather than the
 * concrete file. Column and table props type contracts (`TTableColumn`,
 * `TTableData`) intentionally live in `./types` and are not re-exported here —
 * callers that need the types must import them from `./types` explicitly.
 */

export * from "./table";
