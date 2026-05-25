/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TStateGroups } from "@plane/types";

/**
 * Drag-and-drop payload type carried while dragging a workflow state row between
 * state groups in the project state settings.
 *
 * Consumers: `apps/web/core/components/states/**` drag-drop handlers.
 */
export type TDraggableData = {
  groupKey: TStateGroups;
  id: string;
};

/**
 * Canonical metadata for each workflow state group (backlog/unstarted/started/
 * completed/cancelled) — labels, default state name created when a new project
 * is provisioned, and color tokens.
 *
 * Mirrors the state-group set defined in `apps/api/plane/db/models/state.py`.
 *
 * Consumers: `apps/web/core/components/states/**` state-group headers and the
 * state distribution renderer in dashboards/cycles/modules.
 */
export const STATE_GROUPS: {
  [key in TStateGroups]: {
    key: TStateGroups;
    label: string;
    defaultStateName: string;
    color: string;
  };
} = {
  backlog: {
    key: "backlog",
    label: "Backlog",
    defaultStateName: "Backlog",
    color: "#d9d9d9",
  },
  unstarted: {
    key: "unstarted",
    label: "Unstarted",
    defaultStateName: "Todo",
    color: "#3f76ff",
  },
  started: {
    key: "started",
    label: "Started",
    defaultStateName: "In Progress",
    color: "#f59e0b",
  },
  completed: {
    key: "completed",
    label: "Completed",
    defaultStateName: "Done",
    color: "#16a34a",
  },
  cancelled: {
    key: "cancelled",
    label: "Canceled",
    defaultStateName: "Cancelled",
    color: "#dc2626",
  },
};

/**
 * State-group keys whose issues are eligible for archival (completed + cancelled).
 * Consumers: bulk archive flows in `apps/web/core/components/issues/**`.
 */
export const ARCHIVABLE_STATE_GROUPS = [STATE_GROUPS.completed.key, STATE_GROUPS.cancelled.key];
/**
 * State-group keys whose issues count as "completed" for progress/burn-down metrics.
 * Consumers: cycle/module progress calculations in `apps/web/core/store/**`.
 */
export const COMPLETED_STATE_GROUPS = [STATE_GROUPS.completed.key];
/**
 * State-group keys whose issues count as "pending" — backlog/unstarted/started/cancelled.
 * Note: `cancelled` is intentionally included in pending for dashboard "not yet
 * completed" buckets.
 *
 * Consumers: dashboard pending-issues widgets in `apps/web/core/components/dashboard/**`.
 */
export const PENDING_STATE_GROUPS = [
  STATE_GROUPS.backlog.key,
  STATE_GROUPS.unstarted.key,
  STATE_GROUPS.started.key,
  STATE_GROUPS.cancelled.key,
];

/**
 * Distribution payload-field mapping per state group — names the API response keys
 * that hold the issue count and estimate-point total for that group (used by the
 * dashboard/cycle/module distribution charts).
 *
 * Consumers: cycle/module distribution widgets in `apps/web/core/components/**`.
 */
export const STATE_DISTRIBUTION = {
  [STATE_GROUPS.backlog.key]: {
    key: STATE_GROUPS.backlog.key,
    issues: "backlog_issues",
    points: "backlog_estimate_points",
  },
  [STATE_GROUPS.unstarted.key]: {
    key: STATE_GROUPS.unstarted.key,
    issues: "unstarted_issues",
    points: "unstarted_estimate_points",
  },
  [STATE_GROUPS.started.key]: {
    key: STATE_GROUPS.started.key,
    issues: "started_issues",
    points: "started_estimate_points",
  },
  [STATE_GROUPS.completed.key]: {
    key: STATE_GROUPS.completed.key,
    issues: "completed_issues",
    points: "completed_estimate_points",
  },
  [STATE_GROUPS.cancelled.key]: {
    key: STATE_GROUPS.cancelled.key,
    issues: "cancelled_issues",
    points: "cancelled_estimate_points",
  },
};

/**
 * Progress-chart legend entries — title + color for each state group rendered in
 * progress bars and distribution donuts.
 */
export const PROGRESS_STATE_GROUPS_DETAILS = [
  {
    key: "completed_issues",
    title: "Completed",
    color: "#16A34A",
  },
  {
    key: "started_issues",
    title: "Started",
    color: "#F59E0B",
  },
  {
    key: "unstarted_issues",
    title: "Unstarted",
    color: "#3A3A3A",
  },
  {
    key: "backlog_issues",
    title: "Backlog",
    color: "#A3A3A3",
  },
];

/**
 * Feature flag that hides the workflow-pro CTA in the state settings page when set
 * to `false`. Set to `true` to surface the upgrade prompt for advanced workflow features.
 *
 * Consumers: `apps/web/core/components/states/**`.
 */
export const DISPLAY_WORKFLOW_PRO_CTA = false;
