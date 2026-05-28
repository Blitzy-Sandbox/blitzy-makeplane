/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `SubIssuesCollapsibleTitle` — the header row of the sub-issues collapsible; renders a localized label (sub-work-items vs. issue based on
 * `issueServiceType`), a circular progress indicator computed from completed-state distribution, and the embedded `SubWorkItemTitleActions`
 * strip. Returns `null` when the parent issue has no sub-work-items so the entire header is hidden in that case.
 *
 * Props (Props):
 *   - isOpen (boolean, required): Collapsible open state; forwarded to `CollapsibleButton` so the chevron orientation reflects the parent state.
 *   - parentIssueId (string, required): Issue id whose sub-work-items drive title/progress; passed to title actions for filter scoping.
 *   - disabled (boolean, required): When true, suppresses the quick-action button inside `SubWorkItemTitleActions`.
 *   - issueServiceType (TIssueServiceType, optional, default `EIssueServiceType.ISSUES`): Selects translation label and issue-detail store slice.
 *   - projectId (string, required): Active project id; passed to title actions for project-state and member lookups.
 *   - workspaceSlug (string, required): Active workspace slug; currently unused at render time but retained on `Props` for symmetry with the rest of the widget.
 *
 * MobX stores read (via `useIssueDetail(issueServiceType)`):
 *   - `subIssues.subIssuesByIssueId(parentIssueId)`: selector — returns the sub-work-item id list for `parentIssueId`; absence triggers the early `null` return.
 *   - `subIssues.stateDistributionByIssueId(parentIssueId)`: selector — returns counts by state group, used to compute `completedCount` and the progress percentage.
 *
 * Side effects:
 *   - Pure renderer; no service calls, no toasts, no navigation. Progress percentage is a derived value (no `useMemo`; recomputed on each render but the inputs are MobX observables, so re-renders only fire on store mutation).
 *   - Pulls the title string from `@plane/i18n` so the label adapts to locale: `t("issue.label", { count: 1 })` for epics, `t("common.sub_work_items")` otherwise.
 *
 * Consumers: passed as the `title` slot of the `Collapsible` rendered by `./root.tsx`
 * (`SubIssuesCollapsible`) inside the issue-detail widget shell.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
import { CircularProgressIndicator, CollapsibleButton } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { SubWorkItemTitleActions } from "./title-actions";

type Props = {
  isOpen: boolean;
  parentIssueId: string;
  disabled: boolean;
  issueServiceType?: TIssueServiceType;
  projectId: string;
  workspaceSlug: string;
};

export const SubIssuesCollapsibleTitle = observer(function SubIssuesCollapsibleTitle(props: Props) {
  const { isOpen, parentIssueId, disabled, issueServiceType = EIssueServiceType.ISSUES, projectId } = props;
  // translation
  const { t } = useTranslation();
  // store hooks
  const {
    subIssues: { subIssuesByIssueId, stateDistributionByIssueId },
  } = useIssueDetail(issueServiceType);
  // derived values
  const subIssuesDistribution = stateDistributionByIssueId(parentIssueId);
  const subIssues = subIssuesByIssueId(parentIssueId);
  // if there are no sub-issues, return null
  if (!subIssues) return null;

  // calculate percentage of completed sub-issues
  const completedCount = subIssuesDistribution?.completed?.length ?? 0;
  const totalCount = subIssues.length;
  const percentage = completedCount && totalCount ? (completedCount / totalCount) * 100 : 0;

  return (
    <CollapsibleButton
      isOpen={isOpen}
      title={`${issueServiceType === EIssueServiceType.EPICS ? t("issue.label", { count: 1 }) : t("common.sub_work_items")}`}
      indicatorElement={
        <div className="flex items-center gap-1.5 text-13 text-tertiary">
          <CircularProgressIndicator size={18} percentage={percentage} strokeWidth={3} />
          <span>
            {completedCount}/{totalCount} {t("common.done")}
          </span>
        </div>
      }
      actionItemElement={
        <SubWorkItemTitleActions
          projectId={projectId}
          parentId={parentIssueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      }
    />
  );
});
