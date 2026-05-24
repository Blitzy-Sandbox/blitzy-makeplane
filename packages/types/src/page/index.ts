/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for page domain types — re-exports core page entity types from
 * `./core` and extended operation types from `./extended`.
 *
 * Provides a single stable import path for the page type contracts. Type-only;
 * no runtime emission. Consumed by `apps/web/core/store/pages/`,
 * `apps/web/core/components/pages/`, `apps/live/src/services/page/`,
 * and `apps/live/src/extensions/database.ts` (see tech spec §5.2.5 for the
 * collaborative-document persistence sequence that uses these types).
 */

export * from "./core";
export * from "./extended";
