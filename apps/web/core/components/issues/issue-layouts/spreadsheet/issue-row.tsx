/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Recursive issue-row engine for the spreadsheet layout.
 *
 * Rendered purpose: renders one issue as a row of the spreadsheet table — comprising the leading
 * sticky cell (with identifier, selection checkbox, sub-issue chevron, title, and quick-action menu)
 * plus one `<IssueColumn>` per visible property. When the row is expanded, recursively renders its
 * sub-issues at incremented nesting depth (capped at 3 levels — beyond that, expansion opens the
 * issue's peek-overview instead of nesting further).
 *
 * Exports:
 *   - `SpreadsheetIssueRow` — virtualisation-aware wrapper around `IssueRowDetails`; uses
 *     `<RenderIfVisible>` so off-screen rows render only placeholder `<td>`s, recovers full markup
 *     when scrolled into view, and recursively descends into sub-issues when expanded.
 *
 * Props for `SpreadsheetIssueRow` (Props):
 *   - displayProperties (IIssueDisplayProperties, required): which property columns to render in
 *     each cell
 *   - isEstimateEnabled (boolean, required): forwarded into per-cell rendering
 *   - quickActions (TRenderQuickActions, required): render-prop returning the per-row quick-action menu
 *   - canEditProperties ((projectId) => boolean, required): per-project edit gate
 *   - updateIssue (mutator, required): inline-edit mutator for cells
 *   - portalElement (MutableRefObject<HTMLDivElement | null>, required): shared portal container for
 *     cell dropdowns
 *   - nestingLevel (number, required): zero for top-level rows, incremented by 1 per sub-issue
 *     depth; visually expressed as `spacingLeft` indentation
 *   - issueId (string, required): the issue id this row represents
 *   - isScrolled (MutableRefObject<boolean>, required): ref tracking horizontal scroll state for
 *     leading-column shadow
 *   - containerRef (MutableRefObject<HTMLTableElement | null>, required): table container ref
 *     forwarded to `<RenderIfVisible>` for intersection observation
 *   - spreadsheetColumnsList ((keyof IIssueDisplayProperties)[], required): the columns to render
 *   - spacingLeft (number, optional, default=6): pixel indentation prepended to nested rows
 *   - selectionHelpers (TSelectionHelper, required): bulk-selection helpers
 *   - shouldRenderByDefault (boolean, optional): force-render bypass for `<RenderIfVisible>`; used
 *     to keep newly-expanded sub-issues visible without waiting for the intersection observer
 *   - isEpic (boolean, optional, default=false): epic-mode flag
 *
 * MobX stores read:
 *   - `useIssueDetail(serviceType)` exposes `subIssues` (subIssuesByIssueId, fetchSubIssues) and
 *     (in `IssueRowDetails`) `getIsIssuePeeked`, `peekIssue`, `issue.getIssueById`
 *   - `useIssues()` exposes `issueMap` for the cheap initial selection / active check
 *   - `useProject()` exposes `getProjectIdentifierById(projectId)`
 *
 * Side effects:
 *   - When the user clicks the sub-issues chevron AND the row is not already expanded AND the
 *     workspace/project ids are known, `subIssuesStore.fetchSubIssues(workspaceSlug, projectId, issueId)`
 *     is called (issues a GET against `/api/workspaces/<slug>/projects/<id>/issues/<id>/sub-issues/`)
 *     and updates the local expansion state.
 *   - When nesting level reaches 3, clicking the chevron calls `handleRedirection(...)` from
 *     `useIssuePeekOverviewRedirection(isEpic)` which navigates to the issue peek overview.
 *   - The leading cell wraps the row title in a `<ControlLink>` that opens the issue peek overview
 *     via `handleIssuePeekOverview` (route navigation, no API call).
 *   - `quickActions(...)` may invoke remove/update/archive/restore mutators (driven by the parent
 *     `<BaseSpreadsheetRoot>`).
 *
 * Imperative DOM interactions (the WHY for non-obvious patterns):
 *   - `<RenderIfVisible>` with a 100px `verticalOffset` is used to keep off-screen rows as cheap
 *     placeholder `<td colSpan={100}>` elements (each ~ row-height tall) so the table maintains
 *     scrollable height without paying the render cost for off-screen issues.
 *   - `useOutsideClickDetector(menuActionRef, () => setIsMenuActive(false))` closes the row's
 *     dropdown menu when the user clicks anywhere outside the menu trigger.
 *   - `shouldRenderByDefault={shouldRenderByDefault || isIssueNew(issue)}` ensures newly-created
 *     issues are visible immediately (otherwise they could land off-screen and fail to render).
 *
 * Consumers:
 *   - `./spreadsheet-table.tsx` (top-level rows)
 *   - `./issue-row.tsx` itself (recursive sub-issue rows)
 */

import type { Dispatch, MouseEvent, MutableRefObject, SetStateAction } from "react";
import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { SPREADSHEET_SELECT_GROUP } from "@plane/constants";
// plane helpers
import { useOutsideClickDetector } from "@plane/hooks";
import { ChevronRightIcon } from "@plane/propel/icons";
// types
import { Tooltip } from "@plane/propel/tooltip";
import type { IIssueDisplayProperties, TIssue } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// ui
import { ControlLink, Row } from "@plane/ui";
import { cn, generateWorkItemLink } from "@plane/utils";
// components
import { MultipleSelectEntityAction } from "@/components/core/multiple-select";
import RenderIfVisible from "@/components/core/render-if-visible-HOC";
// helper
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
// local components
import type { TRenderQuickActions } from "../list/list-view-types";
import { isIssueNew } from "../utils";
import { IssueColumn } from "./issue-column";

/** Props for `SpreadsheetIssueRow`. */
interface Props {
  displayProperties: IIssueDisplayProperties;
  isEstimateEnabled: boolean;
  quickActions: TRenderQuickActions;
  canEditProperties: (projectId: string | undefined) => boolean;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  portalElement: React.MutableRefObject<HTMLDivElement | null>;
  nestingLevel: number;
  issueId: string;
  isScrolled: MutableRefObject<boolean>;
  containerRef: MutableRefObject<HTMLTableElement | null>;
  spreadsheetColumnsList: (keyof IIssueDisplayProperties)[];
  spacingLeft?: number;
  selectionHelpers: TSelectionHelper;
  shouldRenderByDefault?: boolean;
  isEpic?: boolean;
}

/** Virtualisation-aware spreadsheet row with recursive sub-issue rendering; see the module-level JSDoc for full semantics. */
export const SpreadsheetIssueRow = observer(function SpreadsheetIssueRow(props: Props) {
  const {
    displayProperties,
    issueId,
    isEstimateEnabled,
    nestingLevel,
    portalElement,
    updateIssue,
    quickActions,
    canEditProperties,
    isScrolled,
    containerRef,
    spreadsheetColumnsList,
    spacingLeft = 6,
    selectionHelpers,
    shouldRenderByDefault,
    isEpic = false,
  } = props;
  // states
  const [isExpanded, setExpanded] = useState<boolean>(false);
  // store hooks
  const { subIssues: subIssuesStore } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
  const { issueMap } = useIssues();

  // derived values
  const issue = issueMap[issueId];
  const subIssues = subIssuesStore.subIssuesByIssueId(issueId);
  const isIssueSelected = selectionHelpers.getIsEntitySelected(issueId);
  const isIssueActive = selectionHelpers.getIsEntityActive(issueId);

  if (!issue) return null;

  return (
    <>
      {/* first column/ issue name and key column */}
      <RenderIfVisible
        as="tr"
        root={containerRef}
        placeholderChildren={
          <td
            colSpan={100}
            className="border-[0.5px] border-transparent border-b-subtle-1"
            style={{ height: "calc(2.75rem - 1px)" }}
          />
        }
        classNames={cn("bg-surface-1 transition-[background-color]", {
          "group selected-issue-row": isIssueSelected,
          "border-[0.5px] border-strong-1": isIssueActive,
        })}
        verticalOffset={100}
        shouldRecordHeights={false}
        defaultValue={shouldRenderByDefault || isIssueNew(issue)}
      >
        <IssueRowDetails
          issueId={issueId}
          displayProperties={displayProperties}
          quickActions={quickActions}
          canEditProperties={canEditProperties}
          nestingLevel={nestingLevel}
          spacingLeft={spacingLeft}
          isEstimateEnabled={isEstimateEnabled}
          updateIssue={updateIssue}
          portalElement={portalElement}
          isScrolled={isScrolled}
          isExpanded={isExpanded}
          setExpanded={setExpanded}
          spreadsheetColumnsList={spreadsheetColumnsList}
          selectionHelpers={selectionHelpers}
          isEpic={isEpic}
        />
      </RenderIfVisible>

      {isExpanded &&
        !isEpic &&
        subIssues?.map((subIssueId: string) => (
          <SpreadsheetIssueRow
            key={subIssueId}
            issueId={subIssueId}
            displayProperties={displayProperties}
            quickActions={quickActions}
            canEditProperties={canEditProperties}
            nestingLevel={nestingLevel + 1}
            spacingLeft={spacingLeft + 12}
            isEstimateEnabled={isEstimateEnabled}
            updateIssue={updateIssue}
            portalElement={portalElement}
            isScrolled={isScrolled}
            containerRef={containerRef}
            spreadsheetColumnsList={spreadsheetColumnsList}
            selectionHelpers={selectionHelpers}
            shouldRenderByDefault={isExpanded}
          />
        ))}
    </>
  );
});

/** Props for the internal `IssueRowDetails` row body. Mostly identical to `Props` but adds the
 *  expansion state (isExpanded / setExpanded) from the wrapping `<RenderIfVisible>`. */
interface IssueRowDetailsProps {
  displayProperties: IIssueDisplayProperties;
  isEstimateEnabled: boolean;
  quickActions: TRenderQuickActions;
  canEditProperties: (projectId: string | undefined) => boolean;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  portalElement: React.MutableRefObject<HTMLDivElement | null>;
  nestingLevel: number;
  issueId: string;
  isScrolled: MutableRefObject<boolean>;
  isExpanded: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  spreadsheetColumnsList: (keyof IIssueDisplayProperties)[];
  spacingLeft?: number;
  selectionHelpers: TSelectionHelper;
  isEpic?: boolean;
}

/**
 * Actual row markup for a single issue (the inner body of `<SpreadsheetIssueRow>` after the
 * `<RenderIfVisible>` virtualisation gate).
 *
 * Renders the sticky leading cell (identifier + selection toggle + sub-issue chevron + title +
 * quick-action menu) followed by one `<IssueColumn>` per property in `spreadsheetColumnsList`.
 * Handles the click-to-peek `<ControlLink>`, chevron-toggle expansion, and the customAction menu
 * outside-click dismissal. Reads `isMobile` from `usePlatformOS()` to switch the peek-overview
 * navigation strategy.
 *
 * Returns `null` if the issue is not yet resolved by `getIssueById`.
 */
const IssueRowDetails = observer(function IssueRowDetails(props: IssueRowDetailsProps) {
  const {
    displayProperties,
    issueId,
    isEstimateEnabled,
    nestingLevel,
    portalElement,
    updateIssue,
    quickActions,
    canEditProperties,
    isScrolled,
    isExpanded,
    setExpanded,
    spreadsheetColumnsList,
    spacingLeft = 6,
    selectionHelpers,
    isEpic = false,
  } = props;
  // states
  const [isMenuActive, setIsMenuActive] = useState(false);
  // refs
  const cellRef = useRef(null);
  const menuActionRef = useRef<HTMLDivElement | null>(null);
  // router
  const { workspaceSlug, projectId } = useParams();
  // hooks
  const { getProjectIdentifierById } = useProject();
  const { getIsIssuePeeked, peekIssue } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);
  const { isMobile } = usePlatformOS();

  // handlers
  const handleIssuePeekOverview = (issue: TIssue) =>
    handleRedirection(workspaceSlug?.toString(), issue, isMobile, nestingLevel);

  const { subIssues: subIssuesStore, issue } = useIssueDetail();

  const issueDetail = issue.getIssueById(issueId);

  const subIssueIndentation = `${spacingLeft}px`;

  useOutsideClickDetector(menuActionRef, () => setIsMenuActive(false));

  const customActionButton = (
    <div
      ref={menuActionRef}
      className={`flex h-full w-full cursor-pointer items-center rounded-sm p-1 text-placeholder hover:bg-layer-1 ${
        isMenuActive ? "bg-layer-1 text-primary" : "text-secondary"
      }`}
      onClick={() => setIsMenuActive(!isMenuActive)}
    >
      <MoreHorizontal className="h-3.5 w-3.5" />
    </div>
  );
  if (!issueDetail) return null;

  const handleToggleExpand = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (nestingLevel >= 3) {
      handleIssuePeekOverview(issueDetail);
    } else {
      setExpanded((prevState) => {
        if (!prevState && workspaceSlug && issueDetail && issueDetail.project_id)
          subIssuesStore.fetchSubIssues(workspaceSlug.toString(), issueDetail.project_id, issueDetail.id);
        return !prevState;
      });
    }
  };

  const disableUserActions = !canEditProperties(issueDetail.project_id ?? undefined);
  const subIssuesCount = issueDetail?.sub_issues_count ?? 0;
  const isIssueSelected = selectionHelpers.getIsEntitySelected(issueDetail.id);
  const projectIdentifier = getProjectIdentifierById(issueDetail.project_id);

  const canSelectIssues = !disableUserActions && !selectionHelpers.isSelectionDisabled;

  const workItemLink = generateWorkItemLink({
    workspaceSlug: workspaceSlug?.toString(),
    projectId: issueDetail?.project_id,
    issueId,
    projectIdentifier,
    sequenceId: issueDetail?.sequence_id,
    isEpic,
  });

  return (
    <>
      {/* Single sticky column containing both identifier and workitem */}
      <td
        id={`issue-${issueId}`}
        ref={cellRef}
        tabIndex={0}
        className="group/list-block relative left-0 z-10 max-w-lg bg-surface-1 md:sticky"
      >
        <ControlLink
          href={workItemLink}
          onClick={() => handleIssuePeekOverview(issueDetail)}
          className="outline-none"
          disabled={!!issueDetail?.tempId}
        >
          <Row
            className={cn(
              "group clickable z-10 flex h-11 w-full cursor-pointer items-center border-r-[0.5px] border-subtle-1 bg-transparent text-13 group-[.selected-issue-row]:bg-accent-primary/5 after:absolute group-[.selected-issue-row]:hover:bg-accent-primary/10",
              {
                "border-b-[0.5px]": !getIsIssuePeeked(issueDetail.id),
                "border border-accent-strong hover:border-accent-strong":
                  getIsIssuePeeked(issueDetail.id) && nestingLevel === peekIssue?.nestingLevel,
                "shadow-[8px_22px_22px_10px_rgba(0,0,0,0.05)]": isScrolled.current,
              }
            )}
          >
            {/* Identifier section - conditionally rendered */}
            {displayProperties?.key && (
              <div className="flex h-full min-w-24 flex-shrink-0 items-center">
                <div className="relative flex cursor-pointer items-center text-11 hover:text-primary">
                  {issueDetail.project_id && (
                    <IssueIdentifier
                      issueId={issueDetail.id}
                      projectId={issueDetail.project_id}
                      size="xs"
                      variant="tertiary"
                      displayProperties={displayProperties}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Workitem section */}
            <div
              className={cn("flex flex-grow items-center gap-0.5 py-2", {
                "min-w-[360px]": !displayProperties?.key,
                "min-w-60": displayProperties?.key,
              })}
            >
              {/* select checkbox */}
              {projectId && canSelectIssues && (
                <Tooltip
                  tooltipContent={
                    <>
                      Only work items within the current
                      <br />
                      project can be selected.
                    </>
                  }
                  disabled={issueDetail.project_id === projectId}
                >
                  <div className="absolute left-1 mr-1 grid w-3.5 flex-shrink-0 place-items-center">
                    <MultipleSelectEntityAction
                      className={cn(
                        "pointer-events-none opacity-0 transition-opacity group-hover/list-block:pointer-events-auto group-hover/list-block:opacity-100",
                        {
                          "pointer-events-auto opacity-100": isIssueSelected,
                        }
                      )}
                      groupId={SPREADSHEET_SELECT_GROUP}
                      id={issueDetail.id}
                      selectionHelpers={selectionHelpers}
                      disabled={issueDetail.project_id !== projectId}
                    />
                  </div>
                </Tooltip>
              )}

              {/* sub issues indentation */}
              {nestingLevel !== 0 && <div style={{ width: subIssueIndentation }} />}

              {/* sub-issues chevron */}
              <div className="grid size-4 place-items-center">
                {subIssuesCount > 0 && !isEpic && (
                  <button
                    type="button"
                    className="grid size-4 place-items-center rounded-xs text-placeholder hover:text-tertiary"
                    onClick={handleToggleExpand}
                  >
                    <ChevronRightIcon
                      className={cn("size-4", {
                        "rotate-90": isExpanded,
                      })}
                      strokeWidth={2.5}
                    />
                  </button>
                )}
              </div>

              <div className="my-auto flex h-full w-full items-center justify-between gap-2 truncate">
                <div className="line-clamp-1 w-full text-14 text-primary">
                  <div className="w-full overflow-hidden">
                    <Tooltip tooltipContent={issueDetail.name} isMobile={isMobile}>
                      <div
                        className="h-full w-full cursor-pointer truncate pr-4 text-left text-13 text-primary focus:outline-none"
                        tabIndex={-1}
                      >
                        {issueDetail.name}
                      </div>
                    </Tooltip>
                  </div>
                </div>
                <div
                  className={`opacity-0 transition-opacity group-hover:opacity-100 ${isMenuActive ? "!opacity-100" : ""}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {quickActions({
                    issue: issueDetail,
                    parentRef: cellRef,
                    customActionButton,
                    portalElement: portalElement.current,
                  })}
                </div>
              </div>
            </div>
          </Row>
        </ControlLink>
      </td>
      {/* Rest of the columns */}
      {spreadsheetColumnsList.map((property) => (
        <IssueColumn
          key={property}
          displayProperties={displayProperties}
          issueDetail={issueDetail}
          disableUserActions={disableUserActions}
          property={property}
          updateIssue={updateIssue}
          isEstimateEnabled={isEstimateEnabled}
        />
      ))}
    </>
  );
});
