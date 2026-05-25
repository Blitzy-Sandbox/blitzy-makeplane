/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project settings tab groups, per-tab metadata, and role-based access maps
 * consumed by the project settings shell at
 * `apps/web/core/components/settings/project/**`.
 */

// plane imports
import { EUserProjectRoles } from "@plane/types";
import type { TProjectSettingsItem, TProjectSettingsTabs } from "@plane/types";

/**
 * Discriminant for sectioned project settings sidebar (`GENERAL`/`FEATURES`/`WORK_STRUCTURE`/`EXECUTION`) used by `GROUPED_PROJECT_SETTINGS`.
 * Consumers: `apps/web/core/components/{settings/project,project/settings}/**`.
 */
export enum PROJECT_SETTINGS_CATEGORY {
  GENERAL = "general",
  FEATURES = "features",
  WORK_STRUCTURE = "work-structure",
  EXECUTION = "execution",
}

/**
 * Canonical render order for project settings categories in the sidebar —
 * `GENERAL` → `FEATURES` → `WORK_STRUCTURE` → `EXECUTION`.
 *
 * Consumers: `apps/web/core/components/settings/project/sidebar/**`.
 */
export const PROJECT_SETTINGS_CATEGORIES: PROJECT_SETTINGS_CATEGORY[] = [
  PROJECT_SETTINGS_CATEGORY.GENERAL,
  PROJECT_SETTINGS_CATEGORY.FEATURES,
  PROJECT_SETTINGS_CATEGORY.WORK_STRUCTURE,
  PROJECT_SETTINGS_CATEGORY.EXECUTION,
];

/**
 * Maps each project settings category to its i18n translation key so the
 * sidebar can render localized section headers via the translation hook.
 *
 * Consumers: `apps/web/core/components/settings/project/sidebar/**`.
 */
export const PROJECT_SETTINGS_CATEGORY_LABELS: Record<PROJECT_SETTINGS_CATEGORY, string> = {
  [PROJECT_SETTINGS_CATEGORY.GENERAL]: "common.general",
  [PROJECT_SETTINGS_CATEGORY.FEATURES]: "common.features",
  [PROJECT_SETTINGS_CATEGORY.WORK_STRUCTURE]: "common.work_structure",
  [PROJECT_SETTINGS_CATEGORY.EXECUTION]: "common.execution",
};

/**
 * Canonical record of every project settings tab keyed by `TProjectSettingsTabs` with route-relative `href`, i18n label, `access` role gate (`EUserProjectRoles`), and exact-pathname `highlight(pathname, baseUrl)` predicate for active-tab matching.
 * Consumers: `apps/web/core/components/{settings/project,project/settings}/**` and the power-k command palette at `apps/web/core/components/power-k/ui/pages/open-entity/project-settings-menu.tsx`.
 */
export const PROJECT_SETTINGS: Record<TProjectSettingsTabs, TProjectSettingsItem> = {
  general: {
    key: "general",
    i18n_label: "common.general",
    href: ``,
    access: [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER, EUserProjectRoles.GUEST],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/`,
  },
  members: {
    key: "members",
    i18n_label: "common.members",
    href: `/members`,
    access: [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER, EUserProjectRoles.GUEST],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/members/`,
  },
  features_cycles: {
    key: "features_cycles",
    i18n_label: "project_settings.features.cycles.short_title",
    href: `/features/cycles`,
    access: [EUserProjectRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/features/cycles/`,
  },
  features_modules: {
    key: "features_modules",
    i18n_label: "project_settings.features.modules.short_title",
    href: `/features/modules`,
    access: [EUserProjectRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/features/modules/`,
  },
  features_views: {
    key: "features_views",
    i18n_label: "project_settings.features.views.short_title",
    href: `/features/views`,
    access: [EUserProjectRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/features/views/`,
  },
  features_pages: {
    key: "features_pages",
    i18n_label: "project_settings.features.pages.short_title",
    href: `/features/pages`,
    access: [EUserProjectRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/features/pages/`,
  },
  features_intake: {
    key: "features_intake",
    i18n_label: "project_settings.features.intake.short_title",
    href: `/features/intake`,
    access: [EUserProjectRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/features/intake/`,
  },
  states: {
    key: "states",
    i18n_label: "common.states",
    href: `/states`,
    access: [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/states/`,
  },
  labels: {
    key: "labels",
    i18n_label: "common.labels",
    href: `/labels`,
    access: [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/labels/`,
  },
  estimates: {
    key: "estimates",
    i18n_label: "common.estimates",
    href: `/estimates`,
    access: [EUserProjectRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/estimates/`,
  },
  automations: {
    key: "automations",
    i18n_label: "project_settings.automations.label",
    href: `/automations`,
    access: [EUserProjectRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/automations/`,
  },
};

/**
 * Flat ordered list of project settings items derived from `PROJECT_SETTINGS` —
 * convenient for `.map()` iteration, access checks, and route matching loops.
 *
 * Consumers: `apps/web/core/components/settings/project/**` and
 * `apps/web/core/components/project/settings/**`.
 */
export const PROJECT_SETTINGS_FLAT_MAP: TProjectSettingsItem[] = Object.values(PROJECT_SETTINGS);

/**
 * Category-bucketed `PROJECT_SETTINGS` view (`GENERAL` = general/members, `FEATURES` = five `features_*`, `WORK_STRUCTURE` = states/labels/estimates, `EXECUTION` = automations) driving sectioned sidebar rendering.
 * Consumers: `apps/web/core/components/settings/project/sidebar/**`.
 */
export const GROUPED_PROJECT_SETTINGS: Record<PROJECT_SETTINGS_CATEGORY, TProjectSettingsItem[]> = {
  [PROJECT_SETTINGS_CATEGORY.GENERAL]: [PROJECT_SETTINGS["general"], PROJECT_SETTINGS["members"]],
  [PROJECT_SETTINGS_CATEGORY.FEATURES]: [
    PROJECT_SETTINGS["features_cycles"],
    PROJECT_SETTINGS["features_modules"],
    PROJECT_SETTINGS["features_views"],
    PROJECT_SETTINGS["features_pages"],
    PROJECT_SETTINGS["features_intake"],
  ],
  [PROJECT_SETTINGS_CATEGORY.WORK_STRUCTURE]: [
    PROJECT_SETTINGS["states"],
    PROJECT_SETTINGS["labels"],
    PROJECT_SETTINGS["estimates"],
  ],
  [PROJECT_SETTINGS_CATEGORY.EXECUTION]: [PROJECT_SETTINGS["automations"]],
};
