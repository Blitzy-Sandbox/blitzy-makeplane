/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Conservative SWR revalidation preset — no auto-refresh on window focus or
 * stale data, background refresh every 10 minutes (`refreshInterval: 600000` ms),
 * and up to 3 retries on error.
 *
 * Use this for read-heavy resources where stale data is acceptable and noisy
 * refetches are undesirable (e.g., workspace metadata, instance configuration,
 * rarely changing reference data).
 *
 * Consumers: `useSWR` wrappers throughout the `apps/web` data-fetching layer
 * (and other frontend apps) that opt into a low-chatter revalidation policy.
 */
export const DEFAULT_SWR_CONFIG = {
  refreshWhenHidden: false,
  revalidateIfStale: false,
  revalidateOnFocus: false,
  revalidateOnMount: true,
  refreshInterval: 600000,
  errorRetryCount: 3,
};

/**
 * Aggressive SWR revalidation preset — revalidates on window focus AND when
 * data is stale, with up to 3 retries on error. No `refreshInterval` is set,
 * so periodic polling is opt-in per `useSWR` call site.
 *
 * Use this for resources where freshness on tab return matters (e.g., issue
 * lists, notifications, dashboards, cycle/module views).
 *
 * Consumers: applied as the root `<SWRConfig value={WEB_SWR_CONFIG}>` in
 * `apps/web/app/provider.tsx`, so it is the default policy for every `useSWR`
 * wrapper under the `apps/web` data-fetching layer unless individually overridden.
 */
export const WEB_SWR_CONFIG = {
  refreshWhenHidden: false,
  revalidateIfStale: true,
  revalidateOnFocus: true,
  revalidateOnMount: true,
  errorRetryCount: 3,
};
