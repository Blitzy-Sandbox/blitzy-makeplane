/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Body renderer for the issue-detail "Links" collapsible; binds workspace/project/issue
 * identifiers to the shared `useLinkOperations` hook and forwards the resulting CRUD adapter
 * to the reusable `LinkList` presentation component from `../../issue-detail/links`.
 *
 * Props:
 *   - workspaceSlug (string, required): Current workspace slug, passed to `useLinkOperations`
 *     so link mutations target the correct API path.
 *   - projectId (string, required): Current project ID, same purpose as `workspaceSlug`.
 *   - issueId (string, required): Current issue ID; forwarded to `LinkList` for link resolution.
 *   - disabled (boolean, required): When true, disables interactive controls inside `LinkList`.
 *   - issueServiceType (TIssueServiceType, required): Selects between the "issues" and "epics"
 *     issue-detail store slices via `useLinkOperations`/`useIssueDetail`.
 *
 * MobX stores read:
 *   - Indirectly through `useLinkOperations`, which destructures `createLink`, `updateLink`,
 *     and `removeLink` from `useIssueDetail(issueServiceType)`. This component itself reads
 *     no store state directly.
 *
 * Side effects:
 *   - None at render time. The forwarded `linkOperations` object will, on user interaction,
 *     trigger MobX `createLink` / `updateLink` / `removeLink` actions (which call the
 *     `IssueLinkService` HTTP endpoints) and emit success/failure toasts — all encapsulated
 *     inside `useLinkOperations` (see `./helper`).
 *
 * Consumers: rendered by `./root.tsx` (`IssueDetailWidgetCollapsibles`) inside the issue-detail
 * widget collapsible group; the wider widget surface is mounted from
 * `apps/web/core/components/issues/issue-detail/main-content.tsx` and the peek-overview body.
 */

import React from "react";
import type { TIssueServiceType } from "@plane/types";
// components
import { LinkList } from "../../issue-detail/links";
// helper
import { useLinkOperations } from "./helper";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  issueServiceType: TIssueServiceType;
};

export function IssueLinksCollapsibleContent(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled, issueServiceType } = props;

  // helper
  const handleLinkOperations = useLinkOperations(workspaceSlug, projectId, issueId, issueServiceType);

  return (
    <LinkList
      issueId={issueId}
      linkOperations={handleLinkOperations}
      disabled={disabled}
      issueServiceType={issueServiceType}
    />
  );
}
