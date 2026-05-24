/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Settings page navigation contracts for the `@plane/types` package.
 *
 * Models the tab identifiers and per-tab descriptor shapes used by the profile,
 * workspace, and project settings sidebars in `apps/web/app/`. Each descriptor pairs
 * a tab key with its localized label, route, allowed roles, and active-route highlight predicate.
 *
 * Build-time note: `apps/web` is a Vite-bundled React Router v7 app; `import.meta.env.VITE_*`
 * env vars referenced by these settings pages are baked in at build time, not runtime.
 */

// local imports
import type { EUserProjectRoles } from ".";
import type { EUserWorkspaceRoles } from "./workspace";

/**
 * Profile settings tab identifiers (per-user, not per-workspace).
 *
 * Union values:
 * - `general`: profile name/avatar/timezone
 * - `preferences`: theme, language, week-start
 * - `notifications`: in-app + email notification preferences
 * - `security`: password, sessions, sign-in methods
 * - `api-tokens`: personal API tokens
 */
export type TProfileSettingsTabs = "general" | "preferences" | "notifications" | "security" | "api-tokens";

/**
 * Workspace-level settings tab identifiers.
 *
 * Union values:
 * - `general`: workspace name/logo/url-slug
 * - `members`: invite/manage workspace members
 * - `billing-and-plans`: subscription tier and seat management (Plane Cloud)
 * - `export`: workspace data export
 * - `webhooks`: webhook subscriptions
 */
export type TWorkspaceSettingsTabs = "general" | "members" | "billing-and-plans" | "export" | "webhooks";
/**
 * Single workspace-settings tab descriptor.
 *
 * Fields:
 * - `key`: tab identifier (matches one of `TWorkspaceSettingsTabs`)
 * - `i18n_label`: localization key for the tab label
 * - `href`: route path
 * - `access`: workspace roles allowed to see this tab (gating)
 * - `highlight(pathname, baseUrl)`: returns true when this tab should appear active
 */
export type TWorkspaceSettingsItem = {
  key: TWorkspaceSettingsTabs;
  i18n_label: string;
  href: string;
  access: EUserWorkspaceRoles[];
  highlight: (pathname: string, baseUrl: string) => boolean;
};

/**
 * Project-level settings tab identifiers.
 *
 * Union values include core management tabs (`general`, `members`), feature toggles
 * (`features_cycles`, `features_modules`, `features_views`, `features_pages`, `features_intake`),
 * and workflow vocabulary (`states`, `labels`, `estimates`, `automations`).
 */
export type TProjectSettingsTabs =
  | "general"
  | "members"
  | "features_cycles"
  | "features_modules"
  | "features_views"
  | "features_pages"
  | "features_intake"
  | "states"
  | "labels"
  | "estimates"
  | "automations";
/**
 * Single project-settings tab descriptor.
 *
 * Mirrors `TWorkspaceSettingsItem` but with `access` restricted to project roles.
 */
export type TProjectSettingsItem = {
  key: TProjectSettingsTabs;
  i18n_label: string;
  href: string;
  access: EUserProjectRoles[];
  highlight: (pathname: string, baseUrl: string) => boolean;
};
