/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Boot-time status flags for the self-hosted/cloud Plane instance.
 *
 * Consumers: `apps/admin/**` instance setup pages and `apps/web/core/store/instance.store.ts`
 * which renders an error or "not ready" UI before forwarding to the main app shell.
 *
 * Values:
 * - ERROR: instance failed to initialize or is in an unrecoverable state
 * - NOT_YET_READY: instance config is incomplete and requires admin setup before normal use
 */
export enum EInstanceStatus {
  ERROR = "ERROR",
  NOT_YET_READY = "NOT_YET_READY",
}

/**
 * Payload returned by the instance-status check.
 *
 * - `status`: the current `EInstanceStatus` or `undefined` while the check is in flight
 * - `data`: optional diagnostic payload (e.g., error details) attached by the backend
 *
 * Consumers: `apps/web/core/store/instance.store.ts` and admin app instance gate.
 */
export type TInstanceStatus = {
  status: EInstanceStatus | undefined;
  data?: object;
};
