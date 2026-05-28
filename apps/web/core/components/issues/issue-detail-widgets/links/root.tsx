/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top-level collapsible container for the issue-detail "Links" widget; composes the title
 * row (link count + action button) with the body link list and toggles its visibility
 * through the issue-detail store's `openWidgets` slice.
 *
 * Props:
 *   - workspaceSlug (string, required): Current workspace slug, forwarded to the body for link CRUD.
 *   - projectId (string, required): Current project ID, forwarded to the body for link CRUD.
 *   - issueId (string, required): Current issue ID; resolves the link list and count.
 *   - disabled (boolean, optional, default `false`): When true, hides the inline action button
 *     and blocks user-driven CRUD inside the body.
 *   - issueServiceType (TIssueServiceType, required): Selects between the "issues" and "epics"
 *     issue-detail store slices via `useIssueDetail`.
 *
 * MobX stores read:
 *   - useIssueDetail(issueServiceType): destructures `openWidgets` (TWorkItemWidgets[]) and
 *     `toggleOpenWidget` (action) — `openWidgets.includes("links")` derives `isCollapsibleOpen`,
 *     and `toggleOpenWidget("links")` mutates the store on user toggle.
 *
 * Side effects:
 *   - Invokes the `toggleOpenWidget` MobX action on collapsible toggle; no direct API calls,
 *     navigations, or modal openings happen here — those are delegated to the title and content
 *     sub-components.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import type { TIssueServiceType } from "@plane/types";
import { Collapsible } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// local imports
import { IssueLinksCollapsibleContent } from "./content";
import { IssueLinksCollapsibleTitle } from "./title";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
};

export const LinksCollapsible = observer(function LinksCollapsible(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled = false, issueServiceType } = props;
  // store hooks
  const { openWidgets, toggleOpenWidget } = useIssueDetail(issueServiceType);
  // derived values
  const isCollapsibleOpen = openWidgets.includes("links");

  return (
    <Collapsible
      isOpen={isCollapsibleOpen}
      onToggle={() => toggleOpenWidget("links")}
      title={
        <IssueLinksCollapsibleTitle
          isOpen={isCollapsibleOpen}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      }
      buttonClassName="w-full"
    >
      <IssueLinksCollapsibleContent
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
        disabled={disabled}
        issueServiceType={issueServiceType}
      />
    </Collapsible>
  );
});
