/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Dispatches to the context-specific issue-layout empty-state component based on the
 * provided `EIssuesStoreType`. This module is the single entry point used by
 * `issue-layouts/issue-layout-HOC.tsx` when an issue layout resolves to zero items
 * (non-CALENDAR layouts) for the active issue context.
 *
 * Dispatch contract (storeType -> rendered component):
 *   - PROJECT                  -> ProjectEmptyState              (./project-issues)
 *   - PROJECT_VIEW             -> ProjectViewEmptyState          (./project-view)
 *   - ARCHIVED                 -> ProjectArchivedEmptyState      (./archived-issues)
 *   - CYCLE                    -> CycleEmptyState                (./cycle)
 *   - MODULE                   -> ModuleEmptyState               (./module)
 *   - GLOBAL                   -> GlobalViewEmptyState           (./global-view)
 *   - PROFILE                  -> ProfileViewEmptyState          (./profile-view)
 *   - EPIC                     -> ProjectEpicsEmptyState         (./project-epic)
 *   - TEAM                     -> TeamEmptyState                 (@/plane-web .../team-issues)
 *   - TEAM_VIEW                -> TeamViewEmptyState             (@/plane-web .../team-view-issues)
 *   - TEAM_PROJECT_WORK_ITEMS  -> TeamProjectWorkItemEmptyState  (@/plane-web .../team-project)
 *   - Unrecognized storeType   -> null
 *
 * Architectural notes:
 *   - No MobX state is read at this level; each dispatched child component owns its own
 *     store reads, permission checks, navigations, and API/mutation side effects. Keeping
 *     the dispatcher pure lets the consumer HOC stay independent of any specific store slice.
 *   - The mapping is exhaustive for known `EIssuesStoreType` values listed above; the
 *     `default` branch returns `null` as a defensive fallback for unrecognized values.
 *
 * Consumers:
 *   - apps/web/core/components/issues/issue-layouts/issue-layout-HOC.tsx renders
 *     `<IssueLayoutEmptyState storeType={...} />` when
 *     `issues.getGroupIssueCount(...) === 0 && layout !== EIssueLayoutTypes.CALENDAR`;
 *     `storeType` is derived from `useIssueStoreType()` in the same HOC.
 */

// plane web components
import { EIssuesStoreType } from "@plane/types";
import { TeamEmptyState } from "@/plane-web/components/issues/issue-layouts/empty-states/team-issues";
import { TeamProjectWorkItemEmptyState } from "@/plane-web/components/issues/issue-layouts/empty-states/team-project";
import { TeamViewEmptyState } from "@/plane-web/components/issues/issue-layouts/empty-states/team-view-issues";
// components
import { ProjectArchivedEmptyState } from "./archived-issues";
import { CycleEmptyState } from "./cycle";
import { GlobalViewEmptyState } from "./global-view";
import { ModuleEmptyState } from "./module";
import { ProfileViewEmptyState } from "./profile-view";
import { ProjectEpicsEmptyState } from "./project-epic";
import { ProjectEmptyState } from "./project-issues";
import { ProjectViewEmptyState } from "./project-view";

interface Props {
  storeType: EIssuesStoreType;
}

/**
 * Renders the empty-state UI matching the active issue store context.
 *
 * The function is a pure switch on `props.storeType` and reads no MobX stores itself;
 * the dispatched child component is responsible for any subscriptions, permission
 * checks, navigations, mutations, and API calls. See the module-level JSDoc for the
 * full storeType -> component mapping and the upstream consumer reference.
 *
 * @param props - Component props.
 * @param props.storeType - Required. Discriminant of the active issue context (e.g.
 *   `PROJECT`, `PROJECT_VIEW`, `ARCHIVED`, `CYCLE`, `MODULE`, `GLOBAL`, `PROFILE`,
 *   `EPIC`, `TEAM`, `TEAM_VIEW`, `TEAM_PROJECT_WORK_ITEMS`). Supplied by the parent
 *   HOC via `useIssueStoreType()`.
 * @returns The context-specific empty-state React element, or `null` when the
 *   `storeType` does not match any registered case (defensive fallback).
 */
export function IssueLayoutEmptyState(props: Props) {
  switch (props.storeType) {
    case EIssuesStoreType.PROJECT:
      return <ProjectEmptyState />;
    case EIssuesStoreType.PROJECT_VIEW:
      return <ProjectViewEmptyState />;
    case EIssuesStoreType.ARCHIVED:
      return <ProjectArchivedEmptyState />;
    case EIssuesStoreType.CYCLE:
      return <CycleEmptyState />;
    case EIssuesStoreType.MODULE:
      return <ModuleEmptyState />;
    case EIssuesStoreType.GLOBAL:
      return <GlobalViewEmptyState />;
    case EIssuesStoreType.PROFILE:
      return <ProfileViewEmptyState />;
    case EIssuesStoreType.EPIC:
      return <ProjectEpicsEmptyState />;
    case EIssuesStoreType.TEAM:
      return <TeamEmptyState />;
    case EIssuesStoreType.TEAM_VIEW:
      return <TeamViewEmptyState />;
    case EIssuesStoreType.TEAM_PROJECT_WORK_ITEMS:
      return <TeamProjectWorkItemEmptyState />;
    default:
      return null;
  }
}
