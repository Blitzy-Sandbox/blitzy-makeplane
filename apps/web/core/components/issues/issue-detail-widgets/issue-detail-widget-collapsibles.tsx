/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Collapsible content column for the issue-detail widgets feature. Reads issue,
 * sub-issue, attachment, and relation state from the issue-detail MobX store and
 * conditionally renders the corresponding collapsible sections only when each has
 * content to display.
 *
 * Rendered purpose:
 *   Render the stack of collapsible widget sections (sub-issues, relations, links,
 *   attachments) under the action-button toolbar on the issue detail page. Each
 *   section is suppressed when its count is zero (so empty widgets are not shown)
 *   or when the widget key is listed in `hideWidgets` by the parent caller.
 *
 * MobX stores read (via `useIssueDetail(issueServiceType)`):
 *   - `issue.getIssueById(issueId)` — read full issue payload to inspect `link_count`.
 *   - `subIssues.subIssuesByIssueId(issueId)` — list of sub-issue ids attached to the issue.
 *   - `attachment.getAttachmentsCountByIssueId(issueId)` — count of persisted attachments.
 *   - `attachment.getAttachmentsUploadStatusByIssueId(issueId)` — in-flight upload entries (drives "renders during upload" behavior).
 *   - `relation.getRelationCountByIssueId(issueId, ISSUE_RELATION_OPTIONS)` — count of issue relations across the configured relation types.
 *
 * Side effects:
 *   None. This component is read-only at this level. Mutations occur inside the
 *   child collapsible components (`./attachments`, `./links`, `./relations`,
 *   `./sub-issues`) via their own service-layer helpers and MobX actions.
 *
 * Render conditions:
 *   - `shouldRenderSubIssues`   — `subIssues.length > 0 && !hideWidgets?.includes("sub-work-items")`.
 *   - `shouldRenderRelations`   — `issueRelationsCount > 0 && !hideWidgets?.includes("relations")`.
 *   - `shouldRenderLinks`       — `issue.link_count > 0 && !hideWidgets?.includes("links")`.
 *   - `shouldRenderAttachments` — `attachmentsCount > 0 || (attachmentUploads.length > 0 && !hideWidgets?.includes("attachments"))`.
 *
 * Consumers: rendered by `./root.tsx` (`IssueDetailWidgets`) on issue-detail surfaces — e.g.,
 * `apps/web/core/components/issues/issue-detail/main-content.tsx` and peek-overview body.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import type { TIssueServiceType, TWorkItemWidgets } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// Plane-web
import { WorkItemAdditionalWidgetCollapsibles } from "@/plane-web/components/issues/issue-detail-widgets/collapsibles";
import { useTimeLineRelationOptions } from "@/plane-web/components/relations";
// local imports
import { AttachmentsCollapsible } from "./attachments";
import { LinksCollapsible } from "./links";
import { RelationsCollapsible } from "./relations";
import { SubIssuesCollapsible } from "./sub-issues";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  issueServiceType: TIssueServiceType;
  hideWidgets?: TWorkItemWidgets[];
};

/**
 * MobX `observer` component rendering the collapsible widget stack on the issue
 * detail page; sections are conditionally mounted based on store-derived counts
 * and the `hideWidgets` allow-list.
 *
 * @param props.workspaceSlug - Workspace slug from the route.
 * @param props.projectId - UUID of the project that owns the issue.
 * @param props.issueId - UUID of the work item whose widgets are being rendered.
 * @param props.disabled - When true, child sections render in read-only mode (CRUD UI suppressed).
 * @param props.issueServiceType - Discriminator for the issue service variant; selects which issue-detail store is consulted.
 * @param props.hideWidgets - Optional list of widgets to suppress; a key here forces the corresponding section to render-skip even if it has content.
 */
export const IssueDetailWidgetCollapsibles = observer(function IssueDetailWidgetCollapsibles(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled, issueServiceType, hideWidgets } = props;
  // store hooks
  const {
    issue: { getIssueById },
    subIssues: { subIssuesByIssueId },
    attachment: { getAttachmentsCountByIssueId, getAttachmentsUploadStatusByIssueId },
    relation: { getRelationCountByIssueId },
  } = useIssueDetail(issueServiceType);
  // derived values
  const issue = getIssueById(issueId);
  const subIssues = subIssuesByIssueId(issueId);
  const ISSUE_RELATION_OPTIONS = useTimeLineRelationOptions();
  const issueRelationsCount = getRelationCountByIssueId(issueId, ISSUE_RELATION_OPTIONS);
  // render conditions
  const shouldRenderSubIssues = !!subIssues && subIssues.length > 0 && !hideWidgets?.includes("sub-work-items");
  const shouldRenderRelations = issueRelationsCount > 0 && !hideWidgets?.includes("relations");
  const shouldRenderLinks = !!issue?.link_count && issue?.link_count > 0 && !hideWidgets?.includes("links");
  const attachmentUploads = getAttachmentsUploadStatusByIssueId(issueId);
  const attachmentsCount = getAttachmentsCountByIssueId(issueId);
  // Attachments stay visible while any upload is in-flight even with zero persisted
  // attachments so users can observe upload progress without the section disappearing.
  const shouldRenderAttachments =
    attachmentsCount > 0 ||
    (!!attachmentUploads && attachmentUploads.length > 0 && !hideWidgets?.includes("attachments"));

  return (
    <div className="flex flex-col">
      {shouldRenderSubIssues && (
        <SubIssuesCollapsible
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      {shouldRenderRelations && (
        <RelationsCollapsible
          workspaceSlug={workspaceSlug}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      {shouldRenderLinks && (
        <LinksCollapsible
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      {shouldRenderAttachments && (
        <AttachmentsCollapsible
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      <WorkItemAdditionalWidgetCollapsibles
        disabled={disabled}
        hideWidgets={hideWidgets ?? []}
        issueServiceType={issueServiceType}
        projectId={projectId}
        workItemId={issueId}
        workspaceSlug={workspaceSlug}
      />
    </div>
  );
});
