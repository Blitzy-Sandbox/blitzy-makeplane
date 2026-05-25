/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extended login-medium label registry — the typed placeholder layered on top
 * of `CORE_LOGIN_MEDIUM_LABELS` to host non-core (extended) auth providers in
 * downstream builds. Empty in the community-edition build; the type
 * `Record<TExtendedLoginMediums, string>` keeps the registry exhaustive at
 * compile time so any new `TExtendedLoginMediums` member surfaces as a type
 * error until a label is added.
 *
 * Consumers: `packages/constants/src/auth/index.ts` (composed into
 * `LOGIN_MEDIUM_LABELS`); downstream UI consumers read through that unified
 * map rather than this module directly.
 */

import type { TExtendedLoginMediums } from "@plane/types";

/**
 * Display labels for extended (non-core) authentication mediums. Empty in the
 * community-edition build, populated only when downstream variants extend
 * `TExtendedLoginMediums`. Merged with `CORE_LOGIN_MEDIUM_LABELS` by
 * `index.ts` to produce the unified `LOGIN_MEDIUM_LABELS` map.
 *
 * Consumers: `packages/constants/src/auth/index.ts` (composition site).
 */
export const EXTENDED_LOGIN_MEDIUM_LABELS: Record<TExtendedLoginMediums, string> = {};
