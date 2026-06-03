/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core Gantt timeline-category registry feeding `TTimelineTypeCore` in `./index.ts`; consumed by `apps/web/core/hooks/use-timeline-chart.ts` and gantt subtrees under `components/{issues/issue-layouts,modules,base-layouts}/gantt/`.
 */

/**
 * `as const`-frozen Gantt timeline keys (`ISSUE` / `MODULE` / `PROJECT` / `GROUPED`) used by downstream stores/components to discriminate the timeline scope; the `as const` preserves the literal string union for `TTimelineTypeCore`.
 */
export const CORE_GANTT_TIMELINE_TYPE = {
  ISSUE: "ISSUE",
  MODULE: "MODULE",
  PROJECT: "PROJECT",
  GROUPED: "GROUPED",
} as const;
