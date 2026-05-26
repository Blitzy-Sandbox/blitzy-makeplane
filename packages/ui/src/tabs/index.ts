/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Re-exports the `Tabs` and `TabList` components for tabbed-content composition.
 *
 * Public surface:
 *   - `Tabs`, `TabContent`, `TabItem` (from `./tabs`)
 *   - `TabList`, `TabListItem` (from `./tab-list`)
 *
 * Maintains a stable folder-level entry point so consumers can
 * `import { Tabs, TabList } from "@plane/ui"` (via the package root
 * `packages/ui/src/index.ts` star re-export) without depending on the
 * internal file layout of this folder.
 */

export * from "./tabs";
export * from "./tab-list";
