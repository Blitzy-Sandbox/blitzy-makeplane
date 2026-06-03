/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Identifier for the spreadsheet issue-selection group used by the multi-select store
 * to coordinate selection state across rows of the issue spreadsheet layout.
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/spreadsheet/**` and
 * `apps/web/core/store/multiple_select.store.ts`.
 */
export const SPREADSHEET_SELECT_GROUP = "spreadsheet-issues";
