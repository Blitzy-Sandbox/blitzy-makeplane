/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Timezone descriptor contracts for the `@plane/types` package.
 *
 * Defines the option shape used by timezone pickers in user profile preferences and
 * workspace timezone settings, plus the wrapper used by API responses listing available
 * timezones.
 */

/**
 * Single timezone option for selection UIs.
 *
 * Consumers: `apps/web/core/store/user/profile.store.ts` (user preferences),
 * workspace timezone settings, scheduling/date components in `apps/web`.
 *
 * Fields with non-obvious semantics:
 * - `utc_offset`: signed UTC offset string (e.g. "+05:30"); used for display only.
 * - `gmt_offset`: signed GMT offset string; often identical to `utc_offset`.
 * - `value`: canonical IANA tz identifier (e.g. "Asia/Kolkata") — the persistence key.
 * - `label`: human-readable name shown in the dropdown.
 */
export type TTimezoneObject = {
  utc_offset: string;
  gmt_offset: string;
  label: string;
  value: string;
};

/**
 * API response wrapper for the timezone listing endpoint.
 *
 * Returned by the `apps/api` timezone view (`apps/api/plane/app/views/timezone/base.py`).
 */
export type TTimezones = { timezones: TTimezoneObject[] };
