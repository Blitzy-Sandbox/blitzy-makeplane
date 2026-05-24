/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the `@plane/types/layout` Gantt layout subfolder — re-exports
 * every symbol declared in `./gantt.ts` so that consumers can import Gantt block,
 * chart, and view-mode types from a single stable entry point.
 *
 * Consumers: `apps/web/core/components/gantt-chart/`,
 * `apps/web/core/components/issues/issue-layouts/gantt/`,
 * `apps/web/core/components/modules/gantt-chart/`,
 * `apps/web/core/components/base-layouts/gantt/`,
 * `apps/web/core/store/issue/issue_gantt_view.store.ts`,
 * `apps/web/ce/store/timeline/base-timeline.store.ts`.
 */

export * from "./gantt";
