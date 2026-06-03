/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workflow state contracts for the `@plane/types` package.
 *
 * Models the canonical state-group vocabulary (`TStateGroups`) used for issue
 * lifecycle classification across the platform, plus the project-scoped state
 * entity (`IState`). Mirrors `apps/api/plane/db/models/state.py::State` and is
 * consumed by `apps/web/core/store/state.store.ts`.
 */

/**
 * Canonical state-group vocabulary classifying issue lifecycle.
 *
 * Union values:
 * - `backlog`: not yet planned for work
 * - `unstarted`: planned but no work begun
 * - `started`: in progress
 * - `completed`: done
 * - `cancelled`: closed without completion
 *
 * Every `IState.group` value must be one of these; consumers rely on this
 * enum-like union for board column grouping, default-state heuristics, and
 * analytics buckets.
 */
export type TStateGroups = "backlog" | "unstarted" | "started" | "completed" | "cancelled";

/**
 * Per-project workflow state record.
 *
 * Each project owns its own ordered list of states grouped under one of
 * `TStateGroups`.
 *
 * Fields with non-obvious semantics:
 * - `default`: true marks the state used when no explicit state is assigned at
 *   issue create.
 * - `group`: pins the state to one of the canonical groups (controls analytics
 *   aggregation).
 * - `sequence`: legacy display ordering (use `order` for new code).
 * - `order`: float-typed ordering within the group (used for drag-reorder).
 */
export interface IState {
  readonly id: string;
  color: string;
  default: boolean;
  description: string;
  group: TStateGroups;
  name: string;
  project_id: string;
  sequence: number;
  workspace_id: string;
  order: number;
}

/**
 * Lightweight `IState` projection used in selectors and dropdowns.
 *
 * Strips project/workspace/default fields — keep only the minimum needed to
 * render a state pill or selector option.
 */
export interface IStateLite {
  color: string;
  group: TStateGroups;
  id: string;
  name: string;
}

/**
 * Project state listing response keyed by state group name.
 *
 * Each key in the record is one of `TStateGroups`; the array contains the
 * states belonging to that group in `order` ascending.
 */
export interface IStateResponse {
  [key: string]: IState[];
}

/**
 * Callback contract injected into state-management UI components.
 *
 * Decouples UI from the underlying store/service so the same form components
 * can be reused in different contexts (workspace settings vs. project settings).
 *
 * Callback semantics:
 * - `createState(data)`: creates and returns the new state (server-assigned
 *   id/order).
 * - `updateState(stateId, data)`: returns the updated state or `undefined` if
 *   no diff.
 * - `deleteState(stateId)`: deletes; rejects if state has dependent issues.
 * - `moveStatePosition(stateId, data)`: reorders within the group.
 * - `markStateAsDefault(stateId)`: sets `default: true` on this state (clears
 *   prior default).
 */
export type TStateOperationsCallbacks = {
  createState: (data: Partial<IState>) => Promise<IState>;
  updateState: (stateId: string, data: Partial<IState>) => Promise<IState | undefined>;
  deleteState: (stateId: string) => Promise<void>;
  moveStatePosition: (stateId: string, data: Partial<IState>) => Promise<void>;
  markStateAsDefault: (stateId: string) => Promise<void>;
};
