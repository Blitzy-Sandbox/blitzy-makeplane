/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Placeholder empty-state for the project epic layout. Intentionally renders an empty
 * fragment so that the dispatcher in `./index.tsx` has a stable, named target for the
 * `EIssuesStoreType.EPIC` case.
 *
 * No props, no hooks, no side effects.
 *
 * Consumed by: `./index.tsx` (IssueLayoutEmptyState) when storeType === EPIC.
 *
 * // INTENT UNCLEAR: empty fragment may be a deliberate "no empty UI" choice or a
 * // placeholder pending epic-specific empty-state design — observed behavior only.
 */

/**
 * Renders nothing — empty React fragment.
 *
 * Props: none.
 *
 * @returns Empty React fragment.
 */
export function ProjectEpicsEmptyState() {
  return <></>;
}
