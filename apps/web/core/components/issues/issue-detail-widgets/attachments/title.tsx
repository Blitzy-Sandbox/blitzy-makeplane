/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Header (title row) of the issue-detail attachments collapsible.
 *
 * Rendered purpose: Renders a `@plane/ui` `CollapsibleButton` with the translated label
 * `common.attachments`, the current attachment count indicator, and (when not disabled)
 * the `IssueAttachmentActionButton` as the action slot — the user's direct upload entry point.
 *
 * Props:
 *  - `isOpen` (boolean, required) — current open/closed state of the parent collapsible, forwarded for chevron rotation.
 *  - `workspaceSlug` (string, required) — workspace slug forwarded to the action button.
 *  - `projectId` (string, required) — project identifier forwarded to the action button.
 *  - `issueId` (string, required) — issue whose attachment count is displayed.
 *  - `disabled` (boolean, required) — when true, hides the upload action button.
 *  - `issueServiceType` (TIssueServiceType, optional, default `EIssueServiceType.ISSUES`) — selects the issue-detail
 *    store slice used to look up the issue; one of `EIssueServiceType.ISSUES`, `EPICS`, `WORK_ITEMS`.
 *
 * MobX stores read:
 *  - `useIssueDetail(issueServiceType)` — destructures `issue.getIssueById` to look up `issue.attachment_count`.
 *
 * Side effects: None. This file is purely presentational; the embedded `IssueAttachmentActionButton`
 * (see `./quick-action-button.tsx`) owns the upload action handler — uploads run through the
 * assets V2 presigned-upload flow against `IssueAttachmentV2Endpoint` (full contract documented
 * in `./helper.tsx`).
 *
 * Consumers (this directory): rendered by `./root.tsx`.
 */

import React, { useMemo } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
import { CollapsibleButton } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// local imports
import { IssueAttachmentActionButton } from "./quick-action-button";

type Props = {
  isOpen: boolean;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  issueServiceType?: TIssueServiceType;
};

export const IssueAttachmentsCollapsibleTitle = observer(function IssueAttachmentsCollapsibleTitle(props: Props) {
  const { isOpen, workspaceSlug, projectId, issueId, disabled, issueServiceType = EIssueServiceType.ISSUES } = props;
  const { t } = useTranslation();
  // store hooks
  const {
    issue: { getIssueById },
  } = useIssueDetail(issueServiceType);

  // derived values
  const issue = getIssueById(issueId);
  const attachmentCount = issue?.attachment_count ?? 0;

  // indicator element
  // Memoized to avoid re-rendering the count span on unrelated parent re-renders; only `attachmentCount` invalidates it.
  const indicatorElement = useMemo(
    () => (
      <span className="flex items-center justify-center">
        <p className="text-14 !leading-3 text-tertiary">{attachmentCount}</p>
      </span>
    ),
    [attachmentCount]
  );

  return (
    <CollapsibleButton
      isOpen={isOpen}
      title={t("common.attachments")}
      indicatorElement={indicatorElement}
      actionItemElement={
        !disabled && (
          <IssueAttachmentActionButton
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issueId={issueId}
            disabled={disabled}
            issueServiceType={issueServiceType}
          />
        )
      }
    />
  );
});
