/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Hybrid display + navigation spreadsheet cell for the `sub_issue_count` property.
 *
 * Rendered purpose: renders one of three things depending on the issue's nature:
 *   1. For epics (`issue.is_epic === true`), renders `<IssueStats>` (an epic-specific analytics
 *      summary surface from the plane-web extension package) instead of a count.
 *   2. For non-epic issues with one or more sub-work-items, renders the label
 *      `<n> sub-work item(s)` inside a clickable `<Row>` that navigates to the issue detail page
 *      anchored at `#sub-issues` (deep-link to the sub-issues tab).
 *   3. For non-epic issues with zero sub-work-items, renders `0 sub-work items` in a non-clickable
 *      `<Row>` (no navigation, no hover affordance because `cursor-pointer` is conditional on
 *      `subIssueCount > 0`).
 *
 * Mounted only when `WithDisplayPropertiesHOC` approves the `sub_issue_count` property.
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; reads `is_epic`,
 *     `sub_issues_count`, `project_id`, `archived_at`, `id`
 *
 * MobX stores read:
 *   - `useAppRouter()` exposes the workspace-aware navigation helper (a Next.js-compatible router
 *     wrapper). The actual route push is workspace-aware via the wrapping `useParams()` call below.
 *   - `useParams()` (from `next/navigation`) reads the route's `workspaceSlug`
 *
 * Side effects (navigation):
 *   - When `subIssueCount > 0` AND the user clicks the row, `redirectToIssueDetail()` calls
 *     `router.push(`/${workspaceSlug}/projects/${issue.project_id}/${archived_at ? "archives/" : ""}${isEpic ? "epics" : "issues"}/${issue.id}#sub-issues`)`.
 *     This workspace-aware URL construction switches between four URL shapes depending on the
 *     archived/epic combinations and anchors the page at the `#sub-issues` tab on load.
 *   - When `subIssueCount === 0`, the `onClick` is the no-op `() => {}` (the cell is not
 *     clickable in this state).
 *
 * Derived state / conditional rendering (the WHY for the three-branch render):
 *   - The three-branch render (epic stats / clickable count / non-clickable zero) is the central
 *     non-obvious behaviour. Epics have their own analytics summary surface that supersedes the
 *     sub-issue count; non-epic issues with sub-issues get a navigation affordance because the
 *     `#sub-issues` deep-link is a useful shortcut; non-epic issues with no sub-issues get no
 *     affordance because there is nothing to navigate to.
 *   - `label` uses inline pluralisation (`subIssueCount !== 1 ? "s" : ""`); per the AAP system
 *     boundary "no refactoring", this is preserved as-is even though i18n would be the long-term
 *     improvement.
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `sub_issue_count` property is enabled.
 */
import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// types
import type { TIssue } from "@plane/types";
// helpers
import { Row } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
import { IssueStats } from "@/plane-web/components/issues/issue-layouts/issue-stats";

/** Props for `SpreadsheetSubIssueColumn`. */
type Props = {
  issue: TIssue;
};

/** Hybrid sub-issue count / epic stats / navigation cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetSubIssueColumn = observer(function SpreadsheetSubIssueColumn(props: Props) {
  const { issue } = props;
  // router
  const router = useAppRouter();
  // hooks
  const { workspaceSlug } = useParams();
  // derived values
  const isEpic = issue?.is_epic;
  const subIssueCount = issue?.sub_issues_count ?? 0;

  const redirectToIssueDetail = () => {
    router.push(
      `/${workspaceSlug?.toString()}/projects/${issue.project_id}/${issue.archived_at ? "archives/" : ""}${isEpic ? "epics" : "issues"}/${issue.id}#sub-issues`
    );
  };

  const label = `${subIssueCount} sub-work item${subIssueCount !== 1 ? "s" : ""}`;

  return (
    <Row
      onClick={subIssueCount ? redirectToIssueDetail : () => {}}
      className={cn(
        "flex h-11 w-full items-center border-b-[0.5px] border-subtle py-1 text-11 group-[.selected-issue-row]:bg-accent-primary/5 hover:bg-surface-2 group-[.selected-issue-row]:hover:bg-accent-primary",
        {
          "cursor-pointer": subIssueCount,
        }
      )}
    >
      {isEpic ? <IssueStats issueId={issue.id} /> : label}
    </Row>
  );
});
