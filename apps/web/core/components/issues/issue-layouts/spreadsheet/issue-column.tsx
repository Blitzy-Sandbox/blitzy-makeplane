/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Single spreadsheet cell dispatcher for an issue property.
 *
 * Rendered purpose: looks up the appropriate column-editor component for the given `property` in
 * the `SPREADSHEET_COLUMNS` registry (from `@/plane-web/components/issues/issue-layouts/utils`),
 * then renders it inside a focusable `<td>` cell. Returns `null` when no editor exists for the
 * property (defensive guard). Gates rendering through `WithDisplayPropertiesHOC` + the
 * `shouldRenderColumn(property)` helper so cells appear only when the property is enabled.
 *
 * Props (Props):
 *   - displayProperties (IIssueDisplayProperties, required): the property visibility map;
 *     forwarded to `WithDisplayPropertiesHOC`
 *   - issueDetail (TIssue, required): the resolved issue object — passed verbatim into the
 *     selected column editor
 *   - disableUserActions (boolean, required): when true, the column editor is rendered in
 *     read-only mode (cascaded from `canEditProperties` upstream)
 *   - property (keyof IIssueDisplayProperties, required): the property key; controls both the
 *     property-gate lookup and the `SPREADSHEET_COLUMNS[property]` registry lookup
 *   - updateIssue ((projectId, issueId, data) => Promise<void> | undefined, required): inline-edit
 *     mutator. The internal `handleUpdateIssue` wrapper invokes this with `(issue, data)` shape,
 *     passing through the issue's `project_id` and `id` so the editor doesn't have to know about
 *     them.
 *   - isEstimateEnabled (boolean, required): part of the shared cell-prop contract; not consumed
 *     directly here but kept for parity with sibling cells
 *
 * MobX stores read: none — pure dispatcher; the selected column editor is responsible for its
 * own store wiring.
 *
 * Side effects:
 *   - When the selected column editor calls `onChange(issue, data)`, `handleUpdateIssue` invokes
 *     `updateIssue(issue.project_id, issue.id, data)` which ultimately PATCHes the issue via the
 *     issue service (`apps/api`).
 *   - `onClose={() => tableCellRef?.current?.focus()}` restores focus to the `<td>` after the
 *     editor closes (imperative DOM focus management — required so keyboard users can continue
 *     navigating the table after editing).
 *
 * Derived state / conditional rendering (the WHY):
 *   - `Column = SPREADSHEET_COLUMNS[property]`: this lookup is the central column-dispatcher. The
 *     registry lives in `@/plane-web/components/issues/issue-layouts/utils` so plane-web (the
 *     proprietary extension surface) can add additional property editors without modifying this
 *     core file.
 *   - `shouldRenderProperty` from `shouldRenderColumn(property)` lets `WithDisplayPropertiesHOC`
 *     layer per-property visibility gates (e.g. cycle / module columns are hidden when the project
 *     has those features disabled).
 *
 * Consumers:
 *   - `./issue-row.tsx` — instantiated once per property in `spreadsheetColumnsList` for every
 *     visible issue row.
 */

import { useRef } from "react";
import { observer } from "mobx-react";
// types
import type { IIssueDisplayProperties, TIssue } from "@plane/types";
// components
import { SPREADSHEET_COLUMNS } from "@/plane-web/components/issues/issue-layouts/utils";
import { shouldRenderColumn } from "@/helpers/issue-filter.helper";
import { WithDisplayPropertiesHOC } from "../properties/with-display-properties-HOC";

/** Props for `IssueColumn`. */
type Props = {
  displayProperties: IIssueDisplayProperties;
  issueDetail: TIssue;
  disableUserActions: boolean;
  property: keyof IIssueDisplayProperties;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  isEstimateEnabled: boolean;
};

/** Single spreadsheet cell dispatcher; see the module-level JSDoc for full semantics. */
export const IssueColumn = observer(function IssueColumn(props: Props) {
  const { displayProperties, issueDetail, disableUserActions, property, updateIssue } = props;
  // router
  const tableCellRef = useRef<HTMLTableCellElement | null>(null);

  const shouldRenderProperty = shouldRenderColumn(property);

  const Column = SPREADSHEET_COLUMNS[property];

  if (!Column) return null;

  const handleUpdateIssue = async (issue: TIssue, data: Partial<TIssue>) => {
    if (updateIssue) await updateIssue(issue.project_id, issue.id, data);
  };

  return (
    <WithDisplayPropertiesHOC
      displayProperties={displayProperties}
      displayPropertyKey={property}
      shouldRenderProperty={() => shouldRenderProperty}
    >
      <td
        tabIndex={0}
        className="h-11 min-w-36 border-r-[1px] border-subtle text-13 after:absolute after:bottom-[-1px] after:w-full after:border after:border-subtle"
        ref={tableCellRef}
      >
        <Column
          issue={issueDetail}
          onChange={handleUpdateIssue}
          disabled={disableUserActions}
          onClose={() => tableCellRef?.current?.focus()}
        />
      </td>
    </WithDisplayPropertiesHOC>
  );
});
