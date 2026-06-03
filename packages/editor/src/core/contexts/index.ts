/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for the collaboration React context exports. The star re-export
 * (`export * from "./collaboration-context"`) auto-syncs the public API
 * surface so additions to or removals from `collaboration-context.tsx`
 * propagate without manual barrel maintenance.
 *
 * Currently re-exported (informational; the star re-export is authoritative):
 *   - `TCollabValue` — non-null collaboration value type.
 *   - `CollaborationProvider` — provider component.
 *   - `useCollaboration` — consumer hook.
 */

export * from "./collaboration-context";
