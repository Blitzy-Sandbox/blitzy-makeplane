/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Applied members filter chips (assignee / creator / subscriber filter values).
 *
 * Rendered purpose: renders one removable chip per currently-applied workspace member ID in the issue
 * layout's applied-filters bar. Each chip shows the member's avatar and display name.
 *
 * Props (`Props`):
 *   - `handleRemove` (`(val: string) => void`, required): invoked with the member ID that should be
 *     removed from the active filter. The parent aggregator is responsible for invoking
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS, { <key>: <next> })`
 *     where `<key>` is one of `assignees`, `created_by`, `subscriber`, `mentions`, etc.
 *   - `values` (`string[]`, required): currently-applied workspace member IDs.
 *   - `editable` (`boolean | undefined`, required): when truthy, renders the close button; when
 *     falsy/undefined, the chip is read-only (used in read-only views such as archived issues or
 *     shared spaces).
 *
 * MobX stores read:
 *   - `useMember().workspace.getWorkspaceMemberDetails(memberId)` → resolves the workspace member
 *     record; the `.member` sub-property carries `{ display_name, avatar_url, ... }`. Wrapped with
 *     `observer` so the chip re-renders when the workspace member map mutates (e.g., display-name or
 *     avatar updates).
 *
 * Side effects: none — render-only; the only outbound interaction is `handleRemove(memberId)` on
 * click. Avatar URLs are passed through `getFileURL` from `@plane/utils` to resolve the configured
 * storage backend (S3, local, etc.).
 */

import { observer } from "mobx-react";
import { CloseIcon } from "@plane/propel/icons";
// plane ui
import { Avatar } from "@plane/ui";
// helpers
import { getFileURL } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";

type Props = {
  handleRemove: (val: string) => void;
  values: string[];
  editable: boolean | undefined;
};

export const AppliedMembersFilters = observer(function AppliedMembersFilters(props: Props) {
  const { handleRemove, values, editable } = props;

  const {
    workspace: { getWorkspaceMemberDetails },
  } = useMember();

  return (
    <>
      {values.map((memberId) => {
        const memberDetails = getWorkspaceMemberDetails(memberId)?.member;

        // Skip rendering when the member has not loaded yet OR has been removed from the workspace — prevents stale chip UI.
        if (!memberDetails) return null;

        return (
          <div key={memberId} className="flex items-center gap-1 rounded-sm bg-layer-1 p-1 text-11">
            <Avatar
              name={memberDetails.display_name}
              src={getFileURL(memberDetails.avatar_url)}
              showTooltip={false}
              size={"sm"}
            />
            <span className="normal-case">{memberDetails.display_name}</span>
            {editable && (
              <button
                type="button"
                className="grid place-items-center text-tertiary hover:text-secondary"
                onClick={() => handleRemove(memberId)}
              >
                <CloseIcon height={10} width={10} strokeWidth={2} />
              </button>
            )}
          </div>
        );
      })}
    </>
  );
});
