/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Root orchestration component for the issue-detail attachments widget.
 *
 * Rendered purpose: Wraps the attachments header (`IssueAttachmentsCollapsibleTitle`) and
 * body (`IssueAttachmentsCollapsibleContent`) inside a `@plane/ui` `Collapsible` panel,
 * deriving open/closed state from the issue-detail store and toggling the
 * `"attachments"` widget key on click.
 *
 * Props:
 *  - `workspaceSlug` (string, required) — workspace slug used by child upload/list components for API URLs.
 *  - `projectId` (string, required) — project identifier for the issue under view.
 *  - `issueId` (string, required) — issue whose attachments are being rendered.
 *  - `disabled` (boolean, optional, default `false`) — when true, hides the header action button and prevents uploads.
 *  - `issueServiceType` (TIssueServiceType, required) — selects which issue-detail store slice (issues vs. drafts vs. epics) is read.
 *
 * MobX stores read:
 *  - `useIssueDetail(issueServiceType)` — destructures `openWidgets` (observable array) to compute open state
 *    and binds `toggleOpenWidget` (action) to the collapsible's `onToggle` handler.
 *
 * Side effects: Invokes the `toggleOpenWidget("attachments")` MobX action when the user expands/collapses
 * the panel; no direct API calls, navigations, or toasts originate from this file (those live in `helper.tsx`
 * and `quick-action-button.tsx`).
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import type { TIssueServiceType } from "@plane/types";
import { Collapsible } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// local imports
import { IssueAttachmentsCollapsibleContent } from "./content";
import { IssueAttachmentsCollapsibleTitle } from "./title";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
};

export const AttachmentsCollapsible = observer(function AttachmentsCollapsible(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled = false, issueServiceType } = props;
  // store hooks
  const { openWidgets, toggleOpenWidget } = useIssueDetail(issueServiceType);

  // derived values
  const isCollapsibleOpen = openWidgets.includes("attachments");

  return (
    <Collapsible
      isOpen={isCollapsibleOpen}
      onToggle={() => toggleOpenWidget("attachments")}
      title={
        <IssueAttachmentsCollapsibleTitle
          isOpen={isCollapsibleOpen}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      }
      buttonClassName="w-full"
    >
      <IssueAttachmentsCollapsibleContent
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
        disabled={disabled}
        issueServiceType={issueServiceType}
      />
    </Collapsible>
  );
});
