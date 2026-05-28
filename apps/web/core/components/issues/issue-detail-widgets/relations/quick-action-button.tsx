/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `RelationActionButton` is the compact "add relation" trigger rendered in the
 * relations widget header — it opens a `CustomMenu` listing every available
 * relation type and dispatches the user's selection into the relation modal
 * flow on the issue-detail store.
 *
 * Props:
 *   - `issueId` (string, required): the issue to which a new relation will be
 *     attached.
 *   - `customButton` (`React.ReactNode`, optional): caller-supplied trigger
 *     element rendered inside `CustomMenu`; defaults to a 16px `PlusIcon` when
 *     omitted.
 *   - `disabled` (boolean, optional, default `false`): disables the
 *     `CustomMenu` trigger.
 *   - `issueServiceType` (`TIssueServiceType`, required): discriminant selecting
 *     the issues-vs-epics slice of `useIssueDetail`.
 *
 * MobX stores read:
 *   - `useIssueDetail(issueServiceType)` — destructures
 *     `setRelationKey(relationKey)` and `toggleRelationModal(issueId, relationKey)`.
 *   - `useTimeLineRelationOptions()` (from `@/plane-web/components/relations`) —
 *     plane-web extension-point registry of available relation types
 *     (`TIssueRelationTypes` union from `@/plane-web/types`).
 *   - `useTranslation()` (from `@plane/i18n`) — localizes the menu-item labels
 *     via each option's `i18n_label` key.
 *
 * Side effects:
 *   - Selecting a menu item invokes `setRelationKey(relationKey)` and then
 *     `toggleRelationModal(issueId, relationKey)` (both MobX actions). The
 *     ordering is intentional — the relation key must be set in the store
 *     before the modal opens so it can render with the correct relation context.
 *   - No service / API calls are issued from this component; the modal opened
 *     downstream is responsible for the eventual create-relation API call.
 *
 * Wrapped in `observer` so it reactively re-renders if the store's relation
 * options or modal state would affect its disabled / open state.
 */

import React from "react";
import { observer } from "mobx-react";

import { useTranslation } from "@plane/i18n";
import { PlusIcon } from "@plane/propel/icons";
// plane imports
import type { TIssueServiceType } from "@plane/types";
import { CustomMenu } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// Plane-web
import { useTimeLineRelationOptions } from "@/plane-web/components/relations";
import type { TIssueRelationTypes } from "@/plane-web/types";

type Props = {
  issueId: string;
  customButton?: React.ReactNode;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
};

export const RelationActionButton = observer(function RelationActionButton(props: Props) {
  const { customButton, issueId, disabled = false, issueServiceType } = props;
  const { t } = useTranslation();
  // store hooks
  const { toggleRelationModal, setRelationKey } = useIssueDetail(issueServiceType);

  const ISSUE_RELATION_OPTIONS = useTimeLineRelationOptions();

  // handlers
  const handleOnClick = (relationKey: TIssueRelationTypes) => {
    setRelationKey(relationKey);
    toggleRelationModal(issueId, relationKey);
  };

  // button element
  const customButtonElement = customButton ? <>{customButton}</> : <PlusIcon className="h-4 w-4" />;

  return (
    <CustomMenu
      customButton={customButtonElement}
      placement="bottom-start"
      disabled={disabled}
      maxHeight="lg"
      closeOnSelect
    >
      {Object.values(ISSUE_RELATION_OPTIONS).map((item, index) => {
        if (!item) return <></>;

        return (
          <CustomMenu.MenuItem
            key={index}
            onClick={() => {
              handleOnClick(item.key);
            }}
          >
            <div className="flex items-center gap-2">
              {item.icon(12)}
              <span>{t(item.i18n_label)}</span>
            </div>
          </CustomMenu.MenuItem>
        );
      })}
    </CustomMenu>
  );
});
