/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders the list of related work items for a parent issue by mapping each
 * related-issue id to a `RelationIssueListItem` row. This is a pure
 * presentational container — every CRUD action is delegated to the row
 * component via the lifted `handleIssueCrudState` callback, so adding or
 * changing relation actions only requires editing the row, not this file.
 *
 * Required props:
 *   - workspaceSlug: string                 — current workspace slug (URL segment).
 *   - issueId: string                       — parent issue id whose relations are being shown.
 *   - issueIds: string[]                    — ordered list of related-issue ids to render.
 *   - relationKey: TIssueRelationTypes      — relation taxonomy key (e.g. `blocking`,
 *                                             `blocked_by`, `relates_to`, `duplicate`);
 *                                             imported from `@/plane-web/types`.
 *   - handleIssueCrudState: (key, issueId, issue?, relationKey?, relationIssueId?) => void
 *                                           — parent-supplied callback that lifts
 *                                             edit / delete / remove-relation state
 *                                             into the surrounding issue-detail screen;
 *                                             forwarded unmodified to every child row.
 *
 * Optional props:
 *   - disabled?: boolean                    — defaults to `false`; when `true`,
 *                                             destructive/edit actions are suppressed
 *                                             in each row.
 *   - issueServiceType?: TIssueServiceType  — defaults to `EIssueServiceType.ISSUES`;
 *                                             switches the underlying issue-detail
 *                                             store between work items and epics.
 *
 * MobX stores read:
 *   None directly. Reactivity is opt-in via `observer` so that child-store
 *   mutations re-render rows; the row component owns all `useIssueDetail` /
 *   `useProject` reads.
 *
 * Side effects:
 *   None. This is a pure presentational container; mutations, navigations,
 *   and API calls are delegated to `RelationIssueListItem`.
 *
 * Consumers:
 *   - `../issue-detail-widgets/relations/content.tsx` — the only caller; renders one
 *     `RelationIssueList` per relation-type collapsible (blocking / blocked_by / duplicate /
 *     relates_to / project-defined epic relations) inside the issue-detail relations widget.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import type { TIssue, TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// Plane-web imports
import type { TIssueRelationTypes } from "@/plane-web/types";
// local imports
import { RelationIssueListItem } from "./issue-list-item";

type Props = {
  workspaceSlug: string;
  issueId: string;
  issueIds: string[];
  relationKey: TIssueRelationTypes;
  handleIssueCrudState: (
    key: "update" | "delete" | "removeRelation",
    issueId: string,
    issue?: TIssue | null,
    relationKey?: TIssueRelationTypes | null,
    relationIssueId?: string | null
  ) => void;
  disabled?: boolean;
  issueServiceType?: TIssueServiceType;
};

export const RelationIssueList = observer(function RelationIssueList(props: Props) {
  const {
    workspaceSlug,
    issueId,
    issueIds,
    relationKey,
    disabled = false,
    handleIssueCrudState,
    issueServiceType = EIssueServiceType.ISSUES,
  } = props;

  return (
    <div className="relative">
      {issueIds &&
        issueIds.length > 0 &&
        issueIds.map((relationIssueId) => (
          <RelationIssueListItem
            key={relationIssueId}
            workspaceSlug={workspaceSlug}
            issueId={issueId}
            relationKey={relationKey}
            relationIssueId={relationIssueId}
            disabled={disabled}
            handleIssueCrudState={handleIssueCrudState}
            issueServiceType={issueServiceType}
          />
        ))}
    </div>
  );
});
