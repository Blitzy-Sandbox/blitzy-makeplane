/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Intake-domain TypeScript contracts for the `@plane/types/intake` subfolder.
 *
 * Models the triage-classified workflow state records that drive Plane's intake
 * (issue-triage) experience — i.e. project `State` rows whose `group` is the
 * `TRIAGE` value of `apps/api/plane/db/models/state.py::StateGroup`. These are
 * the narrow projection of the broader `IState` workflow-state shape; here only
 * the triage subset is modelled because it is fetched and stored on its own code
 * path (`fetchProjectIntakeState` / `intakeStateMap`).
 *
 * Consumers:
 *  - `apps/web/core/store/state.store.ts` (`intakeStateMap` + accessors + fetcher)
 *  - `apps/web/core/services/project/project-state.service.ts` (HTTP client)
 *  - `apps/web/core/components/dropdowns/intake-state/base.tsx` (selector UI)
 *  - `packages/propel/src/icons/state/` (group-keyed color and icon mappings)
 */

/**
 * Union of valid state-group identifiers for intake (issue-triage) workflow states.
 *
 * Valid values: `"triage"`. Mirrors the `StateGroup.TRIAGE` value declared on
 * `apps/api/plane/db/models/state.py`; kept as a named alias (rather than an inline
 * `"triage"` literal) so the vocabulary stays centrally controlled and additional
 * intake groupings can be added in one place if introduced upstream. Used as the
 * discriminant for {@link IIntakeState.group} and as the key set for the
 * `INTAKE_STATE_GROUP_COLORS` lookup in `packages/propel/src/icons/state/helper.tsx`.
 */
export type TIntakeStateGroups = "triage";

/**
 * Canonical shape of a single intake (issue-triage) state record for a project, as
 * returned by the Django backend's project intake-state endpoints (mirrors the
 * `State` row in `apps/api/plane/db/models/state.py` filtered to
 * `group == StateGroup.TRIAGE`).
 *
 * Consumers:
 *  - `apps/web/core/store/state.store.ts` — `intakeStateMap`, `getIntakeStateById`,
 *    `getProjectIntakeState`, `fetchProjectIntakeState`
 *  - `apps/web/core/services/project/project-state.service.ts` — `getIntakeState`
 *    API client method
 *  - `apps/web/core/components/dropdowns/intake-state/base.tsx` — `getStateById`
 *    prop type for the intake-state dropdown
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
