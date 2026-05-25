/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Conservative SWR preset: no focus/stale revalidation, 10-minute background refresh (`refreshInterval: 600000` ms), 3 retries — used for low-chatter resources (workspace metadata, instance config, reference data).
 * Consumers: opt-in `useSWR` wrappers throughout the `apps/web` data-fetching layer.
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
 * Aggressive SWR preset: revalidates on focus and when stale, 3 retries, no periodic poll — applied as the root `<SWRConfig value={WEB_SWR_CONFIG}>` in `apps/web/app/provider.tsx`.
 * Consumers: default policy for every `useSWR` wrapper under `apps/web` unless overridden per call site.
 */
export const WEB_SWR_CONFIG = {
  refreshWhenHidden: false,
  revalidateIfStale: true,
  revalidateOnFocus: true,
  revalidateOnMount: true,
  errorRetryCount: 3,
};
