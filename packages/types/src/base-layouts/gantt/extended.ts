/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Const-asserted placeholder for extended Gantt timeline categories. The
 * community edition has no extended entries; this empty object is reserved
 * for downstream merging into `GANTT_TIMELINE_TYPE` in `./index.ts`.
 *
 * Existing as an empty const keeps the public surface stable across editions:
 * `GANTT_TIMELINE_TYPE` and the `TTimelineType` union in `./index.ts` remain
 * well-typed even when no extended entries are present in this build.
 *
 * Consumers:
 *   - ./index.ts (spreads this into `GANTT_TIMELINE_TYPE`)
 */

/**
 * Extension point for additional Gantt timeline categories beyond the core set
 * (`CORE_GANTT_TIMELINE_TYPE`). Empty in the community edition; downstream
 * editions may add entries that the `TTimelineType` union in `./index.ts`
 * then includes automatically.
 *
 * The `as const` assertion preserves literal-type information so the merged
 * `GANTT_TIMELINE_TYPE` keeps its literal keys.
 */
export const EXTENDED_GANTT_TIMELINE_TYPE = {} as const;
