/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Edition-stable empty placeholder for non-community Gantt timeline categories; `./index.ts` spreads this into `GANTT_TIMELINE_TYPE` so the `TTimelineType` union remains well-typed across editions.
 */

/**
 * Extension point for additional Gantt timeline categories beyond `CORE_GANTT_TIMELINE_TYPE`; empty in the community edition, and the `as const` keeps merged literal keys for `TTimelineType` in `./index.ts`.
 */
export const EXTENDED_GANTT_TIMELINE_TYPE = {} as const;
