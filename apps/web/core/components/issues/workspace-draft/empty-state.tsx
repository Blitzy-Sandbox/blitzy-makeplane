/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Empty-state placeholder for the workspace-level draft work-item list.
 *
 * Rendered purpose: an `EmptyStateDetailed` placeholder shown by the workspace-draft list
 * `root` when the current viewer has no draft work items in the workspace. Surfaces a
 * primary-action button that opens `CreateUpdateIssueModal` in draft mode for permitted users.
 *
 * Props: none — this component takes no props and resolves all state internally.
 *
 * MobX stores read:
 *   - `useUserPermissions()` — `allowPermissions` gate that hides the create button for guests
 *
 * Side effects:
 *   - Opens `CreateUpdateIssueModal` configured with `EIssuesStoreType.WORKSPACE_DRAFT` when the
 *     create-button is clicked; the actual draft creation is owned by the issue-modal flow.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/workspace-draft/root.tsx`
 */

import { Fragment, useState } from "react";
// components
import { observer } from "mobx-react";
import { EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EmptyStateDetailed } from "@plane/propel/empty-state";
import { EIssuesStoreType, EUserWorkspaceRoles } from "@plane/types";
import { CreateUpdateIssueModal } from "@/components/issues/issue-modal/modal";
// constants
import { useUserPermissions } from "@/hooks/store/user";

export const WorkspaceDraftEmptyState = observer(function WorkspaceDraftEmptyState() {
  // state
  const [isDraftIssueModalOpen, setIsDraftIssueModalOpen] = useState(false);
  // store hooks
  const { t } = useTranslation();
  const { allowPermissions } = useUserPermissions();
  // derived values
  const canPerformEmptyStateActions = allowPermissions(
    [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  return (
    <Fragment>
      <CreateUpdateIssueModal
        isOpen={isDraftIssueModalOpen}
        storeType={EIssuesStoreType.WORKSPACE_DRAFT}
        onClose={() => setIsDraftIssueModalOpen(false)}
        isDraft
      />
      <div className="relative h-full w-full overflow-y-auto">
        <EmptyStateDetailed
          title={t("workspace_empty_state.drafts.title")}
          description={t("workspace_empty_state.drafts.description")}
          assetKey="draft"
          actions={[
            {
              label: t("workspace_empty_state.drafts.cta_primary"),
              onClick: () => {
                setIsDraftIssueModalOpen(true);
              },
              disabled: !canPerformEmptyStateActions,
              variant: "primary",
            },
          ]}
        />
      </div>
    </Fragment>
  );
});
