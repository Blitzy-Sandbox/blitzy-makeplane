/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sticky `<thead>` row for the spreadsheet issue layout.
 *
 * Rendered purpose: renders the table's frozen header row containing (a) a single leading sticky
 * column that combines the bulk-select group action with the "Work items" / "Epics" label, and
 * (b) one `<SpreadsheetHeaderColumn>` per property in `spreadsheetColumnsList` (which provides
 * sort controls and the property's icon + name).
 *
 * Props (Props):
 *   - displayProperties (IIssueDisplayProperties, required): which property columns are visible;
 *     forwarded to each per-property header column
 *   - displayFilters (IIssueDisplayFilterOptions, required): the active sort state — header
 *     columns render the sort-direction indicator from this
 *   - handleDisplayFilterUpdate ((data) => void, required): callback to persist sort changes from
 *     the per-column header menus
 *   - canEditProperties ((projectId) => boolean, required): combined with `selectionHelpers.isSelectionDisabled`
 *     to determine whether the bulk-select group action should appear
 *   - isEstimateEnabled (boolean, required): forwarded into the per-property header columns
 *   - spreadsheetColumnsList ((keyof IIssueDisplayProperties)[], required): the columns to render
 *     after the leading sticky column
 *   - selectionHelpers (TSelectionHelper, required): exposes `isGroupSelected(groupId)` and
 *     `isSelectionDisabled`; the leading column hosts a `<MultipleSelectGroupAction>` that toggles
 *     the entire SPREADSHEET_SELECT_GROUP
 *   - isEpic (boolean, optional, default=false): when true, the leading label reads "Epics"
 *     instead of "Work items"
 *
 * MobX stores read: none directly — uses `useParams()` (route param) and reads selection state via
 * the `selectionHelpers` prop.
 *
 * Side effects: none — render-only. The bulk-select toggle action invokes selection helpers from
 * the `<MultipleSelectGroup>` higher-order component above.
 *
 * Derived state:
 *   - `isGroupSelectionEmpty`: true when no rows in `SPREADSHEET_SELECT_GROUP` are selected — the
 *     bulk-select toggle is hidden by default (opacity-0) and revealed on hover OR forced visible
 *     when the group is not empty. This keeps the header visually clean until selection begins.
 *   - `canSelectIssues`: combines the edit-permission gate with the selection-disabled gate from
 *     the multiple-select group; only when both pass does the bulk-select control render.
 *
 * Consumers:
 *   - `./spreadsheet-table.tsx` — the only consumer; this module is not exported via a barrel.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// constants
import { SPREADSHEET_SELECT_GROUP } from "@plane/constants";
// ui
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties } from "@plane/types";
// components
import { cn } from "@plane/utils";
import { MultipleSelectGroupAction } from "@/components/core/multiple-select";
// hooks
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { SpreadsheetHeaderColumn } from "./spreadsheet-header-column";

/** Props for `SpreadsheetHeader`. */
interface Props {
  displayProperties: IIssueDisplayProperties;
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFilterUpdate: (data: Partial<IIssueDisplayFilterOptions>) => void;
  canEditProperties: (projectId: string | undefined) => boolean;
  isEstimateEnabled: boolean;
  spreadsheetColumnsList: (keyof IIssueDisplayProperties)[];
  selectionHelpers: TSelectionHelper;
  isEpic?: boolean;
}

/** Sticky table header for the spreadsheet layout; see the module-level JSDoc for full semantics. */
export const SpreadsheetHeader = observer(function SpreadsheetHeader(props: Props) {
  const {
    displayProperties,
    displayFilters,
    handleDisplayFilterUpdate,
    canEditProperties,
    isEstimateEnabled,
    spreadsheetColumnsList,
    selectionHelpers,
    isEpic = false,
  } = props;
  // router
  const { projectId } = useParams();
  // derived values
  const isGroupSelectionEmpty = selectionHelpers.isGroupSelected(SPREADSHEET_SELECT_GROUP) === "empty";
  // auth
  const canSelectIssues = canEditProperties(projectId?.toString()) && !selectionHelpers.isSelectionDisabled;

  return (
    <thead className="sticky top-0 left-0 z-[12] border-b-[0.5px] border-subtle">
      <tr>
        {/* Single header column containing both identifier and workitem */}
        <th
          className="group/list-header left-0 z-[15] h-11 min-w-60 border-r-[0.5px] border-subtle bg-layer-1 text-13 font-medium md:sticky"
          tabIndex={-1}
        >
          <div className="flex h-full w-full items-center gap-2 px-page-x">
            {/* Workitem header section */}
            <div className="flex h-full min-w-80 flex-grow items-center gap-1 py-2.5">
              {canSelectIssues && (
                <div className="mr-1 flex w-3.5 flex-shrink-0 items-center">
                  <MultipleSelectGroupAction
                    className={cn(
                      "pointer-events-none size-3.5 opacity-0 !outline-none group-hover/list-header:pointer-events-auto group-hover/list-header:opacity-100",
                      {
                        "pointer-events-auto opacity-100": !isGroupSelectionEmpty,
                      }
                    )}
                    groupID={SPREADSHEET_SELECT_GROUP}
                    selectionHelpers={selectionHelpers}
                  />
                </div>
              )}
              <span className="text-13 font-medium">{`${isEpic ? "Epics" : "Work items"}`}</span>
            </div>
          </div>
        </th>

        {spreadsheetColumnsList.map((property) => (
          <SpreadsheetHeaderColumn
            key={property}
            property={property}
            displayProperties={displayProperties}
            displayFilters={displayFilters}
            handleDisplayFilterUpdate={handleDisplayFilterUpdate}
            isEstimateEnabled={isEstimateEnabled}
            isEpic={isEpic}
          />
        ))}
      </tr>
    </thead>
  );
});
