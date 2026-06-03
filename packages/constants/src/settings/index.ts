/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Settings barrel re-exporting profile, project, and workspace settings registries (tab structure, access rules, active-route highlighting).
 * Consumers: settings shells in `apps/web/core/components/settings/{profile,project,workspace}/**` and the command palette menus under `apps/web/core/components/power-k/ui/pages/open-entity/**`.
 */

export * from "./profile";
export * from "./project";
export * from "./workspace";
