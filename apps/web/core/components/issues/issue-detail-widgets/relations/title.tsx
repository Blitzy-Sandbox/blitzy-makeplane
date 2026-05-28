/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `RelationsCollapsibleTitle` is the header row of the relations widget — it
 * shows the localized section title, a store-backed relation-count indicator,
 * and (when not `disabled`) the `RelationActionButton` quick-action trigger
 * that opens the "add relation" modal flow.
 *
 * Props:
 *   - `isOpen` (boolean, required): collapsible open/closed state forwarded
 *     from the parent `RelationsCollapsible` (drives the chevron in
 *     `CollapsibleButton`).
 *   - `issueId` (string, required): the issue whose relation count is rendered.
 *   - `disabled` (boolean, required): when true, suppresses the
 *     `RelationActionButton` in the header action slot.
 *   - `issueServiceType` (`TIssueServiceType`, optional, default
 *     `EIssueServiceType.ISSUES`): discriminant selecting the issues-vs-epics
 *     slice of `useIssueDetail`.
 *
 * MobX stores read:
 *   - `useIssueDetail(issueServiceType)` — destructures
 *     `relation.getRelationCountByIssueId(issueId, ISSUE_RELATION_OPTIONS)` to
 *     derive `relationsCount`.
 *   - `useTimeLineRelationOptions()` (from `@/plane-web/components/relations`) —
 *     plane-web extension-point registry of available relation types; passed to
 *     `getRelationCountByIssueId` so the count respects the active configuration.
 *   - `useTranslation()` (from `@plane/i18n`) — supplies the `t("common.relations")`
 *     section label.
 *
 * Side effects:
 *   - None directly. This is a read-only header; the embedded
 *     `RelationActionButton` (when not disabled) is what opens the relation
 *     creation modal.
 *
 * Wrapped in `observer` so it reactively re-renders when the store's relation
 * count for `issueId` changes.
 *
 * Consumers: passed as the `title` slot of the `Collapsible` rendered by
 * `./root.tsx` (`RelationsCollapsible`) inside the issue-detail widget shell.
 */

import React, { useMemo } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
import { CollapsibleButton } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// Plane-web
import { useTimeLineRelationOptions } from "@/plane-web/components/relations";
// local imports
import { RelationActionButton } from "./quick-action-button";

type Props = {
  isOpen: boolean;
  issueId: string;
  disabled: boolean;
  issueServiceType?: TIssueServiceType;
};

export const RelationsCollapsibleTitle = observer(function RelationsCollapsibleTitle(props: Props) {
  const { isOpen, issueId, disabled, issueServiceType = EIssueServiceType.ISSUES } = props;
  const { t } = useTranslation();
  // store hook
  const {
    relation: { getRelationCountByIssueId },
  } = useIssueDetail(issueServiceType);

  const ISSUE_RELATION_OPTIONS = useTimeLineRelationOptions();
  // derived values
  const relationsCount = getRelationCountByIssueId(issueId, ISSUE_RELATION_OPTIONS);

  // indicator element
  const indicatorElement = useMemo(
    () => (
      <span className="flex items-center justify-center">
        <p className="text-14 !leading-3 text-tertiary">{relationsCount}</p>
      </span>
    ),
    [relationsCount]
  );

  return (
    <CollapsibleButton
      isOpen={isOpen}
      title={t("common.relations")}
      indicatorElement={indicatorElement}
      actionItemElement={
        !disabled && <RelationActionButton issueId={issueId} disabled={disabled} issueServiceType={issueServiceType} />
      }
    />
  );
});
