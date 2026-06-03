/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top-level compositor for the issue calendar layout. Assembles the header,
 * weekday strip, month/week body, mobile day surface, and registers
 * Atlaskit pragmatic auto-scroll-for-drag on the scrollable container.
 *
 * Props (Props type, line 46):
 *   - issuesFilterStore: filter store for the active route
 *     (project | module | cycle | project view).
 *   - issues, groupedIssueIds, layout ("month" | "week" | undefined),
 *     showWeekends, issueCalendarView.
 *   - loadMoreIssues, getPaginationData, getGroupIssueCount — pagination plumbing.
 *   - quickActions (render-prop), quickAddCallback, addIssuesToView.
 *   - handleDragAndDrop — drag-to-reschedule persistence callback.
 *   - readOnly, updateFilters, canEditProperties, isEpic.
 *
 * Stores read:
 *   - useIssues(EIssuesStoreType.PROJECT).issues.viewFlags — enableIssueCreation
 *     and enableQuickAdd flags (intentionally fixed to PROJECT viewFlags
 *     regardless of caller, since calendar layout always uses the project-level
 *     project-wide capability flags).
 *
 * Side effects:
 *   - Registers @atlaskit/pragmatic-drag-and-drop autoScrollForElements on
 *     the scrollable container while drag is in progress.
 *   - Wraps content in IssueLayoutHOC; the HOC intentionally does NOT short-circuit
 *     to IssueLayoutEmptyState for the CALENDAR layout (see ../issue-layout-HOC.tsx
 *     L57-L59) — the date grid IS the empty visual.
 *
 * Consumers:
 *   - ./base-calendar-root.tsx (BaseCalendarRoot).
 */

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { observer } from "mobx-react";
// plane constants
import type { TSupportedFilterTypeForUpdate } from "@plane/constants";
// types
import type {
  TGroupedIssues,
  TIssue,
  TIssueMap,
  TPaginationData,
  ICalendarWeek,
  TSupportedFilterForUpdate,
} from "@plane/types";
import { EIssuesStoreType, EIssueLayoutTypes } from "@plane/types";
// ui
import { Spinner } from "@plane/ui";
import { renderFormattedPayloadDate, cn } from "@plane/utils";
// constants
import { MONTHS_LIST } from "@/constants/calendar";
// helpers
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import useSize from "@/hooks/use-window-size";
// store
import type { ICycleIssuesFilter } from "@/store/issue/cycle";
import type { ICalendarStore } from "@/store/issue/issue_calendar_view.store";
import type { IModuleIssuesFilter } from "@/store/issue/module";
import type { IProjectIssuesFilter } from "@/store/issue/project";
import type { IProjectViewIssuesFilter } from "@/store/issue/project-views";
// local imports
import { IssueLayoutHOC } from "../issue-layout-HOC";
import type { TRenderQuickActions } from "../list/list-view-types";
import { CalendarHeader } from "./header";
import { CalendarIssueBlocks } from "./issue-blocks";
import { CalendarWeekDays } from "./week-days";
import { CalendarWeekHeader } from "./week-header";

type Props = {
  issuesFilterStore: IProjectIssuesFilter | IModuleIssuesFilter | ICycleIssuesFilter | IProjectViewIssuesFilter;
  issues: TIssueMap | undefined;
  groupedIssueIds: TGroupedIssues;
  layout: "month" | "week" | undefined;
  showWeekends: boolean;
  issueCalendarView: ICalendarStore;
  loadMoreIssues: (dateString: string) => void;
  getPaginationData: (groupId: string | undefined) => TPaginationData | undefined;
  getGroupIssueCount: (groupId: string | undefined) => number | undefined;
  quickAddCallback?: (projectId: string | null | undefined, data: TIssue) => Promise<TIssue | undefined>;
  quickActions: TRenderQuickActions;
  handleDragAndDrop: (
    issueId: string | undefined,
    issueProjectId: string | undefined,
    sourceDate: string | undefined,
    destinationDate: string | undefined
  ) => Promise<void>;
  addIssuesToView?: (issueIds: string[]) => Promise<any>;
  readOnly?: boolean;
  updateFilters?: (
    projectId: string,
    filterType: TSupportedFilterTypeForUpdate,
    filters: TSupportedFilterForUpdate
  ) => Promise<void>;
  canEditProperties: (projectId: string | undefined) => boolean;
  isEpic?: boolean;
};

/** Renders the month/week issue calendar shell, including mobile day surface and drag auto-scroll. */
export const CalendarChart = observer(function CalendarChart(props: Props) {
  const {
    issuesFilterStore,
    issues,
    groupedIssueIds,
    layout,
    showWeekends,
    issueCalendarView,
    loadMoreIssues,
    handleDragAndDrop,
    quickActions,
    quickAddCallback,
    addIssuesToView,
    getPaginationData,
    getGroupIssueCount,
    updateFilters,
    canEditProperties,
    readOnly = false,
    isEpic = false,
  } = props;
  // states
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  //refs
  const scrollableContainerRef = useRef<HTMLDivElement | null>(null);
  // store hooks
  const {
    issues: { viewFlags },
  } = useIssues(EIssuesStoreType.PROJECT);

  const [windowWidth] = useSize();

  const { enableIssueCreation, enableQuickAdd } = viewFlags || {};

  const calendarPayload = issueCalendarView.calendarPayload;

  const allWeeksOfActiveMonth = issueCalendarView.allWeeksOfActiveMonth;

  const formattedDatePayload = renderFormattedPayloadDate(selectedDate) ?? undefined;

  // Enable Auto Scroll for calendar
  useEffect(() => {
    const element = scrollableContainerRef.current;

    if (!element) return;

    return combine(
      autoScrollForElements({
        element,
      })
    );
  }, [scrollableContainerRef?.current]);

  if (!calendarPayload || !formattedDatePayload)
    return (
      <div className="grid h-full w-full place-items-center">
        <Spinner />
      </div>
    );

  const issueIdList = groupedIssueIds ? groupedIssueIds[formattedDatePayload] : [];

  return (
    <>
      <div className="flex h-full w-full flex-col overflow-hidden">
        <CalendarHeader
          setSelectedDate={setSelectedDate}
          issuesFilterStore={issuesFilterStore}
          updateFilters={updateFilters}
        />

        <IssueLayoutHOC layout={EIssueLayoutTypes.CALENDAR}>
          <div
            className={cn("flex w-full flex-col overflow-y-auto md:h-full", {
              "vertical-scrollbar scrollbar-lg": windowWidth > 768,
            })}
            ref={scrollableContainerRef}
          >
            <CalendarWeekHeader isLoading={!issues} showWeekends={showWeekends} />
            <div className="h-full w-full">
              {layout === "month" && (
                <div className="grid h-full w-full grid-cols-1 divide-y-[0.5px] divide-subtle-1">
                  {allWeeksOfActiveMonth &&
                    Object.values(allWeeksOfActiveMonth).map((week: ICalendarWeek, weekIndex) => (
                      <CalendarWeekDays
                        selectedDate={selectedDate}
                        setSelectedDate={setSelectedDate}
                        handleDragAndDrop={handleDragAndDrop}
                        issuesFilterStore={issuesFilterStore}
                        key={weekIndex}
                        week={week}
                        issues={issues}
                        groupedIssueIds={groupedIssueIds}
                        loadMoreIssues={loadMoreIssues}
                        getPaginationData={getPaginationData}
                        getGroupIssueCount={getGroupIssueCount}
                        enableQuickIssueCreate={enableQuickAdd}
                        disableIssueCreation={!enableIssueCreation}
                        quickActions={quickActions}
                        quickAddCallback={quickAddCallback}
                        addIssuesToView={addIssuesToView}
                        readOnly={readOnly}
                        canEditProperties={canEditProperties}
                        isEpic={isEpic}
                      />
                    ))}
                </div>
              )}
              {layout === "week" && (
                <CalendarWeekDays
                  selectedDate={selectedDate}
                  setSelectedDate={setSelectedDate}
                  handleDragAndDrop={handleDragAndDrop}
                  issuesFilterStore={issuesFilterStore}
                  week={issueCalendarView.allDaysOfActiveWeek}
                  issues={issues}
                  groupedIssueIds={groupedIssueIds}
                  loadMoreIssues={loadMoreIssues}
                  getPaginationData={getPaginationData}
                  getGroupIssueCount={getGroupIssueCount}
                  enableQuickIssueCreate={enableQuickAdd}
                  disableIssueCreation={!enableIssueCreation}
                  quickActions={quickActions}
                  quickAddCallback={quickAddCallback}
                  addIssuesToView={addIssuesToView}
                  readOnly={readOnly}
                  canEditProperties={canEditProperties}
                  isEpic={isEpic}
                />
              )}
            </div>

            {/* mobile view */}
            <div className="md:hidden">
              <p className="p-4 text-18 font-semibold">
                {`${selectedDate.getDate()} ${
                  MONTHS_LIST[selectedDate.getMonth() + 1].title
                }, ${selectedDate.getFullYear()}`}
              </p>
              <CalendarIssueBlocks
                date={selectedDate}
                issueIdList={issueIdList}
                loadMoreIssues={loadMoreIssues}
                getPaginationData={getPaginationData}
                getGroupIssueCount={getGroupIssueCount}
                quickActions={quickActions}
                enableQuickIssueCreate={enableQuickAdd}
                disableIssueCreation={!enableIssueCreation}
                quickAddCallback={quickAddCallback}
                addIssuesToView={addIssuesToView}
                readOnly={readOnly}
                canEditProperties={canEditProperties}
                isDragDisabled
                isMobileView
                isEpic={isEpic}
              />
            </div>
          </div>
        </IssueLayoutHOC>

        {/* mobile view */}
        <div className="md:hidden">
          <p className="p-4 text-18 font-semibold">
            {`${selectedDate.getDate()} ${
              MONTHS_LIST[selectedDate.getMonth() + 1].title
            }, ${selectedDate.getFullYear()}`}
          </p>
          <CalendarIssueBlocks
            date={selectedDate}
            issueIdList={issueIdList}
            quickActions={quickActions}
            loadMoreIssues={loadMoreIssues}
            getPaginationData={getPaginationData}
            getGroupIssueCount={getGroupIssueCount}
            enableQuickIssueCreate={enableQuickAdd}
            disableIssueCreation={!enableIssueCreation}
            quickAddCallback={quickAddCallback}
            addIssuesToView={addIssuesToView}
            readOnly={readOnly}
            canEditProperties={canEditProperties}
            isDragDisabled
            isMobileView
            isEpic={isEpic}
          />
        </div>
      </div>
    </>
  );
});
