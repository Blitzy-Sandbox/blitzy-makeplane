/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Pre-launch waitlist response contracts for the `@plane/types` package.
 *
 * Models the response payload returned by the instance setup waitlist sign-up endpoint
 * consumed during early-access onboarding flows.
 */

/**
 * Response envelope for waitlist sign-up API calls.
 *
 * Consumers: instance setup/onboarding screens in `apps/admin` and `apps/web` that
 * gate features behind early-access registration.
 */
export interface IWebWaitListResponse {
  // INTENT UNCLEAR: status string format (e.g. "success" / "joined" / "already-registered" not visible from this file alone)
  status: string;
}
