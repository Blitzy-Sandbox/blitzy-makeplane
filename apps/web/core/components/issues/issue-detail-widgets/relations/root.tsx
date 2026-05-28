/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `RelationsCollapsible` is the top-level composition layer for the relations
 * widget on the issue-detail page; it owns the open/closed state via the
 * `openWidgets` slice of `useIssueDetail` and delegates header and body rendering
 * to `RelationsCollapsibleTitle` and `RelationsCollapsibleContent`.
 *
 * Props:
 *   - `workspaceSlug` (string, required): workspace slug passed through to child
 *     components for downstream relation API calls.
 *   - `issueId` (string, required): the issue whose relations are rendered.
 *   - `disabled` (boolean, optional, default `false`): when true, the title's
 *     quick-action "add relation" button is suppressed.
 *   - `issueServiceType` (`TIssueServiceType`, required): discriminant that
 *     selects the issues-vs-epics slice of `useIssueDetail`.
 *
 * MobX stores read:
 *   - `useIssueDetail(issueServiceType)` — destructures `openWidgets` (string[])
 *     and `toggleOpenWidget(key)`. Membership of `"relations"` in `openWidgets`
 *     derives `isCollapsibleOpen`.
 *
 * Side effects:
 *   - Clicking the collapsible header invokes the MobX action
 *     `toggleOpenWidget("relations")` to flip the section's open state. No direct
 *     service calls, toasts, or navigation are triggered from this component;
 *     those originate in `RelationsCollapsibleTitle` / `RelationsCollapsibleContent`.
 *
 * Wrapped in `observer` so it reactively re-renders when `openWidgets` mutates.
 *
 * Consumers: rendered by `../root.tsx` (`IssueDetailWidgetCollapsibles`) alongside
 * the sub-issues, links, and attachments collapsibles inside the issue-detail
 * widget shell mounted by `issue-detail/main-content.tsx` and the peek-overview body.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import type { TIssueServiceType } from "@plane/types";
import { Collapsible } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// local imports
import { RelationsCollapsibleContent } from "./content";
import { RelationsCollapsibleTitle } from "./title";

type Props = {
  workspaceSlug: string;
  issueId: string;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
};

export const RelationsCollapsible = observer(function RelationsCollapsible(props: Props) {
  const { workspaceSlug, issueId, disabled = false, issueServiceType } = props;
  // store hooks
  const { openWidgets, toggleOpenWidget } = useIssueDetail(issueServiceType);
  // derived values
  const isCollapsibleOpen = openWidgets.includes("relations");

  return (
    <Collapsible
      isOpen={isCollapsibleOpen}
      onToggle={() => toggleOpenWidget("relations")}
      title={
        <RelationsCollapsibleTitle
          isOpen={isCollapsibleOpen}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      }
      buttonClassName="w-full"
    >
      <RelationsCollapsibleContent
        workspaceSlug={workspaceSlug}
        issueId={issueId}
        disabled={disabled}
        issueServiceType={issueServiceType}
      />
    </Collapsible>
  );
});
