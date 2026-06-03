/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for workspace-scoped member filter state and filtered-id
 * memoization. Owns a single `IMemberFilters` object (not a per-workspace
 * map — workspace context comes from the router with one workspace active at
 * a time) and delegates sort/filter logic to the shared `sortWorkspaceMembers`
 * helper from `../utils`. Pure UI state: holds no service references and
 * issues no `apps/api` HTTP requests; no Redis/RabbitMQ involvement.
 *
 * State slice (observables):
 *   - filters: IMemberFilters — initialized to `{}` on construction. The
 *       `IMemberFilters` shape (`{ order_by?, roles? }`) comes from
 *       `../utils`. Single-instance design (not
 *       `Record<workspaceSlug, IMemberFilters>`) because the router supplies
 *       the active workspace and only one workspace is active at a time, so
 *       per-workspace partitioning is unnecessary. Contrast with
 *       `apps/web/core/store/member/project/project-member-filters.store.ts`,
 *       which keeps a `filtersMap: Record<projectId, IMemberFilters>` because
 *       project filter UI may operate across multiple projects at once.
 *
 * Local types:
 *   - IWorkspaceMembership (file-private) — mirrors the main workspace member
 *       store's normalized membership shape
 *       (`{ id, member, role: EUserPermissions, is_active? }`) so the
 *       `computedFn` selector accepts type-safe inputs without importing the
 *       larger `IWorkspaceMember` type from `@plane/types`.
 *
 * Actions (registered in `makeObservable`):
 *   - updateFilters(filters: Partial<IMemberFilters>) — shallow merge with
 *       existing filters via `{ ...this.filters, ...filters }` so UI callers
 *       can toggle a single facet (e.g. role) without clobbering siblings
 *       (e.g. order_by). No service calls; mutates `this.filters` only.
 *
 * Computed actions (`mobx-utils` `computedFn` — memoized per argument tuple):
 *   - getFilteredMemberIds(members, memberDetailsMap, getMemberKey): string[]
 *       — short-circuits to `[]` when `members` is empty; otherwise delegates
 *       to `sortWorkspaceMembers` from `../utils` (which applies the
 *       `is_active === false` → suspended-member semantic plus role/order
 *       filters) and maps the result back to id strings via `getMemberKey`.
 *       Recomputes when `this.filters`, the `members` reference, or the
 *       `memberDetailsMap` reference changes — callers passing
 *       `this.memberRoot?.memberMap || {}` can emit a fresh `{}` literal on
 *       each call when the optional chain yields nullish, forcing
 *       recomputation.
 *
 * Consumers:
 *   - apps/web/core/store/member/workspace/workspace-member.store.ts —
 *       instantiates `new WorkspaceMemberFiltersStore()` in its constructor
 *       and reads via `this.filtersStore.getFilteredMemberIds(...)` from the
 *       `getFilteredWorkspaceMemberIds` computed action.
 *   - apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/members/page.tsx
 *       — reads `filtersStore.filters` and writes via
 *       `filtersStore.updateFilters({ ... })` from the role-filter UI.
 *   - apps/web/core/components/workspace/settings/members-list.tsx —
 *       indirect consumer: reads `getFilteredWorkspaceMemberIds` from the
 *       parent workspace member store (which delegates to this store).
 */

import { action, makeObservable, observable } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type { EUserPermissions } from "@plane/constants";
import type { IUserLite } from "@plane/types";
// local imports
import type { IMemberFilters } from "../utils";
import { sortWorkspaceMembers } from "../utils";

// Workspace membership interface matching the store structure
interface IWorkspaceMembership {
  id: string;
  member: string;
  role: EUserPermissions;
  is_active?: boolean;
}

export interface IWorkspaceMemberFiltersStore {
  // observables
  filters: IMemberFilters;
  // computed actions
  getFilteredMemberIds: (
    members: IWorkspaceMembership[],
    memberDetailsMap: Record<string, IUserLite>,
    getMemberKey: (member: IWorkspaceMembership) => string
  ) => string[];
  // actions
  updateFilters: (filters: Partial<IMemberFilters>) => void;
}

export class WorkspaceMemberFiltersStore implements IWorkspaceMemberFiltersStore {
  // observables
  filters: IMemberFilters = {};

  constructor() {
    makeObservable(this, {
      // observables
      filters: observable,
      // actions
      updateFilters: action,
    });
  }

  /**
   * @description get filtered and sorted member ids
   * @param members - array of workspace membership objects
   * @param memberDetailsMap - map of member details by user id
   * @param getMemberKey - function to get member key from membership object
   */
  getFilteredMemberIds = computedFn(
    (
      members: IWorkspaceMembership[],
      memberDetailsMap: Record<string, IUserLite>,
      getMemberKey: (member: IWorkspaceMembership) => string
    ): string[] => {
      if (!members || members.length === 0) return [];

      // Apply filters and sorting
      const sortedMembers = sortWorkspaceMembers(members, memberDetailsMap, getMemberKey, this.filters);

      return sortedMembers.map(getMemberKey);
    }
  );

  /**
   * @description update filters
   * @param filters - partial filters to update
   */
  updateFilters = (filters: Partial<IMemberFilters>) => {
    this.filters = { ...this.filters, ...filters };
  };
}
