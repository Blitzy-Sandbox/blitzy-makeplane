/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Reactive card-style list of issue links for a single work item.
 *
 * Rendered purpose: resolves the link ids associated with `issueId` from the issue-detail store
 * and renders one `IssueLinkDetail` card per id in a vertical `space-y-2` stack. Returns an empty
 * fragment when the issue has no links so the surrounding section collapses gracefully.
 *
 * Counterpart to `./link-list.tsx`, which uses the denser row-style `IssueLinkItem` renderer
 * instead of the card-style `IssueLinkDetail` renderer.
 *
 * Props (`TIssueLinkList`, exported):
 *   - issueId (string, required): issue whose links should be rendered.
 *   - linkOperations (TLinkOperationsModal, required): the create-stripped link-operations contract
 *     (`Exclude<TLinkOperations, "create">`) passed through to each card; supplied by
 *     `IssueLinkRoot` in `./root`.
 *   - disabled (boolean, optional, default=false): forwarded to each card's `isNotAllowed` prop to
 *     hide write affordances when the viewer lacks permission.
 *
 * MobX stores read:
 *   - `useIssueDetail()` — `link.getLinksByIssueId(issueId)` returns the ordered id array for the
 *     issue. Wrapped in `mobx-react` `observer` so the list re-renders when the store mutates.
 *
 * Side effects: none directly — all link mutations originate from the rendered cards which receive
 * `linkOperations` via prop drilling.
 *
 * Exported types:
 *   - `TLinkOperationsModal` — `Exclude<TLinkOperations, "create">`, the narrowed contract for
 *     surfaces that operate on existing links only (update + remove). Also re-exported by
 *     `./create-update-link-modal.tsx` for the modal surface.
 *   - `TIssueLinkList` — this component's prop shape.
 *
 * Consumers: rendered by `./root.tsx` (`IssueLinkRoot`) inside the issue-detail
 * sidebar links section.
 */

import { observer } from "mobx-react";
// computed
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { IssueLinkDetail } from "./link-detail";
// hooks
import type { TLinkOperations } from "./root";

export type TLinkOperationsModal = Exclude<TLinkOperations, "create">;

export type TIssueLinkList = {
  issueId: string;
  linkOperations: TLinkOperationsModal;
  disabled?: boolean;
};

export const IssueLinkList = observer(function IssueLinkList(props: TIssueLinkList) {
  // props
  const { issueId, linkOperations, disabled = false } = props;
  // hooks
  const {
    link: { getLinksByIssueId },
  } = useIssueDetail();

  const issueLinks = getLinksByIssueId(issueId);

  if (!issueLinks) return <></>;

  return (
    <div className="space-y-2">
      {issueLinks &&
        issueLinks.length > 0 &&
        issueLinks.map((linkId) => (
          <IssueLinkDetail key={linkId} linkId={linkId} linkOperations={linkOperations} isNotAllowed={disabled} />
        ))}
    </div>
  );
});
