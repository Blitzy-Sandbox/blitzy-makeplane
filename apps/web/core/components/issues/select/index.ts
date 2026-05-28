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
 *
 * Consumers:
 *   - `../issue-modal/components/default-properties.tsx` — uses `IssueLabelSelect` in the
 *     create/update work-item modal's properties row.
 *   - `apps/web/core/components/inbox/modals/create-modal/issue-properties.tsx` — uses
 *     `IssueLabelSelect` in the inbox create-modal's properties row.
 */
export * from "./dropdown";
