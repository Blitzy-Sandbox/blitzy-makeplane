/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compact trigger button for the issue-detail "Links" widget that opens the link creation
 * modal; designed to be embedded inside the collapsible header so it must intercept clicks
 * before they bubble up and toggle the parent collapsible.
 *
 * Props:
 *   - customButton (React.ReactNode, optional): When provided, replaces the default `PlusIcon`
 *     so consumers can render a custom affordance while keeping the same click behavior.
 *   - disabled (boolean, optional, default `false`): Forwards to the native `<button disabled>`
 *     attribute.
 *   - issueServiceType (TIssueServiceType, required): Selects between the "issues" and "epics"
 *     issue-detail store slices via `useIssueDetail`.
 *
 * MobX stores read:
 *   - useIssueDetail(issueServiceType).toggleIssueLinkModal: action that flips the store's
 *     `isIssueLinkModalOpen` flag and (indirectly) mounts the link creation modal.
 *
 * Side effects:
 *   - On click: calls `toggleIssueLinkModal(true)` to open the modal. No direct API calls,
 *     navigations, or other mutations.
 */

import React from "react";
import { observer } from "mobx-react";
import { PlusIcon } from "@plane/propel/icons";
// plane imports
import type { TIssueServiceType } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

type Props = {
  customButton?: React.ReactNode;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
};

export const IssueLinksActionButton = observer(function IssueLinksActionButton(props: Props) {
  const { customButton, disabled = false, issueServiceType } = props;
  // store hooks
  const { toggleIssueLinkModal } = useIssueDetail(issueServiceType);

  // handlers
  // INTENT: preventDefault + stopPropagation are required because this button is rendered
  // inside the parent `Collapsible` header — without them, the click would also toggle the
  // collapsible's open state.
  const handleOnClick = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    toggleIssueLinkModal(true);
  };

  return (
    <button type="button" onClick={handleOnClick} disabled={disabled}>
      {customButton ? customButton : <PlusIcon className="h-4 w-4" />}
    </button>
  );
});
