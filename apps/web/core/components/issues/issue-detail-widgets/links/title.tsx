/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Collapsible header row for the issue-detail "Links" widget that displays the localized
 * "Links" label, the current link count from the issue store, and (when enabled) inlines
 * the `IssueLinksActionButton` quick-action to open the link creation modal.
 *
 * Props:
 *   - isOpen (boolean, required): Forwarded to the underlying `CollapsibleButton` so the
 *     chevron/affordance reflects the parent collapsible's open state.
 *   - issueId (string, required): Resolves the issue record from the store to read `link_count`.
 *   - disabled (boolean, required): When true, hides the inline action button and is forwarded
 *     to it for redundant guarding.
 *   - issueServiceType (TIssueServiceType, required): Selects between the "issues" and "epics"
 *     issue-detail store slices via `useIssueDetail`.
 *
 * MobX stores read:
 *   - useIssueDetail(issueServiceType).issue.getIssueById(issueId): observable issue lookup;
 *     re-renders when the resolved issue or its `link_count` changes (observer-wrapped).
 *
 * Side effects:
 *   - None directly. Rendering `IssueLinksActionButton` defers the modal-open mutation
 *     (`toggleIssueLinkModal(true)`) to that child component.
 */

import React, { useMemo } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TIssueServiceType } from "@plane/types";
import { CollapsibleButton } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// local imports
import { IssueLinksActionButton } from "./quick-action-button";

type Props = {
  isOpen: boolean;
  issueId: string;
  disabled: boolean;
  issueServiceType: TIssueServiceType;
};

export const IssueLinksCollapsibleTitle = observer(function IssueLinksCollapsibleTitle(props: Props) {
  const { isOpen, issueId, disabled, issueServiceType } = props;
  // translation
  const { t } = useTranslation();
  // store hooks
  const {
    issue: { getIssueById },
  } = useIssueDetail(issueServiceType);

  // derived values
  const issue = getIssueById(issueId);

  const linksCount = issue?.link_count ?? 0;

  // indicator element
  const indicatorElement = useMemo(
    () => (
      <span className="flex items-center justify-center">
        <p className="text-14 !leading-3 text-tertiary">{linksCount}</p>
      </span>
    ),
    [linksCount]
  );

  return (
    <CollapsibleButton
      isOpen={isOpen}
      title={t("common.links")}
      indicatorElement={indicatorElement}
      actionItemElement={
        !disabled && <IssueLinksActionButton issueServiceType={issueServiceType} disabled={disabled} />
      }
    />
  );
});
