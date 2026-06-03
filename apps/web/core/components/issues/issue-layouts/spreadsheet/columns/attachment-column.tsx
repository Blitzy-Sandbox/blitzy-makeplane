/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet read-only cell that displays the count of attachments on an issue.
 *
 * Rendered purpose: renders a single `<Row>` containing `<n> attachment` (singular) or
 * `<n> attachments` (plural) using the issue's pre-computed `attachment_count` aggregate.
 * Mounted only when `WithDisplayPropertiesHOC` (in the parent `issue-column.tsx`) approves the
 * `link` / `attachment` property group.
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; only `attachment_count` is read
 *
 * MobX stores read: none. The `attachment_count` aggregate is pre-computed by `apps/api` and
 * delivered as part of the issue payload.
 *
 * Side effects: none — read-only display.
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `attachment_count` property is enabled.
 */

import React from "react";
import { observer } from "mobx-react";
// types
import type { TIssue } from "@plane/types";
import { Row } from "@plane/ui";

/** Props for `SpreadsheetAttachmentColumn`. */
type Props = {
  issue: TIssue;
};

/** Read-only attachment-count cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetAttachmentColumn = observer(function SpreadsheetAttachmentColumn(props: Props) {
  const { issue } = props;

  return (
    <Row className="flex h-11 w-full items-center border-b-[0.5px] border-subtle py-1 text-11 group-[.selected-issue-row]:bg-accent-primary/5 hover:bg-layer-1 group-[.selected-issue-row]:hover:bg-accent-primary/10">
      {issue?.attachment_count ?? 0} {issue?.attachment_count === 1 ? "attachment" : "attachments"}
    </Row>
  );
});
