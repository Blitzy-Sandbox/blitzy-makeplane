/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel re-export for the work-item label selector module — exposes
 * {@link IssueLabelSelect} (the project-aware dropdown wrapper) so consumers
 * can import via `@/components/issues/select` rather than the deeper
 * `./dropdown` path.
 */
export * from "./dropdown";
