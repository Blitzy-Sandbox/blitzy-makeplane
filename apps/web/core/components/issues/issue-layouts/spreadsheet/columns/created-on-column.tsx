/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet read-only cell that displays the issue's creation timestamp.
 *
 * Rendered purpose: renders the issue's `created_at` field formatted by `renderFormattedDate` from
 * `@plane/utils` (locale-aware short-date format). Mounted only when `WithDisplayPropertiesHOC`
 * (in the parent `issue-column.tsx`) approves the `created_on` property.
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; only `created_at` is read
 *
 * MobX stores read: none. The `created_at` field is part of the issue payload from `apps/api`.
 *
 * Side effects: none — read-only display.
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `created_on` property is enabled.
 */
import React from "react";
import { observer } from "mobx-react";
// types
import type { TIssue } from "@plane/types";
// helpers
import { Row } from "@plane/ui";
import { renderFormattedDate } from "@plane/utils";

/** Props for `SpreadsheetCreatedOnColumn`. */
type Props = {
  issue: TIssue;
};

/** Read-only creation-timestamp cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetCreatedOnColumn = observer(function SpreadsheetCreatedOnColumn(props: Props) {
  const { issue } = props;

  return (
    <Row className="flex h-11 w-full items-center border-b-[0.5px] border-subtle text-11 group-[.selected-issue-row]:bg-accent-primary/5 hover:bg-layer-1 group-[.selected-issue-row]:hover:bg-accent-primary/10">
      {renderFormattedDate(issue.created_at)}
    </Row>
  );
});
