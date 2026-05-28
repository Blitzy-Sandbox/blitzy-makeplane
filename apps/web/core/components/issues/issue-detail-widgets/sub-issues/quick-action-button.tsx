/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `SubIssuesActionButton` — compact dropdown trigger ("Add sub-work-item") rendered inside the sub-issues title actions strip.
 * Stages CRUD intent in the `issue-detail` store (`issueCrudOperationState`) and opens the matching modal: `create` → opens
 * `CreateUpdateIssueModal` (new sub-work-item form); `existing` → opens `ExistingIssuesListModal` (attach by id picker).
 * Returns an empty fragment if the parent issue cannot be resolved from the store.
 *
 * Props (Props):
 *   - issueId (string, required): Parent issue id; used both for resolving the parent issue record and for staging it as `parentIssueId` in the CRUD state.
 *   - customButton (React.ReactNode, optional): Custom trigger element; defaults to a small `PlusIcon`.
 *   - disabled (boolean, optional, default `false`): When true, the `CustomMenu` trigger is non-interactive.
 *   - issueServiceType (TIssueServiceType, required): Selects which `issue-detail` store slice to read.
 *
 * MobX stores read (via `useIssueDetail(issueServiceType)`):
 *   - `issue.getIssueById(issueId)`: selector — resolves the parent issue record; absence triggers the empty-fragment return.
 *   - `toggleCreateIssueModal(open: boolean)`: action — opens the shared create/update issue modal.
 *   - `toggleSubIssuesModal(issueId: string | null)`: action — opens the attach-existing sub-issue picker for the given parent issue id.
 *   - `setIssueCrudOperationState(nextState)`: action — replaces the CRUD operation state bag.
 *   - `issueCrudOperationState`: observable — the canonical CRUD state bag with `create`, `existing`, `update`, `delete` slots; each slot carries `{ toggle, parentIssueId, issue }`.
 *
 * Side effects (the `create` vs. `existing` dichotomy):
 *   - `handleCreateNew()` — flips `issueCrudOperationState.create.toggle`, sets `parentIssueId = issueId`, then calls `toggleCreateIssueModal(true)`. The opened modal is owned by `issue-detail-widget-modals.tsx` upstream.
 *   - `handleAddExisting()` — flips `issueCrudOperationState.existing.toggle`, sets `parentIssueId = issueId`, then calls `toggleSubIssuesModal(issue.id)`. The opened modal is the `ExistingIssuesListModal` (also owned upstream).
 *   - No direct API calls; modal submission handlers (in the upstream modal owner) invoke `useSubIssueOperations` for actual mutations.
 *   - No toasts emitted at this layer.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { PlusIcon, WorkItemsIcon } from "@plane/propel/icons";
import type { TIssue, TIssueServiceType } from "@plane/types";
import { CustomMenu } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

type Props = {
  issueId: string;
  customButton?: React.ReactNode;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
};

export const SubIssuesActionButton = observer(function SubIssuesActionButton(props: Props) {
  const { issueId, customButton, disabled = false, issueServiceType } = props;
  // translation
  const { t } = useTranslation();
  // store hooks
  const {
    issue: { getIssueById },
    toggleCreateIssueModal,
    toggleSubIssuesModal,
    setIssueCrudOperationState,
    issueCrudOperationState,
  } = useIssueDetail(issueServiceType);

  // derived values
  const issue = getIssueById(issueId);

  if (!issue) return <></>;

  // handlers
  const handleIssueCrudState = (
    key: "create" | "existing",
    _parentIssueId: string | null,
    issue: TIssue | null = null
  ) => {
    setIssueCrudOperationState({
      ...issueCrudOperationState,
      [key]: {
        toggle: !issueCrudOperationState[key].toggle,
        parentIssueId: _parentIssueId,
        issue: issue,
      },
    });
  };

  const handleCreateNew = () => {
    handleIssueCrudState("create", issueId, null);
    toggleCreateIssueModal(true);
  };

  const handleAddExisting = () => {
    handleIssueCrudState("existing", issueId, null);
    toggleSubIssuesModal(issue.id);
  };

  // options
  const optionItems = [
    {
      i18n_label: "common.create_new",
      icon: <PlusIcon className="h-3 w-3" />,
      onClick: handleCreateNew,
    },
    {
      i18n_label: "common.add_existing",
      icon: <WorkItemsIcon className="h-3 w-3" />,
      onClick: handleAddExisting,
    },
  ];

  // button element
  const customButtonElement = customButton ? <>{customButton}</> : <PlusIcon className="h-4 w-4" />;

  return (
    <CustomMenu customButton={customButtonElement} placement="bottom-start" disabled={disabled} closeOnSelect>
      {optionItems.map((item, index) => (
        <CustomMenu.MenuItem
          key={index}
          onClick={() => {
            item.onClick();
          }}
        >
          <div className="flex items-center gap-2">
            {item.icon}
            <span>{t(item.i18n_label)}</span>
          </div>
        </CustomMenu.MenuItem>
      ))}
    </CustomMenu>
  );
});
