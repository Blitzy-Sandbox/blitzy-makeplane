/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import type { TProfileSettingsTabs } from "@plane/types";

/**
 * Top-level grouping of profile settings tabs — `YOUR_PROFILE` holds personal
 * info and preferences; `DEVELOPER` holds developer-facing tabs (API tokens).
 * Used as the discriminant for sectioned rendering in the profile settings sidebar.
 *
 * Consumers: `apps/web/core/components/settings/profile/**` and
 * `apps/web/core/components/profile/settings/**`.
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
 * Profile settings registry — the canonical record of every tab on the profile
 * settings page, keyed by `TProfileSettingsTabs` (`general`, `security`,
 * `preferences`, `notifications`, `api-tokens`). Each entry pairs a route key
 * with its i18n label token used by the sidebar and tab content router.
 *
 * Consumers: `apps/web/core/components/settings/profile/**` (sidebar, content
 * router, tab pages), `apps/web/core/components/profile/settings/**`, and the
 * power-k command palette at
 * `apps/web/core/components/power-k/ui/pages/open-entity/**`.
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
 * Category-bucketed view of `PROFILE_SETTINGS` — `YOUR_PROFILE` holds
 * `general` + `preferences` + `notifications` + `security`; `DEVELOPER` holds
 * `api-tokens`. Drives the sectioned, ordered sidebar rendering.
 *
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
