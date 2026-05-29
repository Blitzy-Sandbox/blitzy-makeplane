/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel entry point for the archived-cycles feature surface; re-exports every
 * symbol from `./root` so consumers can import `ArchivedCycleLayoutRoot` from the
 * folder path rather than reaching into the implementation file.
 *
 * Re-exported surface:
 *   - From `./root`: `ArchivedCycleLayoutRoot` — the MobX-observed route shell for
 *     the project archived-cycles page.
 *
 * The header (`./header`), list view (`./view`), and archive modal (`./modal`) are
 * intentionally NOT re-exported here; callers that need them import the specific
 * file path directly (e.g., the page route imports `ArchivedCyclesHeader` from
 * `@/components/cycles/archived-cycles/header`).
 */

export * from "./root";
