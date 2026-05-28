/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `SubIssuesCollapsible` — outer collapsible container for the sub-work-items section of an issue detail page; persists open/close state in the
 * `issue-detail` MobX store under the widget key `"sub-work-items"` and renders the title row and content body as the collapsible's title and body slots.
 *
 * Props (Props):
 *   - workspaceSlug (string, required): Active workspace slug used for nested data fetches in the content body.
 *   - projectId (string, required): Active project id forwarded to title actions and content list.
 *   - issueId (string, required): Parent issue id whose sub-work-items are rendered; used as the `parentIssueId` for the title and content.
 *   - disabled (boolean, optional, default `false`): When true, suppresses quick-action and edit affordances in the title and child rows.
 *   - issueServiceType (TIssueServiceType, required): Selects which `issue-detail` store slice to read (e.g. `ISSUES` vs `EPICS`).
 *
 * MobX stores read (via `useIssueDetail(issueServiceType)`):
 *   - `openWidgets`: string[] — set of currently open detail-widget keys; membership of `"sub-work-items"` drives the collapsible's open state.
 *   - `toggleOpenWidget(widgetKey)`: action — invoked on chevron click to flip persistence of the widget key in `openWidgets`.
 *
 * Side effects:
 *   - Pure renderer at this level; no service calls, no toasts, no navigation.
 *   - Open/close interaction mutates the shared `issue-detail` store (`toggleOpenWidget`), persisting expansion state across re-mounts within the same issue session.
 *
 * Consumers: rendered by `../root.tsx` (`IssueDetailWidgetCollapsibles`) alongside
 * the relations, links, and attachments collapsibles inside the issue-detail widget
 * shell mounted by `issue-detail/main-content.tsx` and the peek-overview body.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import type { TIssueServiceType } from "@plane/types";
import { Collapsible } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// local imports
import { SubIssuesCollapsibleContent } from "./content";
import { SubIssuesCollapsibleTitle } from "./title";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
};

export const SubIssuesCollapsible = observer(function SubIssuesCollapsible(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled = false, issueServiceType } = props;
  // store hooks
  const { openWidgets, toggleOpenWidget } = useIssueDetail(issueServiceType);
  // derived values
  const isCollapsibleOpen = openWidgets.includes("sub-work-items");

  return (
    <Collapsible
      isOpen={isCollapsibleOpen}
      onToggle={() => toggleOpenWidget("sub-work-items")}
      title={
        <SubIssuesCollapsibleTitle
          isOpen={isCollapsibleOpen}
          parentIssueId={issueId}
          disabled={disabled}
          projectId={projectId}
          workspaceSlug={workspaceSlug}
        />
      }
      buttonClassName="w-full"
    >
      <SubIssuesCollapsibleContent
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        parentIssueId={issueId}
        disabled={disabled}
        issueServiceType={issueServiceType}
      />
    </Collapsible>
  );
});
