/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Intake (issue-triage) workflow state contracts — narrow projection of
 * `State` rows whose `group=StateGroup.TRIAGE` in `apps/api/plane/db/models/state.py`;
 * fetched on a separate code path (`fetchProjectIntakeState`/`intakeStateMap`)
 * from the broader `IState`.
 */

/**
 * Intake state-group identifiers (currently just `"triage"`, mirroring
 * `StateGroup.TRIAGE`); kept as a named alias so additional intake groupings
 * can be added in one place if introduced upstream.
 */
export type TIntakeStateGroups = "triage";

/**
 * Single intake state record for a project (mirrors `State` rows filtered to
 * `group=StateGroup.TRIAGE` in `apps/api/plane/db/models/state.py`); consumed
 * by `state.store.ts:intakeStateMap` and the intake-state dropdown.
 */
export interface IIntakeState {
  /** Server-assigned UUID for the state row; immutable for the record's lifetime. */
  readonly id: string;
  color: string;
  /**
   * Marks this row as the project's default intake state — at most one record per
   * project's intake-state set carries `true`, and consumers use it to pre-select
   * the landing state for newly created intake issues.
   */
  default: boolean;
  description: string;
  /**
   * Discriminant identifying the workflow-state group; for intake records this is
   * always `"triage"`. See {@link TIntakeStateGroups} for the canonical value set.
   */
  group: TIntakeStateGroups;
  name: string;
  project_id: string;
  /** Ordering key for sorting intake states within a project; lower values render first. */
  sequence: number;
  workspace_id: string;
}
