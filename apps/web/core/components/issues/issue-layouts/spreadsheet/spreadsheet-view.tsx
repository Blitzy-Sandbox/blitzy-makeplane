/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Composition layer for the spreadsheet issue layout.
 *
 * Rendered purpose: prepares the shared refs (table container + dropdown portal), computes the list
 * of spreadsheet columns to render based on per-project feature flags, mounts the multiple-select
 * group that powers bulk operations, and assembles `<SpreadsheetTable>` plus the sticky quick-add
 * footer and bulk-operations toolbar. Returns an empty fragment when there are zero issue ids so
 * the empty-state surface upstream (`IssueLayoutHOC`) can show its skeleton.
 *
 * Props (Props):
 *   - displayProperties (IIssueDisplayProperties, required): which columns are toggled on for the
 *     active filter; gates per-column visibility downstream
 *   - displayFilters (IIssueDisplayFilterOptions, required): the active sort / display filter state
 *   - handleDisplayFilterUpdate ((data: Partial<IIssueDisplayFilterOptions>) => void, required):
 *     parent callback to persist filter changes (writes through to the issues-filter store)
 *   - issueIds (string[] | undefined, required): the flat list of issue ids to render; when empty
 *     or undefined the layout short-circuits to an empty fragment
 *   - quickActions (TRenderQuickActions, required): render-prop returning per-row quick-action menu
 *   - updateIssue ((projectId, issueId, data) => Promise<void> | undefined, required): inline-edit
 *     mutator passed down to each cell editor; `undefined` disables inline editing entirely
 *   - openIssuesListModal (() => void | null, optional): unused by spreadsheet but preserved on the
 *     shared layout-prop contract
 *   - quickAddCallback ((projectId, data) => Promise<TIssue | undefined>, optional): callback to
 *     create a new issue via the QuickAdd footer; when omitted the footer falls back to its default
 *     `quickAddIssue` action from the active issues store
 *   - canEditProperties ((projectId) => boolean, required): per-project edit gate; cascades into
 *     row/cell components to disable interactive dropdowns
 *   - canLoadMoreIssues (boolean, required): whether to render the intersection-observer footer
 *     that triggers pagination
 *   - loadMoreIssues (() => void, required): paginator handler invoked by the intersection observer
 *   - enableQuickCreateIssue (boolean, optional): when true, render the quick-add footer
 *   - disableIssueCreation (boolean, optional): when true, hide the quick-add footer (overrides
 *     `enableQuickCreateIssue`)
 *   - isWorkspaceLevel (boolean, optional, default=false): when true, render ALL spreadsheet
 *     properties; when false, gate cycle/module columns by project feature flags
 *   - isEpic (boolean, optional, default=false): when true, propagate epic semantics to the table
 *     and disable bulk-operations (epics are not bulk-actionable in the spreadsheet)
 *
 * MobX stores read:
 *   - `useProject()` exposes `currentProjectDetails` — checked for `estimate`, `cycle_view`, and
 *     `module_view` feature flags to drive `isEstimateEnabled` and column visibility
 *   - `useBulkOperationStatus()` (plane-web hook) exposes whether bulk operations are enabled for
 *     the current workspace
 *
 * Side effects: none directly — all mutations are delegated through `updateIssue`, `quickAddCallback`,
 * `loadMoreIssues`, and the bulk-operations toolbar. The `<MultipleSelectGroup>` registers DOM
 * listeners for marquee selection while mounted.
 *
 * Derived state (the WHY for non-obvious computations):
 *   - `spreadsheetColumnsList`: when workspace-level, surface every property; otherwise, filter out
 *     `cycle` and `modules` columns whenever the project has cycles or modules disabled. This
 *     prevents columns from rendering for properties the project does not support.
 *   - `isEstimateEnabled`: derived from `currentProjectDetails?.estimate !== null` so estimate
 *     editors can short-circuit cleanly when the project has no estimate scale configured.
 *
 * Consumers:
 *   - `./base-spreadsheet-root.tsx` (most contexts)
 *   - `./roots/workspace-root.tsx` (workspace / global view direct usage)
 */

import React, { useRef } from "react";
import { observer } from "mobx-react";
// plane constants
import { SPREADSHEET_SELECT_GROUP, SPREADSHEET_PROPERTY_LIST } from "@plane/constants";
// types
import type { TIssue, IIssueDisplayFilterOptions, IIssueDisplayProperties } from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
// components
import { MultipleSelectGroup } from "@/components/core/multiple-select";
// hooks
import { useProject } from "@/hooks/store/use-project";
// plane web components
import { IssueBulkOperationsRoot } from "@/plane-web/components/issues/bulk-operations";
// plane web hooks
import { useBulkOperationStatus } from "@/plane-web/hooks/use-bulk-operation-status";
// local imports
import type { TRenderQuickActions } from "../list/list-view-types";
import { QuickAddIssueRoot, SpreadsheetAddIssueButton } from "../quick-add";
import { SpreadsheetTable } from "./spreadsheet-table";

/** Props for `SpreadsheetView`. */
type Props = {
  displayProperties: IIssueDisplayProperties;
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFilterUpdate: (data: Partial<IIssueDisplayFilterOptions>) => void;
  issueIds: string[] | undefined;
  quickActions: TRenderQuickActions;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  openIssuesListModal?: (() => void) | null;
  quickAddCallback?: (projectId: string | null | undefined, data: TIssue) => Promise<TIssue | undefined>;
  canEditProperties: (projectId: string | undefined) => boolean;
  canLoadMoreIssues: boolean;
  loadMoreIssues: () => void;
  enableQuickCreateIssue?: boolean;
  disableIssueCreation?: boolean;
  isWorkspaceLevel?: boolean;
  isEpic?: boolean;
};

/** Spreadsheet composition layer; see the module-level JSDoc for full semantics. */
export const SpreadsheetView = observer(function SpreadsheetView(props: Props) {
  const {
    displayProperties,
    displayFilters,
    handleDisplayFilterUpdate,
    issueIds,
    quickActions,
    updateIssue,
    quickAddCallback,
    canEditProperties,
    enableQuickCreateIssue,
    disableIssueCreation,
    canLoadMoreIssues,
    loadMoreIssues,
    isWorkspaceLevel = false,
    isEpic = false,
  } = props;
  // refs
  const containerRef = useRef<HTMLTableElement | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);
  // store hooks
  const { currentProjectDetails } = useProject();
  // plane web hooks
  const isBulkOperationsEnabled = useBulkOperationStatus();

  const isEstimateEnabled: boolean = currentProjectDetails?.estimate !== null;

  const spreadsheetColumnsList = isWorkspaceLevel
    ? SPREADSHEET_PROPERTY_LIST
    : SPREADSHEET_PROPERTY_LIST.filter((property) => {
        if (property === "cycle" && !currentProjectDetails?.cycle_view) return false;
        if (property === "modules" && !currentProjectDetails?.module_view) return false;
        return true;
      });

  if (!issueIds || issueIds.length === 0) return <></>;
  return (
    <div className="relative flex h-full w-full flex-col overflow-x-hidden bg-layer-1 whitespace-nowrap text-secondary">
      <div ref={portalRef} className="spreadsheet-menu-portal" />
      <MultipleSelectGroup
        containerRef={containerRef}
        entities={{
          [SPREADSHEET_SELECT_GROUP]: issueIds,
        }}
        disabled={!isBulkOperationsEnabled || isEpic}
      >
        {(helpers) => (
          <>
            <div ref={containerRef} className="vertical-scrollbar horizontal-scrollbar scrollbar-lg h-full w-full">
              <SpreadsheetTable
                displayProperties={displayProperties}
                displayFilters={displayFilters}
                handleDisplayFilterUpdate={handleDisplayFilterUpdate}
                issueIds={issueIds}
                isEstimateEnabled={isEstimateEnabled}
                portalElement={portalRef}
                quickActions={quickActions}
                updateIssue={updateIssue}
                canEditProperties={canEditProperties}
                containerRef={containerRef}
                canLoadMoreIssues={canLoadMoreIssues}
                loadMoreIssues={loadMoreIssues}
                spreadsheetColumnsList={spreadsheetColumnsList}
                selectionHelpers={helpers}
                isEpic={isEpic}
              />
            </div>
            <div className="border-t border-subtle">
              <div className="sticky bottom-0 left-0 z-5">
                {enableQuickCreateIssue && !disableIssueCreation && (
                  <QuickAddIssueRoot
                    layout={EIssueLayoutTypes.SPREADSHEET}
                    QuickAddButton={SpreadsheetAddIssueButton}
                    quickAddCallback={quickAddCallback}
                    isEpic={isEpic}
                  />
                )}
              </div>
            </div>
            <IssueBulkOperationsRoot selectionHelpers={helpers} />
          </>
        )}
      </MultipleSelectGroup>
    </div>
  );
});
