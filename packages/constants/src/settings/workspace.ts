/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace settings tab groups, per-tab metadata, and role-based access maps
 * consumed by the workspace settings shell at
 * `apps/web/core/components/settings/workspace/**`.
 */

// plane imports
import type { TWorkspaceSettingsItem, TWorkspaceSettingsTabs } from "@plane/types";
import { EUserWorkspaceRoles } from "@plane/types";

/**
 * Discriminant for sectioned workspace settings sidebar (`ADMINISTRATION` = general/members/billing/export, `FEATURES` = future toggles placeholder, `DEVELOPER` = webhooks) used by `GROUPED_WORKSPACE_SETTINGS`.
 * Consumers: `apps/web/core/components/{settings/workspace,workspace/settings}/**`.
 */
export enum WORKSPACE_SETTINGS_CATEGORY {
  ADMINISTRATION = "administration",
  FEATURES = "features",
  DEVELOPER = "developer",
}

/**
 * Canonical render order for workspace settings categories in the sidebar —
 * `ADMINISTRATION` → `FEATURES` → `DEVELOPER`.
 *
 * Consumers: `apps/web/core/components/settings/workspace/sidebar/**`.
 */
export const WORKSPACE_SETTINGS_CATEGORIES: WORKSPACE_SETTINGS_CATEGORY[] = [
  WORKSPACE_SETTINGS_CATEGORY.ADMINISTRATION,
  WORKSPACE_SETTINGS_CATEGORY.FEATURES,
  WORKSPACE_SETTINGS_CATEGORY.DEVELOPER,
];

/**
 * Maps each workspace settings category to its i18n translation key so the
 * sidebar can render localized section headers via the translation hook.
 *
 * Consumers: `apps/web/core/components/settings/workspace/sidebar/**`.
 */
export const WORKSPACE_SETTINGS_CATEGORY_LABELS: Record<WORKSPACE_SETTINGS_CATEGORY, string> = {
  [WORKSPACE_SETTINGS_CATEGORY.ADMINISTRATION]: "common.administration",
  [WORKSPACE_SETTINGS_CATEGORY.FEATURES]: "common.features",
  [WORKSPACE_SETTINGS_CATEGORY.DEVELOPER]: "common.developer",
};

/**
 * Canonical record of every workspace settings tab keyed by `TWorkspaceSettingsTabs` with route-relative `href`, i18n label, `access` role gate (`EUserWorkspaceRoles`), and exact-pathname `highlight(pathname, baseUrl)` predicate.
 * Consumers: `apps/web/core/components/{settings/workspace,workspace/settings,web-hooks}/**` and the power-k command palette at `apps/web/core/components/power-k/ui/pages/open-entity/workspace-settings-menu.tsx`.
 */
export const WORKSPACE_SETTINGS: Record<TWorkspaceSettingsTabs, TWorkspaceSettingsItem> = {
  general: {
    key: "general",
    i18n_label: "workspace_settings.settings.general.title",
    href: `/settings`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/settings/`,
  },
  members: {
    key: "members",
    i18n_label: "workspace_settings.settings.members.title",
    href: `/settings/members`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/settings/members/`,
  },
  "billing-and-plans": {
    key: "billing-and-plans",
    i18n_label: "workspace_settings.settings.billing_and_plans.title",
    href: `/settings/billing`,
    access: [EUserWorkspaceRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/settings/billing/`,
  },
  export: {
    key: "export",
    i18n_label: "workspace_settings.settings.exports.title",
    href: `/settings/exports`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/settings/exports/`,
  },
  webhooks: {
    key: "webhooks",
    i18n_label: "workspace_settings.settings.webhooks.title",
    href: `/settings/webhooks`,
    access: [EUserWorkspaceRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/settings/webhooks/`,
  },
};

/**
 * Route-href → allowed-roles lookup map, derived from `WORKSPACE_SETTINGS` —
 * used by route guards and middleware to authorize access to workspace settings
 * routes by their pathname rather than by tab key.
 *
 * Consumers: workspace settings access checks in
 * `apps/web/core/components/settings/workspace/**` and route guards in the
 * settings shell at `apps/web/core/components/settings/**`.
 */
export const WORKSPACE_SETTINGS_ACCESS = Object.fromEntries(
  Object.entries(WORKSPACE_SETTINGS).map(([_, { href, access }]) => [href, access])
);

/**
 * Category-bucketed `WORKSPACE_SETTINGS` view (`ADMINISTRATION` = general/members/billing/export, `FEATURES` = empty placeholder, `DEVELOPER` = webhooks) driving sectioned sidebar rendering.
 * Consumers: `apps/web/core/components/settings/workspace/sidebar/**`.
 */
export const GROUPED_WORKSPACE_SETTINGS: Record<WORKSPACE_SETTINGS_CATEGORY, TWorkspaceSettingsItem[]> = {
  [WORKSPACE_SETTINGS_CATEGORY.ADMINISTRATION]: [
    WORKSPACE_SETTINGS["general"],
    WORKSPACE_SETTINGS["members"],
    WORKSPACE_SETTINGS["billing-and-plans"],
    WORKSPACE_SETTINGS["export"],
  ],
  [WORKSPACE_SETTINGS_CATEGORY.FEATURES]: [],
  [WORKSPACE_SETTINGS_CATEGORY.DEVELOPER]: [WORKSPACE_SETTINGS["webhooks"]],
};
