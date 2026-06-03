/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Per-date cell that registers as an Atlaskit pragmatic drag-and-drop drop
 * target, validates calendar drag-to-reschedule moves, and renders the day's
 * issue list (desktop) or a tappable mobile day picker.
 *
 * Props (Props type, L30):
 *   - date: ICalendarDate — date model with .date (Date) and .is_current_month.
 *   - issuesFilterStore — supplies displayFilters.calendar.layout
 *     ("month" | "week").
 *   - issues, groupedIssueIds — used to resolve dragged issue details and the
 *     day-grouped issue list.
 *   - quickActions, quickAddCallback, addIssuesToView, enableQuickIssueCreate,
 *     disableIssueCreation, readOnly, isEpic — forwarded to
 *     CalendarIssueBlocks.
 *   - handleDragAndDrop — calls back into BaseCalendarRoot when a drop is valid.
 *   - selectedDate, setSelectedDate — mobile selection state.
 *   - canEditProperties — per-issue edit gate.
 *
 * Stores read: none directly — issue data flows in via props.
 *
 * Side effects:
 *   - Registers dropTargetForElements from
 *     @atlaskit/pragmatic-drag-and-drop/element/adapter on dayTileRef.
 *   - On drop: blocks moves where target_date < start_date and emits an ERROR
 *     toast via @plane/propel/toast; otherwise forwards the move and clears
 *     the drag highlight via highlightIssueOnDrop (../utils).
 *
 * Consumers:
 *   - ./week-days.tsx (CalendarWeekDays).
 */

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { differenceInCalendarDays } from "date-fns/differenceInCalendarDays";
import { observer } from "mobx-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TGroupedIssues, TIssue, TIssueMap, TPaginationData, ICalendarDate } from "@plane/types";
// types
// ui
// components
import { cn, renderFormattedPayloadDate } from "@plane/utils";
import { highlightIssueOnDrop } from "@/components/issues/issue-layouts/utils";
// helpers
import { MONTHS_LIST } from "@/constants/calendar";
// helpers
// types
import type { ICycleIssuesFilter } from "@/store/issue/cycle";
import type { IModuleIssuesFilter } from "@/store/issue/module";
import type { IProjectIssuesFilter } from "@/store/issue/project";
import type { IProjectViewIssuesFilter } from "@/store/issue/project-views";
import type { TRenderQuickActions } from "../list/list-view-types";
import { CalendarIssueBlocks } from "./issue-blocks";

type Props = {
  issuesFilterStore: IProjectIssuesFilter | IModuleIssuesFilter | ICycleIssuesFilter | IProjectViewIssuesFilter;
  date: ICalendarDate;
  issues: TIssueMap | undefined;
  groupedIssueIds: TGroupedIssues;
  loadMoreIssues: (dateString: string) => void;
  getPaginationData: (groupId: string | undefined) => TPaginationData | undefined;
  getGroupIssueCount: (groupId: string | undefined) => number | undefined;
  enableQuickIssueCreate?: boolean;
  disableIssueCreation?: boolean;
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
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  canEditProperties: (projectId: string | undefined) => boolean;
  isEpic?: boolean;
};

/** Day cell: drop target with start_date validation, today/weekend highlights, and CalendarIssueBlocks body. */
export const CalendarDayTile = observer(function CalendarDayTile(props: Props) {
  const {
    issuesFilterStore,
    date,
    issues,
    groupedIssueIds,
    loadMoreIssues,
    getPaginationData,
    getGroupIssueCount,
    quickActions,
    enableQuickIssueCreate,
    disableIssueCreation,
    quickAddCallback,
    addIssuesToView,
    readOnly = false,
    selectedDate,
    handleDragAndDrop,
    setSelectedDate,
    canEditProperties,
    isEpic = false,
  } = props;

  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const calendarLayout = issuesFilterStore?.issueFilters?.displayFilters?.calendar?.layout ?? "month";

  const formattedDatePayload = renderFormattedPayloadDate(date.date);

  const dayTileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = dayTileRef.current;

    if (!element) return;

    return combine(
      dropTargetForElements({
        element,
        getData: () => ({ date: formattedDatePayload }),
        onDragEnter: () => {
          setIsDraggingOver(true);
        },
        onDragLeave: () => {
          setIsDraggingOver(false);
        },
        onDrop: ({ source, self }) => {
          setIsDraggingOver(false);
          const sourceData = source?.data as { id: string; date: string } | undefined;
          const destinationData = self?.data as { date: string } | undefined;
          if (!sourceData || !destinationData) return;

          const issueDetails = issues?.[sourceData?.id];
          // Drag-to-reschedule MUST NOT push due-date before start_date — reject the drop and surface a toast.
          if (issueDetails?.start_date) {
            const issueStartDate = new Date(issueDetails.start_date);
            const targetDate = new Date(destinationData?.date);
            const diffInDays = differenceInCalendarDays(targetDate, issueStartDate);
            if (diffInDays < 0) {
              setToast({
                type: TOAST_TYPE.ERROR,
                title: "Error!",
                message: "Due date cannot be before the start date of the work item.",
              });
              return;
            }
          }

          handleDragAndDrop(
            sourceData?.id,
            issueDetails?.project_id ?? undefined,
            sourceData?.date,
            destinationData?.date
          );
          highlightIssueOnDrop(source?.element?.id, false);
        },
      })
    );
  }, [dayTileRef?.current, formattedDatePayload]);

  if (!formattedDatePayload) return null;
  const issueIds = groupedIssueIds?.[formattedDatePayload];

  const isToday = date.date.toDateString() === new Date().toDateString();
  const isSelectedDate = date.date.toDateString() == selectedDate.toDateString();

  const isWeekend = [0, 6].includes(date.date.getDay());
  const isMonthLayout = calendarLayout === "month";

  const normalBackground = isWeekend ? "bg-layer-1" : "bg-layer-transparent";
  const draggingOverBackground = isWeekend ? "bg-layer-1" : "bg-layer-transparent-hover";

  return (
    <>
      <div ref={dayTileRef} className="group relative flex h-full w-full flex-col">
        {/* header */}
        <div
          className={`hidden flex-shrink-0 justify-end px-2 py-1.5 text-right text-11 md:flex ${
            isMonthLayout // if month layout, highlight current month days
              ? date.is_current_month
                ? "font-medium"
                : "text-tertiary"
              : "font-medium" // if week layout, highlight all days
          } ${isWeekend ? "bg-layer-1" : "bg-layer-transparent"} `}
        >
          {date.date.getDate() === 1 && MONTHS_LIST[date.date.getMonth() + 1].shortTitle + " "}
          {isToday ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-primary text-on-color">
              {date.date.getDate()}
            </span>
          ) : (
            <>{date.date.getDate()}</>
          )}
        </div>

        {/* content */}
        <div className="hidden h-full w-full md:block">
          <div
            className={cn(
              `h-full w-full select-none ${isDraggingOver ? `${draggingOverBackground} opacity-70` : normalBackground}`,
              {
                "min-h-[5rem]": isMonthLayout,
              }
            )}
          >
            <CalendarIssueBlocks
              date={date.date}
              issueIdList={issueIds}
              quickActions={quickActions}
              loadMoreIssues={loadMoreIssues}
              getPaginationData={getPaginationData}
              getGroupIssueCount={getGroupIssueCount}
              isDragDisabled={readOnly}
              addIssuesToView={addIssuesToView}
              disableIssueCreation={disableIssueCreation}
              enableQuickIssueCreate={enableQuickIssueCreate}
              quickAddCallback={quickAddCallback}
              readOnly={readOnly}
              canEditProperties={canEditProperties}
              isEpic={isEpic}
            />
          </div>
        </div>

        {/* Mobile view content */}
        <div
          onClick={() => setSelectedDate(date.date)}
          className={cn(
            "mx-auto flex h-full w-full cursor-pointer flex-col items-center justify-start py-2.5 text-13 font-medium opacity-80 md:hidden",
            {
              "bg-layer-2": !isWeekend,
            }
          )}
        >
          <div
            className={cn("flex size-6 items-center justify-center rounded-full", {
              "bg-accent-primary text-on-color": isSelectedDate,
              "bg-accent-primary/10 text-accent-primary": isToday && !isSelectedDate,
            })}
          >
            {date.date.getDate()}
          </div>
        </div>
      </div>
    </>
  );
});
