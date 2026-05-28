/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public entry point for the work item preview card module — re-exports every
 * symbol from `./root` (currently `WorkItemPreviewCard`) so consumers can import
 * via the folder path without coupling to the implementation filename.
 *
 * Consumers:
 *   - `../issue-layouts/calendar/issue-block.tsx` — wraps the calendar issue block as a
 *     hover-preview tooltip
 *   - `../issue-layouts/gantt/blocks.tsx` — wraps the gantt issue blocks as a hover-preview
 *     tooltip
 */
export * from "./root";
