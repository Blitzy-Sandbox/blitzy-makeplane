/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Instance-wide workspace-creation policy keys (distinct from `../workspace.ts`
 * which models individual workspace entities); read via
 * `IInstanceConfig.is_workspace_creation_disabled` in `apps/web`.
 */

/**
 * Workspace-creation policy key — `DISABLE_WORKSPACE_CREATION="1"` rejects
 * non-admin create requests at the API and hides the create-workspace UI;
 * mirrored into `IInstanceConfig.is_workspace_creation_disabled` at boot.
 */
export type TInstanceWorkspaceConfigurationKeys = "DISABLE_WORKSPACE_CREATION";
