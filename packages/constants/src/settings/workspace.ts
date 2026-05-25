/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import type { TWorkspaceSettingsItem, TWorkspaceSettingsTabs } from "@plane/types";
import { EUserWorkspaceRoles } from "@plane/types";

/**
 * Top-level grouping of workspace settings tabs — `ADMINISTRATION`
 * (general/members/billing/export), `FEATURES` (currently empty placeholder
 * for future feature toggles), `DEVELOPER` (webhooks). Drives sectioned
 * sidebar rendering and is used as the discriminant for
 * `GROUPED_WORKSPACE_SETTINGS`.
 *
 * Consumers: `apps/web/core/components/settings/workspace/**` and
 * `apps/web/core/components/workspace/settings/**`.
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
 * Workspace settings registry — the canonical record of every tab on the
 * workspace settings page, keyed by `TWorkspaceSettingsTabs`. Each entry
 * carries a route-relative `href`, an `i18n_label`, an `access` role list
 * (`EUserWorkspaceRoles`) that gates visibility, and a `highlight(pathname,
 * baseUrl)` predicate the sidebar uses to determine the active tab via exact
 * pathname match.
 *
 * Consumers: `apps/web/core/components/settings/workspace/**` (sidebar,
 * content router, tab pages), `apps/web/core/components/workspace/settings/**`,
 * `apps/web/core/components/web-hooks/**`, and the power-k command palette at
 * `apps/web/core/components/power-k/ui/pages/open-entity/workspace-settings-menu.tsx`.
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
 * Category-bucketed view of `WORKSPACE_SETTINGS` — `ADMINISTRATION` holds
 * `general` + `members` + `billing-and-plans` + `export`; `FEATURES` is an
 * empty placeholder for future feature toggles; `DEVELOPER` holds `webhooks`.
 * Drives the sectioned, ordered sidebar rendering.
 *
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
