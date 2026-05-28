/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Reactive row-style list of issue links for a single work item.
 *
 * Rendered purpose: resolves the link ids associated with `issueId` from the issue-detail store
 * (selected via `issueServiceType`, so the same component drives the ISSUES and EPICS namespaces)
 * and renders one `IssueLinkItem` row per id in a vertical `flex flex-col gap-2 pt-4` stack.
 * Returns `null` when the issue has no link records yet (early-exit before mapping).
 *
 * Counterpart to `./links.tsx`, which uses the larger card-style `IssueLinkDetail` renderer
 * instead of the compact row-style `IssueLinkItem` renderer.
 *
 * Props (`TLinkList`, local):
 *   - issueId (string, required): issue whose links should be rendered.
 *   - linkOperations (TLinkOperationsModal, required): the create-stripped link-operations contract
 *     (`Exclude<TLinkOperations, "create">`) forwarded to each row.
 *   - disabled (boolean, optional, default=false): forwarded to each row's `isNotAllowed` prop to
 *     hide write affordances when the viewer lacks permission.
 *   - issueServiceType (TIssueServiceType, required): selects the issue-detail store namespace
 *     (`EIssueServiceType.ISSUES` vs `EIssueServiceType.EPICS`) and is also forwarded to each row so
 *     child store reads remain in the same namespace.
 *
 * MobX stores read:
 *   - `useIssueDetail(issueServiceType)` — `link.getLinksByIssueId(issueId)` returns the ordered id
 *     array for the issue. Wrapped in `mobx-react` `observer` so the list re-renders when the
 *     store mutates.
 *
 * Side effects: none directly — all link mutations originate from the rendered rows which receive
 * `linkOperations` via prop drilling.
 *
 * Consumers: rendered by `../../issue-detail-widgets/links/content.tsx`
 * (`IssueLinksCollapsibleContent`) inside the widget-side links body of the
 * issue-detail widget shell.
 */

import { observer } from "mobx-react";
// plane imports
import type { TIssueServiceType } from "@plane/types";
// computed
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// local imports
import { IssueLinkItem } from "./link-item";
import type { TLinkOperations } from "./root";

type TLinkOperationsModal = Exclude<TLinkOperations, "create">;

type TLinkList = {
  issueId: string;
  linkOperations: TLinkOperationsModal;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
};

export const LinkList = observer(function LinkList(props: TLinkList) {
  // props
  const { issueId, linkOperations, disabled = false, issueServiceType } = props;
  // hooks
  const {
    link: { getLinksByIssueId },
  } = useIssueDetail(issueServiceType);

  const issueLinks = getLinksByIssueId(issueId);

  if (!issueLinks) return null;

  return (
    <div className="flex flex-col gap-2 pt-4">
      {issueLinks.map((linkId) => (
        <IssueLinkItem
          key={linkId}
          linkId={linkId}
          linkOperations={linkOperations}
          isNotAllowed={disabled}
          issueServiceType={issueServiceType}
        />
      ))}
    </div>
  );
});
