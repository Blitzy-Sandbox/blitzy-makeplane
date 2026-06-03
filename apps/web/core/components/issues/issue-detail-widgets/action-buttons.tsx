/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Toolbar of widget trigger buttons rendered above the collapsible widget stack
 * on the issue detail page. Each button delegates its open-modal / open-popover
 * behavior to a specialized child action component which reads the corresponding
 * issue-detail MobX store slice.
 *
 * Rendered purpose:
 *   Render the horizontal row of "Add sub-work-item", "Add relation", "Add link",
 *   "Attach" buttons plus the plane-web `WorkItemAdditionalWidgetActionButtons`
 *   extension row. Each trigger is suppressed if its key appears in `hideWidgets`.
 *
 * MobX stores read:
 *   None directly. Children (`SubIssuesActionButton`, `RelationActionButton`,
 *   `IssueLinksActionButton`, `IssueAttachmentActionButton`) each consume the
 *   appropriate slice of the issue-detail store via `useIssueDetail`.
 *
 * Side effects:
 *   None at this level. The shared `IssueDetailWidgetButton` is passed as
 *   `customButton` to each child; the child wires the click handler to a store
 *   toggle action (e.g. `toggleIssueLinkModal`, `toggleSubIssuesModal`).
 *
 * Translation keys consumed (via `@plane/i18n` `useTranslation()`):
 *   - `issue.add.sub_issue`
 *   - `issue.add.relation`
 *   - `issue.add.link`
 *   - `common.attach`
 *
 * Consumers: rendered by `./root.tsx` (`IssueDetailWidgets`) above the collapsible widget stack on
 * the issue detail page (see `apps/web/core/components/issues/issue-detail/main-content.tsx`).
 */

import React from "react";
import { Paperclip } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { LinkIcon, ViewsIcon, RelationPropertyIcon } from "@plane/propel/icons";
// plane imports
import type { TIssueServiceType, TWorkItemWidgets } from "@plane/types";
// plane web imports
import { WorkItemAdditionalWidgetActionButtons } from "@/plane-web/components/issues/issue-detail-widgets/action-buttons";
// local imports
import { IssueAttachmentActionButton } from "./attachments";
import { IssueLinksActionButton } from "./links";
import { RelationActionButton } from "./relations";
import { SubIssuesActionButton } from "./sub-issues";
import { IssueDetailWidgetButton } from "./widget-button";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  issueServiceType: TIssueServiceType;
  hideWidgets?: TWorkItemWidgets[];
};

/**
 * Render the widget trigger toolbar for an issue. Each visible trigger forwards
 * issue context to its specialized action child, which owns the modal/popover
 * open lifecycle for that widget kind.
 *
 * @param props.workspaceSlug - Workspace slug from the route.
 * @param props.projectId - UUID of the project that owns the issue.
 * @param props.issueId - UUID of the work item whose widgets are being triggered.
 * @param props.disabled - When true, every trigger renders in disabled state (interactions are blocked).
 * @param props.issueServiceType - Discriminator for the issue service variant; each child passes this through to its store accessor.
 * @param props.hideWidgets - Optional list of widget keys (`"sub-work-items" | "relations" | "links" | "attachments"`); when a key is present the matching trigger is not rendered.
 */
export function IssueDetailWidgetActionButtons(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled, issueServiceType, hideWidgets } = props;
  // translation
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hideWidgets?.includes("sub-work-items") && (
        <SubIssuesActionButton
          issueId={issueId}
          customButton={
            <IssueDetailWidgetButton
              title={t("issue.add.sub_issue")}
              icon={<ViewsIcon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />}
              disabled={disabled}
            />
          }
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      {!hideWidgets?.includes("relations") && (
        <RelationActionButton
          issueId={issueId}
          customButton={
            <IssueDetailWidgetButton
              title={t("issue.add.relation")}
              icon={<RelationPropertyIcon className="h-3.5 w-3.5 flex-shrink-0" />}
              disabled={disabled}
            />
          }
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      {!hideWidgets?.includes("links") && (
        <IssueLinksActionButton
          customButton={
            <IssueDetailWidgetButton
              title={t("issue.add.link")}
              icon={<LinkIcon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />}
              disabled={disabled}
            />
          }
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      {!hideWidgets?.includes("attachments") && (
        <IssueAttachmentActionButton
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          customButton={
            <IssueDetailWidgetButton
              title={t("common.attach")}
              icon={<Paperclip className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />}
              disabled={disabled}
            />
          }
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      <WorkItemAdditionalWidgetActionButtons
        disabled={disabled}
        hideWidgets={hideWidgets ?? []}
        issueServiceType={issueServiceType}
        projectId={projectId}
        workItemId={issueId}
        workspaceSlug={workspaceSlug}
      />
    </div>
  );
}
