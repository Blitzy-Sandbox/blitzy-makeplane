/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * File-handler configuration alias for CE editor configuration.
 */

/**
 * Object-shaped file-handler placeholder used in extended editor configuration.
 *
 * Typed as `object` (intentionally broad, but stricter than `unknown`) so call
 * sites can type-narrow without coupling to the EE-specific file-handler
 * structure. EE may override to a concrete shape; CE consumers receive a
 * non-`unknown` placeholder that satisfies `object` checks but carries no
 * field constraints.
 *
 * Consumed by `core/types/config.ts` via `@/plane-editor/types/config`.
 */
export type TExtendedFileHandler = object;
