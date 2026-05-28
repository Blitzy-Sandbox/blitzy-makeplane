/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Empty-state view shown when the workspace has projects but no draft
 * issues yet.
 *
 * Lets workspace ADMIN/MEMBER users create the first draft issue via the
 * shared `CreateUpdateIssueModal`, which is always mounted with the modal
 * scoped to `EIssuesStoreType.WORKSPACE_DRAFT` and `isDraft` flagged. The
 * modal handles persistence — this component does not call the network
 * directly.
 *
 * Props: none. The parent `WorkspaceDraftIssuesRoot` decides when to render.
 *
 * MobX stores read (via React context):
 *   - useTranslation — translator for localized strings.
 *   - useUserPermissions — allowPermissions, used to gate the CTA on
 *     workspace-level ADMIN/MEMBER role. Disabling client-side prevents
 *     unauthorized users from triggering a server-side 403.
 *
 * Side effects:
 *   - Toggles local `isDraftIssueModalOpen` state to open the create modal;
 *     all persistence is delegated to `CreateUpdateIssueModal`.
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
