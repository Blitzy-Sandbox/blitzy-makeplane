/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Profile settings tab groups and per-tab metadata consumed by the profile
 * settings shell at `apps/web/core/components/settings/profile/**`.
 */

// plane imports
import type { TProfileSettingsTabs } from "@plane/types";

/**
 * Discriminant for sectioned profile settings sidebar rendering (`YOUR_PROFILE` = personal info/preferences, `DEVELOPER` = API tokens).
 * Consumers: `apps/web/core/components/settings/profile/**` and `apps/web/core/components/profile/settings/**`.
 */
export enum PROFILE_SETTINGS_CATEGORY {
  YOUR_PROFILE = "your profile",
  DEVELOPER = "developer",
}

/**
 * Canonical render order for profile settings categories in the sidebar —
 * `YOUR_PROFILE` first, then `DEVELOPER`.
 *
 * Consumers: `apps/web/core/components/settings/profile/sidebar/**`.
 */
export const PROFILE_SETTINGS_CATEGORIES: PROFILE_SETTINGS_CATEGORY[] = [
  PROFILE_SETTINGS_CATEGORY.YOUR_PROFILE,
  PROFILE_SETTINGS_CATEGORY.DEVELOPER,
];

/**
 * Maps each profile settings category to its i18n translation key so the
 * sidebar can render localized section headers via the translation hook.
 *
 * Consumers: `apps/web/core/components/settings/profile/sidebar/**`.
 */
export const PROFILE_SETTINGS_CATEGORY_LABELS: Record<PROFILE_SETTINGS_CATEGORY, string> = {
  [PROFILE_SETTINGS_CATEGORY.YOUR_PROFILE]: "common.your_profile",
  [PROFILE_SETTINGS_CATEGORY.DEVELOPER]: "common.developer",
};

/**
 * Canonical record of every profile settings tab (`general`/`security`/`preferences`/`notifications`/`api-tokens`) keyed by `TProfileSettingsTabs` with i18n labels for sidebar and content router.
 * Consumers: `apps/web/core/components/{settings/profile,profile/settings}/**` and the power-k command palette at `apps/web/core/components/power-k/ui/pages/open-entity/**`.
 */
export const PROFILE_SETTINGS: Record<
  TProfileSettingsTabs,
  {
    key: TProfileSettingsTabs;
    i18n_label: string;
  }
> = {
  general: {
    key: "general",
    i18n_label: "profile.actions.profile",
  },
  security: {
    key: "security",
    i18n_label: "profile.actions.security",
  },
  preferences: {
    key: "preferences",
    i18n_label: "profile.actions.preferences",
  },
  notifications: {
    key: "notifications",
    i18n_label: "profile.actions.notifications",
  },
  "api-tokens": {
    key: "api-tokens",
    i18n_label: "profile.actions.api-tokens",
  },
};

/**
 * Flat ordered list of profile settings tab keys derived from
 * `PROFILE_SETTINGS` — convenient for `.map()` iteration and tab existence checks.
 *
 * Consumers: `apps/web/core/components/settings/profile/**`.
 */
export const PROFILE_SETTINGS_TABS: TProfileSettingsTabs[] = Object.keys(PROFILE_SETTINGS) as TProfileSettingsTabs[];

/**
 * Category-bucketed `PROFILE_SETTINGS` view (`YOUR_PROFILE` = general/preferences/notifications/security, `DEVELOPER` = api-tokens) driving sectioned sidebar rendering.
 * Consumers: `apps/web/core/components/settings/profile/sidebar/**`.
 */
export const GROUPED_PROFILE_SETTINGS: Record<
  PROFILE_SETTINGS_CATEGORY,
  { key: TProfileSettingsTabs; i18n_label: string }[]
> = {
  [PROFILE_SETTINGS_CATEGORY.YOUR_PROFILE]: [
    PROFILE_SETTINGS["general"],
    PROFILE_SETTINGS["preferences"],
    PROFILE_SETTINGS["notifications"],
    PROFILE_SETTINGS["security"],
  ],
  [PROFILE_SETTINGS_CATEGORY.DEVELOPER]: [PROFILE_SETTINGS["api-tokens"]],
};
