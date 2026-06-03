/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Composition entry point for the issue-detail widget strip rendered on the issue
 * detail page; assembles the action-button row, the collapsible widget stack, and
 * the optional modal layer into a single feature surface.
 *
 * Rendered purpose:
 *   Render the trigger toolbar + collapsible content + (optionally) widget modals
 *   for a single work item, forwarding the same workspace/project/issue context to
 *   every child so they all act on the same issue instance and service variant.
 *
 * MobX stores read:
 *   None directly. State reads happen inside the child components via
 *   `useIssueDetail(issueServiceType)` (see `./issue-detail-widget-collapsibles`
 *   and `./issue-detail-widget-modals`).
 *
 * Side effects:
 *   None at this level. All mutations (link CRUD, sub-issue add, relation create,
 *   attachment upload) are performed inside the child components and helper hooks.
 *
 * Consumers: rendered on issue-detail surfaces — e.g.,
 * `apps/web/core/components/issues/issue-detail/main-content.tsx`, peek-overview body, and
 * the create/edit issue modal preview pane.
 */

import React from "react";
// plane imports
import type { TIssueServiceType, TWorkItemWidgets } from "@plane/types";
// local imports
import { IssueDetailWidgetActionButtons } from "./action-buttons";
import { IssueDetailWidgetCollapsibles } from "./issue-detail-widget-collapsibles";
import { IssueDetailWidgetModals } from "./issue-detail-widget-modals";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  renderWidgetModals?: boolean;
  issueServiceType: TIssueServiceType;
  hideWidgets?: TWorkItemWidgets[];
};

/**
 * Render the full issue-detail widget surface for a single work item.
 *
 * @param props.workspaceSlug - Workspace slug from the route; identifies the workspace owning the issue.
 * @param props.projectId - UUID of the project that owns the issue.
 * @param props.issueId - UUID of the work item whose widgets are being rendered.
 * @param props.disabled - When true, suppresses CRUD triggers (read-only mode for archived/non-editable issues).
 * @param props.renderWidgetModals - Optional; defaults to `true`. When false, the modal layer is not mounted (useful for embedded contexts that own their own modal stack).
 * @param props.issueServiceType - Discriminator for the issue service variant (`TIssueServiceType`); selects which store + service is consulted by the child components.
 * @param props.hideWidgets - Optional list of `TWorkItemWidgets` to suppress (e.g., to hide `"links"` or `"attachments"` in a constrained layout).
 */
export function IssueDetailWidgets(props: Props) {
  const {
    workspaceSlug,
    projectId,
    issueId,
    disabled,
    renderWidgetModals = true,
    issueServiceType,
    hideWidgets,
  } = props;

  return (
    <>
      <div className="flex flex-col space-y-4">
        <IssueDetailWidgetActionButtons
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
          hideWidgets={hideWidgets}
        />
        <IssueDetailWidgetCollapsibles
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
          hideWidgets={hideWidgets}
        />
      </div>
      {renderWidgetModals && (
        <IssueDetailWidgetModals
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          issueServiceType={issueServiceType}
          hideWidgets={hideWidgets}
        />
      )}
    </>
  );
}
