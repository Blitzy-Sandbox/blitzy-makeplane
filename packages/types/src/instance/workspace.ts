/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Instance-scoped workspace configuration contracts for the
 * `@plane/types/instance` subfolder. Models policy keys controlling the
 * creation of new workspaces on a deployed instance.
 *
 * Distinct from `../workspace.ts` (one level up), which models individual
 * workspace entities. This file scopes to instance-wide policy ONLY.
 *
 * Consumers: `apps/admin/` general settings screen (writes the value) and the
 * workspace-creation flow in `apps/web` (reads it through
 * `IInstanceConfig.is_workspace_creation_disabled`).
 */

/**
 * Storage keys for instance-wide workspace-creation policy persisted in the
 * instance configuration table.
 *
 * Field-level semantics:
 * - `DISABLE_WORKSPACE_CREATION`: `"1"` / `"0"` flag — when `"1"`, the API
 *   rejects new-workspace requests from non-admin users and the frontend
 *   hides the create-workspace UI. Mirrored into the runtime
 *   `IInstanceConfig.is_workspace_creation_disabled` boolean shipped at boot.
 */
export type TInstanceWorkspaceConfigurationKeys = "DISABLE_WORKSPACE_CREATION";
