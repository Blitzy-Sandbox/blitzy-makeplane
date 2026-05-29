/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet read-only cell that displays the count of links attached to an issue.
 *
 * Rendered purpose: renders a single `<Row>` containing `<n> link` (singular) or `<n> links`
 * (plural) using the issue's pre-computed `link_count` aggregate. Mounted only when
 * `WithDisplayPropertiesHOC` approves the link / attachment property group.
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; only `link_count` is read
 *
 * MobX stores read: none. The `link_count` aggregate is pre-computed by `apps/api` and delivered
 * as part of the issue payload.
 *
 * Side effects: none — read-only display.
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `link` property is enabled.
 */

import React from "react";
import { observer } from "mobx-react";
// types
import type { TIssue } from "@plane/types";
import { Row } from "@plane/ui";

/** Props for `SpreadsheetLinkColumn`. */
type Props = {
  issue: TIssue;
};

/** Read-only link-count cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetLinkColumn = observer(function SpreadsheetLinkColumn(props: Props) {
  const { issue } = props;

  return (
    <Row className="flex h-11 w-full items-center border-b-[0.5px] border-subtle px-2.5 px-page-x py-1 text-11 group-[.selected-issue-row]:bg-accent-primary/5 hover:bg-layer-1 group-[.selected-issue-row]:hover:bg-accent-primary/10">
      {issue?.link_count ?? 0} {issue?.link_count === 1 ? "link" : "links"}
    </Row>
  );
});
