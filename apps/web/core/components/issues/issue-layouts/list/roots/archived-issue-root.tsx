/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module: `ArchivedIssueListLayout` route root for the archived-issues list layout.
 *
 * Rendered purpose: read-only entry point for the archived-issues list view;
 * unconditionally disables per-property edits by injecting a
 * `canEditPropertiesBasedOnProject` callback that always returns `false`.
 *
 * Props: none — this component reads no route parameters and accepts no props.
 *
 * MobX stores read directly: none. The downstream shared `BaseListRoot`
 * container reads the archived issue store internally
 * (`useIssues(EIssuesStoreType.ARCHIVED)`).
 *
 * Side effects: none directly. All mutations and navigations are scoped
 * within `BaseListRoot` and `ArchivedIssueQuickActions`.
 *
 * Quick actions: `ArchivedIssueQuickActions` (read-only archived menu —
 * restore / permanently-delete only).
 */

import { observer } from "mobx-react";
// local imports
import { ArchivedIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseListRoot } from "../base-list-root";

/**
 * Route root for the archived-issues list layout — wires the read-only
 * archived quick-actions and the always-`false` per-property edit gate into
 * the shared `BaseListRoot` shell. Wrapped in MobX `observer` for reactive
 * re-rendering when the underlying archived issue store changes.
 */
export const ArchivedIssueListLayout = observer(function ArchivedIssueListLayout() {
  const canEditPropertiesBasedOnProject = () => false;

  return (
    <BaseListRoot
      QuickActions={ArchivedIssueQuickActions}
      canEditPropertiesBasedOnProject={canEditPropertiesBasedOnProject}
    />
  );
});
