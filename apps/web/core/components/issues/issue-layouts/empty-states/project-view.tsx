/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Empty-state surface for the project view layout (saved/custom work-item views
 * inside a project). A single primary CTA opens the create-issue modal scoped to the
 * `PROJECT_VIEW` store. Unlike sibling variants in this folder
 * (`project-issues.tsx`, `archived-issues.tsx`, `cycle.tsx`, `module.tsx`), this
 * component does NOT integrate with `useWorkItemFilterInstance` and therefore does
 * NOT render a search/filter-empty branch — it always renders the same default
 * empty state.
 *
 * Hooks read:
 *   - useCommandPalette().toggleCreateIssueModal   (opens create-issue modal)
 *   - useUserPermissions().allowPermissions        (CTA permission gate)
 *
 * Side effects:
 *   - toggleCreateIssueModal(true, EIssuesStoreType.PROJECT_VIEW) — opens the global
 *     create-issue modal scoped to the project-view issues store. No API calls,
 *     no navigation, no other mutations are issued from this component.
 *
 * Permission: requires PROJECT-level ADMIN or MEMBER (`EUserPermissions`); the
 * primary CTA is disabled otherwise.
 *
 * NOTE: An existing `// TODO: Add translation` flag inside the JSX acknowledges
 * that the copy here is currently hard-coded English and pending i18n migration —
 * preserve verbatim until that work lands.
 *
 * Consumed by: `./index.tsx` (`IssueLayoutEmptyState`) when
 * `storeType === EIssuesStoreType.PROJECT_VIEW`.
 */

import { observer } from "mobx-react";
// components
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { EmptyStateDetailed } from "@plane/propel/empty-state";
import { EIssuesStoreType } from "@plane/types";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useUserPermissions } from "@/hooks/store/user";

/**
 * Renders the empty-state UI for the project view layout with a single primary CTA.
 *
 * Props: none.
 *
 * Permission: requires PROJECT-level ADMIN or MEMBER (`EUserPermissions`); when the
 * caller lacks the permission, the CTA is rendered as disabled rather than hidden.
 *
 * Side effects: invoking the CTA calls
 * `toggleCreateIssueModal(true, EIssuesStoreType.PROJECT_VIEW)` which opens the
 * application-wide create-issue modal scoped to the project-view issues store.
 */
export const ProjectViewEmptyState = observer(function ProjectViewEmptyState() {
  // store hooks
  const { toggleCreateIssueModal } = useCommandPalette();
  const { allowPermissions } = useUserPermissions();

  // auth
  const isCreatingIssueAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  return (
    // TODO: Add translation
    <EmptyStateDetailed
      assetKey="work-item"
      title="View work items will appear here"
      description="Work items help you track individual pieces of work. With work items, keep track of what's going on, who is working on it, and what's done."
      actions={[
        {
          label: "New work item",
          onClick: () => {
            toggleCreateIssueModal(true, EIssuesStoreType.PROJECT_VIEW);
          },
          disabled: !isCreatingIssueAllowed,
          variant: "primary",
        },
      ]}
    />
  );
});
