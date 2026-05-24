/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Const-asserted registry of the core Gantt timeline categories used by the
 * package's public Gantt typing API.
 *
 * The `as const` assertion preserves literal-type information so `./index.ts`
 * can derive the `TTimelineTypeCore` string-literal union from this object
 * rather than widening each value to `string`.
 *
 * Consumers (via the `@plane/types` re-export chain):
 *   - ./index.ts (composes `GANTT_TIMELINE_TYPE` and `TTimelineTypeCore`)
 *   - apps/web/core/hooks/use-timeline-chart.ts
 *   - apps/web/core/components/issues/issue-layouts/gantt/
 *   - apps/web/core/components/modules/gantt-chart/
 *   - apps/web/core/components/base-layouts/gantt/
 */

/**
 * Enumeration of the core Gantt timeline keys used by downstream stores and
 * components to discriminate the timeline scope being rendered.
 *
 * Valid values:
 *   - ISSUE: "ISSUE"     — single-issue Gantt timeline
 *   - MODULE: "MODULE"   — single-module Gantt timeline
 *   - PROJECT: "PROJECT" — project-level Gantt timeline
 *   - GROUPED: "GROUPED" — grouped/multi-row Gantt timeline (e.g., cycles grouped by parent)
 *
 * The `as const` assertion preserves these literal values so `TTimelineTypeCore`
 * and `TTimelineType` in `./index.ts` resolve to a string-literal union.
 */
export const CORE_GANTT_TIMELINE_TYPE = {
  ISSUE: "ISSUE",
  MODULE: "MODULE",
  PROJECT: "PROJECT",
  GROUPED: "GROUPED",
} as const;
