/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel entry point for the cycle analytics-sidebar feature module.
 *
 * Re-exports the public surface from `./root`, which currently exposes:
 *   - `CycleDetailsSidebar` — the orchestrator React component composing the sidebar
 *     header, metadata, and analytics-progress sections.
 *
 * Consumers should import via the folder path
 * (e.g., `import { CycleDetailsSidebar } from "@/components/cycles/analytics-sidebar"`)
 * rather than reaching into `./root` directly so that the internal file layout can
 * evolve without breaking call sites.
 *
 * Primary consumer:
 *   - `apps/web/core/components/cycles/cycle-peek-overview.tsx`.
 */

export * from "./root";
