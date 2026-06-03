/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Render-gate higher-order wrapper for issue layout pages.
 *
 * Rendered purpose: decides whether the wrapped layout content renders, a layout-specific loader
 * appears, or an empty-state surface is shown — based on the active issue store's loader state
 * and total issue count.
 *
 * Props (Props):
 *   - children (string | React.ReactNode | React.ReactNode[], required): the layout body to render once
 *     issues are loaded and present
 *   - layout (EIssueLayoutTypes, required): which layout-specific skeleton loader to show during initial loads
 *     (list, kanban, spreadsheet, calendar, or gantt)
 *
 * MobX stores read:
 *   - `useIssueStoreType()` resolves the current `EIssuesStoreType` from React context (route-aware)
 *   - `useIssues(storeType)` exposes the `issues` slice of the active issues store, used for:
 *       - `issues.getIssueLoader()` — current loader state ("init-loader" gates the skeleton render)
 *       - `issues.getGroupIssueCount(undefined, undefined, false)` — total issue count across all groups
 *
 * Side effects: none — pure render orchestration.
 *
 * Conditional rendering logic (the WHY for the three branches):
 *   - When the store is in `"init-loader"` OR the count has not yet resolved (`undefined`), show the
 *     skeleton loader matching the requested layout.
 *   - When the count is exactly zero AND the layout is NOT CALENDAR, show the empty-state surface.
 *     Calendar is intentionally skipped because the calendar layout always renders its date grid even
 *     with zero issues (the calendar's own empty-day cells are the appropriate visual).
 *   - Otherwise, render the wrapped `children`.
 */

import { observer } from "mobx-react";
// plane imports
import { EIssueLayoutTypes } from "@plane/types";
// components
import { CalendarLayoutLoader } from "@/components/ui/loader/layouts/calendar-layout-loader";
import { GanttLayoutLoader } from "@/components/ui/loader/layouts/gantt-layout-loader";
import { KanbanLayoutLoader } from "@/components/ui/loader/layouts/kanban-layout-loader";
import { ListLayoutLoader } from "@/components/ui/loader/layouts/list-layout-loader";
import { SpreadsheetLayoutLoader } from "@/components/ui/loader/layouts/spreadsheet-layout-loader";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
// local imports
import { IssueLayoutEmptyState } from "./empty-states";

/**
 * Dispatches the layout-specific skeleton loader.
 *
 * @param props.layout - one of `EIssueLayoutTypes`; unknown values render `null`
 */
function ActiveLoader(props: { layout: EIssueLayoutTypes }) {
  const { layout } = props;
  switch (layout) {
    case EIssueLayoutTypes.LIST:
      return <ListLayoutLoader />;
    case EIssueLayoutTypes.KANBAN:
      return <KanbanLayoutLoader />;
    case EIssueLayoutTypes.SPREADSHEET:
      return <SpreadsheetLayoutLoader />;
    case EIssueLayoutTypes.CALENDAR:
      return <CalendarLayoutLoader />;
    case EIssueLayoutTypes.GANTT:
      return <GanttLayoutLoader />;
    default:
      return null;
  }
}

/** Props for `IssueLayoutHOC`. */
interface Props {
  children: string | React.ReactNode | React.ReactNode[];
  layout: EIssueLayoutTypes;
}

/** Render-gate wrapper for issue layout pages; see the module-level JSDoc for full semantics. */
export const IssueLayoutHOC = observer(function IssueLayoutHOC(props: Props) {
  const { layout } = props;

  const storeType = useIssueStoreType();
  const { issues } = useIssues(storeType);

  const issueCount = issues.getGroupIssueCount(undefined, undefined, false);

  if (issues?.getIssueLoader() === "init-loader" || issueCount === undefined) {
    return <ActiveLoader layout={layout} />;
  }

  if (issues.getGroupIssueCount(undefined, undefined, false) === 0 && layout !== EIssueLayoutTypes.CALENDAR) {
    return <IssueLayoutEmptyState storeType={storeType} />;
  }

  return <>{props.children}</>;
});
