/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet read-only cell that displays the issue's last-update timestamp.
 *
 * Rendered purpose: renders the issue's `updated_at` field formatted by `renderFormattedDate` from
 * `@plane/utils` (locale-aware short-date format). Mounted only when `WithDisplayPropertiesHOC`
 * approves the `updated_on` property.
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; only `updated_at` is read
 *
 * MobX stores read: none. The `updated_at` field is part of the issue payload from `apps/api` and
 * is auto-managed by the `TimeAuditModel` mixin on the backend (updated on any PATCH to the issue).
 *
 * Side effects: none — read-only display.
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `updated_on` property is enabled.
 */
import React from "react";
import { observer } from "mobx-react";
// types
import type { TIssue } from "@plane/types";
// helpers
import { Row } from "@plane/ui";
import { renderFormattedDate } from "@plane/utils";

/** Props for `SpreadsheetUpdatedOnColumn`. */
type Props = {
  issue: TIssue;
};

/** Read-only last-update-timestamp cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetUpdatedOnColumn = observer(function SpreadsheetUpdatedOnColumn(props: Props) {
  const { issue } = props;

  return (
    <Row className="flex h-11 w-full items-center border-b-[0.5px] border-subtle-1 text-11 group-[.selected-issue-row]:bg-accent-primary/5 hover:bg-layer-1 group-[.selected-issue-row]:hover:bg-accent-primary/10">
      {renderFormattedDate(issue.updated_at)}
    </Row>
  );
});
