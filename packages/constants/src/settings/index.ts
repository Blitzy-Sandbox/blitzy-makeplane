/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Settings constants barrel — re-exports the profile, project, and workspace
 * settings registries (tab structure + access rules + route highlighting).
 *
 * Consumers: settings shells in `apps/web/core/components/settings/profile/**`,
 * `apps/web/core/components/settings/project/**`,
 * `apps/web/core/components/settings/workspace/**`, plus
 * `apps/web/core/components/project/settings/**` and
 * `apps/web/core/components/workspace/settings/**`. Also consumed by the
 * command palette menus at `apps/web/core/components/power-k/ui/pages/open-entity/**`.
 */

export * from "./profile";
export * from "./project";
export * from "./workspace";
