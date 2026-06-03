/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for workspace-scoped member and invitation orchestration. Owns
 * per-workspace membership and invitation collections, hydrates the shared
 * member registry, and exposes filter, search, and self-aware ordering
 * selectors consumed by workspace settings and issue-property UIs.
 *
 * State slice:
 *   - workspaceMemberMap: Record<string, Record<string, IWorkspaceMembership>>
 *       — outer key: workspaceSlug; inner key: userId. Each membership carries
 *       { id, member, role: EUserPermissions, is_active? }.
 *   - workspaceMemberInvitations: Record<string, IWorkspaceMemberInvitation[]>
 *       — keyed by workspaceSlug; each entry is the array of pending
 *       invitations for that workspace.
 *
 * Dependencies (constructor-injected via the MemberRootStore composition site
 * in `apps/web/core/store/member/index.ts` — `new WorkspaceMemberStore(this, _rootStore)`):
 *   - filtersStore: IWorkspaceMemberFiltersStore — instantiated locally as
 *       `new WorkspaceMemberFiltersStore()`. Single instance because only one
 *       workspace is active at a time (contrast with the per-workspace project
 *       filter store).
 *   - routerStore: IRouterStore — supplies the current `workspaceSlug` for
 *       the active-workspace computed getters; absence returns null.
 *   - userStore: IUserStore — supplies the signed-in user id for self-aware
 *       ordering in getWorkspaceMemberIds.
 *   - memberRoot: IMemberRootStore — fetchWorkspaceMembers hydrates
 *       memberRoot.memberMap with IUserLite payloads so project-scoped
 *       lookups and assignee dropdowns resolve user details without
 *       re-fetching.
 *   - workspaceService: WorkspaceService — Django REST API client from
 *       `@/services/workspace.service`. Per AAP architectural context, member
 *       CRUD calls hit the Django backend directly; Celery via RabbitMQ is
 *       reserved for async work like email and notification fan-out; Redis is
 *       caching and session only.
 *
 * Computed (recompute on observable mutation; return null when no active
 * workspace is resolvable from the router):
 *   - workspaceMemberIds: string[] | null — ordered member ids for the
 *       current workspace; delegates to getWorkspaceMemberIds(workspaceSlug).
 *   - workspaceMemberInvitationIds: string[] | null — invitation ids for the
 *       current workspace.
 *   - memberMap: Record<string, IWorkspaceMembership> | null — raw membership
 *       map for the current workspace.
 *
 * Computed actions (computedFn from mobx-utils — memoized per-argument set):
 *   - getWorkspaceMemberIds(workspaceSlug): string[] — sorts the signed-in
 *       user to the top and excludes bot accounts. WHY: surface the active
 *       user atop member pickers and hide automation accounts from assignee
 *       dropdowns.
 *   - getFilteredWorkspaceMemberIds(workspaceSlug): string[] — delegates to
 *       filtersStore.getFilteredMemberIds which calls sortWorkspaceMembers
 *       from `../utils`. Suspended-member handling (is_active === false)
 *       cascades through this chain.
 *   - getSearchedWorkspaceMemberIds(searchQuery): string[] | null — substring
 *       match across display_name, first_name + last_name, and email applied
 *       over the filtered member set.
 *   - getSearchedWorkspaceInvitationIds(searchQuery): string[] | null —
 *       substring match against invitation email addresses.
 *   - getWorkspaceMemberDetails(workspaceMemberId): IWorkspaceMember | null —
 *       hydrates the membership with IUserLite from memberRoot.memberMap.
 *   - getWorkspaceInvitationDetails(invitationId): IWorkspaceMemberInvitation | null
 *       — invitation lookup keyed by id.
 *   - isUserSuspended(userId, workspaceSlug): boolean — true when the
 *       membership exists with is_active === false (the soft-deletion marker
 *       written by removeMemberFromWorkspace).
 *
 * Actions (each calls a Django REST endpoint via WorkspaceService and mutates
 * state under `runInAction` for atomic batched updates). Mutating actions
 * follow an optimistic-update + rollback pattern — local state is mutated
 * immediately for UI responsiveness, then reverted under `runInAction` if
 * the service call rejects (see updateMember and updateMemberInvitation):
 *   - fetchWorkspaceMembers(workspaceSlug) →
 *       WorkspaceService.fetchWorkspaceMembers. Side effects: normalizes
 *       returned members into IWorkspaceMembership records in
 *       workspaceMemberMap[workspaceSlug] AND hydrates memberRoot.memberMap
 *       with the IUserLite payload for cross-store reuse.
 *   - fetchWorkspaceMemberInvitations(workspaceSlug) →
 *       WorkspaceService.workspaceInvitations. Side effects: populates
 *       workspaceMemberInvitations[workspaceSlug].
 *   - inviteMembersToWorkspace(workspaceSlug, data: IWorkspaceBulkInviteFormData)
 *       — POST bulk invite then refetch invitations.
 *   - updateMember(workspaceSlug, userId, data: { role }) — PATCH role with
 *       optimistic apply + rollback on rejection.
 *   - updateMemberInvitation(workspaceSlug, invitationId, data) — PATCH
 *       invitation with optimistic apply + rollback on rejection.
 *   - removeMemberFromWorkspace(workspaceSlug, userId) — DELETE then set
 *       is_active = false locally. Soft-delete preserves history and aligns
 *       with the isUserSuspended selector.
 *   - deleteMemberInvitation(workspaceSlug, invitationId) — DELETE and
 *       remove the entry from workspaceMemberInvitations[workspaceSlug].
 *
 * Consumers:
 *   - apps/web/core/components/workspace/settings/members-list.tsx
 *       (primary member list view)
 *   - apps/web/core/components/workspace/settings/members-list-item.tsx
 *   - apps/web/core/components/workspace/settings/invitations-list-item.tsx
 *   - apps/web/core/components/workspace/settings/member-columns.tsx
 *   - apps/web/core/components/issues/issue-layouts/filters/header/filters/assignee.tsx
 *   - apps/web/core/components/issues/issue-layouts/filters/header/filters/created-by.tsx
 *   - apps/web/core/components/issues/issue-layouts/filters/header/filters/mentions.tsx
 *   - apps/web/core/components/issues/issue-layouts/filters/applied-filters/members.tsx
 *   - apps/web/core/components/issues/peek-overview/properties.tsx
 *   - apps/web/core/components/issues/peek-overview/issue-detail.tsx
 *   - apps/web/core/store/member/index.ts (composes via
 *       `new WorkspaceMemberStore(this, _rootStore)`)
 */

import { set, sortBy } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type { EUserPermissions } from "@plane/constants";
import type { IWorkspaceBulkInviteFormData, IWorkspaceMember, IWorkspaceMemberInvitation } from "@plane/types";
// plane-web constants
// services
import { WorkspaceService } from "@/services/workspace.service";
// types
import type { IRouterStore } from "@/store/router.store";
import type { IUserStore } from "@/store/user";
// store
import type { IMemberRootStore } from "../index.ts";
import type { IWorkspaceMemberFiltersStore } from "./workspace-member-filters.store";
import { WorkspaceMemberFiltersStore } from "./workspace-member-filters.store";
import type { RootStore } from "@/plane-web/store/root.store";

export interface IWorkspaceMembership {
  id: string;
  member: string;
  role: EUserPermissions;
  is_active?: boolean;
}

export interface IWorkspaceMemberStore {
  // observables
  workspaceMemberMap: Record<string, Record<string, IWorkspaceMembership>>;
  workspaceMemberInvitations: Record<string, IWorkspaceMemberInvitation[]>;
  // filters store
  filtersStore: IWorkspaceMemberFiltersStore;
  // computed
  workspaceMemberIds: string[] | null;
  workspaceMemberInvitationIds: string[] | null;
  memberMap: Record<string, IWorkspaceMembership> | null;
  // computed actions
  getWorkspaceMemberIds: (workspaceSlug: string) => string[];
  getFilteredWorkspaceMemberIds: (workspaceSlug: string) => string[];
  getSearchedWorkspaceMemberIds: (searchQuery: string) => string[] | null;
  getSearchedWorkspaceInvitationIds: (searchQuery: string) => string[] | null;
  getWorkspaceMemberDetails: (workspaceMemberId: string) => IWorkspaceMember | null;
  getWorkspaceInvitationDetails: (invitationId: string) => IWorkspaceMemberInvitation | null;
  // fetch actions
  fetchWorkspaceMembers: (workspaceSlug: string) => Promise<IWorkspaceMember[]>;
  fetchWorkspaceMemberInvitations: (workspaceSlug: string) => Promise<IWorkspaceMemberInvitation[]>;
  // crud actions
  updateMember: (workspaceSlug: string, userId: string, data: { role: EUserPermissions }) => Promise<void>;
  removeMemberFromWorkspace: (workspaceSlug: string, userId: string) => Promise<void>;
  // invite actions
  inviteMembersToWorkspace: (workspaceSlug: string, data: IWorkspaceBulkInviteFormData) => Promise<void>;
  updateMemberInvitation: (
    workspaceSlug: string,
    invitationId: string,
    data: Partial<IWorkspaceMemberInvitation>
  ) => Promise<void>;
  deleteMemberInvitation: (workspaceSlug: string, invitationId: string) => Promise<void>;
  isUserSuspended: (userId: string, workspaceSlug: string) => boolean;
}

export class WorkspaceMemberStore implements IWorkspaceMemberStore {
  // observables
  workspaceMemberMap: {
    [workspaceSlug: string]: Record<string, IWorkspaceMembership>;
  } = {}; // { workspaceSlug: { userId: userDetails } }
  workspaceMemberInvitations: Record<string, IWorkspaceMemberInvitation[]> = {}; // { workspaceSlug: [invitations] }
  // filters store
  filtersStore: IWorkspaceMemberFiltersStore;
  // stores
  routerStore: IRouterStore;
  userStore: IUserStore;
  memberRoot: IMemberRootStore;
  // services
  workspaceService;

  constructor(_memberRoot: IMemberRootStore, _rootStore: RootStore) {
    makeObservable(this, {
      // observables
      workspaceMemberMap: observable,
      workspaceMemberInvitations: observable,
      // computed
      workspaceMemberIds: computed,
      workspaceMemberInvitationIds: computed,
      memberMap: computed,
      // actions
      fetchWorkspaceMembers: action,
      updateMember: action,
      removeMemberFromWorkspace: action,
      fetchWorkspaceMemberInvitations: action,
      updateMemberInvitation: action,
      deleteMemberInvitation: action,
    });
    // initialize filters store
    this.filtersStore = new WorkspaceMemberFiltersStore();
    // root store
    this.routerStore = _rootStore.router;
    this.userStore = _rootStore.user;
    this.memberRoot = _memberRoot;
    // services
    this.workspaceService = new WorkspaceService();
  }

  /**
   * @description get the list of all the user ids of all the members of the current workspace
   */
  get workspaceMemberIds() {
    const workspaceSlug = this.routerStore.workspaceSlug;
    if (!workspaceSlug) return null;

    return this.getWorkspaceMemberIds(workspaceSlug);
  }

  get memberMap() {
    const workspaceSlug = this.routerStore.workspaceSlug;
    if (!workspaceSlug) return null;
    return this.workspaceMemberMap?.[workspaceSlug] ?? {};
  }

  get workspaceMemberInvitationIds() {
    const workspaceSlug = this.routerStore.workspaceSlug;
    if (!workspaceSlug) return null;
    return this.workspaceMemberInvitations?.[workspaceSlug]?.map((inv) => inv.id);
  }

  getWorkspaceMemberIds = computedFn((workspaceSlug: string) => {
    let members = Object.values(this.workspaceMemberMap?.[workspaceSlug] ?? {});
    members = sortBy(members, [
      (m) => m.member !== this.userStore?.data?.id,
      (m) => this.memberRoot?.memberMap?.[m.member]?.display_name?.toLowerCase(),
    ]);
    //filter out bots
    const memberIds = members.filter((m) => !this.memberRoot?.memberMap?.[m.member]?.is_bot).map((m) => m.member);
    return memberIds;
  });

  /**
   * @description get the filtered and sorted list of all the user ids of all the members of the workspace
   * @param workspaceSlug
   */
  getFilteredWorkspaceMemberIds = computedFn((workspaceSlug: string) => {
    let members = Object.values(this.workspaceMemberMap?.[workspaceSlug] ?? {});
    //filter out bots and inactive members
    members = members.filter((m) => !this.memberRoot?.memberMap?.[m.member]?.is_bot);

    // Use filters store to get filtered member ids
    const memberIds = this.filtersStore.getFilteredMemberIds(
      members,
      this.memberRoot?.memberMap || {},
      (member) => member.member
    );

    return memberIds;
  });

  /**
   * @description get the list of all the user ids that match the search query of all the members of the current workspace
   * @param searchQuery
   */
  getSearchedWorkspaceMemberIds = computedFn((searchQuery: string) => {
    const workspaceSlug = this.routerStore.workspaceSlug;
    if (!workspaceSlug) return null;
    const filteredMemberIds = this.getFilteredWorkspaceMemberIds(workspaceSlug);
    if (!filteredMemberIds) return null;
    const searchedWorkspaceMemberIds = filteredMemberIds.filter((userId) => {
      const memberDetails = this.getWorkspaceMemberDetails(userId);
      if (!memberDetails) return false;
      const memberSearchQuery = `${memberDetails.member.first_name} ${memberDetails.member.last_name} ${
        memberDetails.member?.display_name
      } ${memberDetails.member.email ?? ""}`;
      return memberSearchQuery.toLowerCase()?.includes(searchQuery.toLowerCase());
    });
    return searchedWorkspaceMemberIds;
  });

  /**
   * @description get the list of all the invitation ids that match the search query of all the member invitations of the current workspace
   * @param searchQuery
   */
  getSearchedWorkspaceInvitationIds = computedFn((searchQuery: string) => {
    const workspaceSlug = this.routerStore.workspaceSlug;
    if (!workspaceSlug) return null;
    const workspaceMemberInvitationIds = this.workspaceMemberInvitationIds;
    if (!workspaceMemberInvitationIds) return null;
    const searchedWorkspaceMemberInvitationIds = workspaceMemberInvitationIds.filter((invitationId) => {
      const invitationDetails = this.getWorkspaceInvitationDetails(invitationId);
      if (!invitationDetails) return false;
      const invitationSearchQuery = `${invitationDetails.email}`;
      return invitationSearchQuery.toLowerCase()?.includes(searchQuery.toLowerCase());
    });
    return searchedWorkspaceMemberInvitationIds;
  });

  /**
   * @description get the details of a workspace member
   * @param userId
   */
  getWorkspaceMemberDetails = computedFn((userId: string) => {
    const workspaceSlug = this.routerStore.workspaceSlug;
    if (!workspaceSlug) return null;
    const workspaceMember = this.workspaceMemberMap?.[workspaceSlug]?.[userId];
    if (!workspaceMember) return null;

    const memberDetails: IWorkspaceMember = {
      id: workspaceMember.id,
      role: workspaceMember.role,
      member: this.memberRoot?.memberMap?.[workspaceMember.member],
      is_active: workspaceMember.is_active,
    };
    return memberDetails;
  });

  /**
   * @description get the details of a workspace member invitation
   * @param workspaceSlug
   * @param memberId
   */
  getWorkspaceInvitationDetails = computedFn((invitationId: string) => {
    const workspaceSlug = this.routerStore.workspaceSlug;
    if (!workspaceSlug) return null;
    const invitationsList = this.workspaceMemberInvitations?.[workspaceSlug];
    if (!invitationsList) return null;

    const invitation = invitationsList.find((inv) => inv.id === invitationId);
    return invitation ?? null;
  });

  /**
   * @description fetch all the members of a workspace
   * @param workspaceSlug
   */
  fetchWorkspaceMembers = async (workspaceSlug: string) =>
    await this.workspaceService.fetchWorkspaceMembers(workspaceSlug).then((response) => {
      runInAction(() => {
        response.forEach((member) => {
          set(this.memberRoot?.memberMap, member.member.id, { ...member.member, joining_date: member.created_at });
          set(this.workspaceMemberMap, [workspaceSlug, member.member.id], {
            id: member.id,
            member: member.member.id,
            role: member.role,
            is_active: member.is_active,
          });
        });
      });
      return response;
    });

  /**
   * @description update the role of a workspace member
   * @param workspaceSlug
   * @param userId
   * @param data
   */
  updateMember = async (workspaceSlug: string, userId: string, data: { role: EUserPermissions }) => {
    const memberDetails = this.getWorkspaceMemberDetails(userId);
    if (!memberDetails) throw new Error("Member not found");
    // original data to revert back in case of error
    const originalProjectMemberData = { ...this.workspaceMemberMap?.[workspaceSlug]?.[userId] };
    try {
      runInAction(() => {
        set(this.workspaceMemberMap, [workspaceSlug, userId, "role"], data.role);
      });
      await this.workspaceService.updateWorkspaceMember(workspaceSlug, memberDetails.id, data);
    } catch (error) {
      // revert back to original members in case of error
      runInAction(() => {
        set(this.workspaceMemberMap, [workspaceSlug, userId], originalProjectMemberData);
      });
      throw error;
    }
  };

  /**
   * @description remove a member from workspace
   * @param workspaceSlug
   * @param userId
   */
  removeMemberFromWorkspace = async (workspaceSlug: string, userId: string) => {
    const memberDetails = this.getWorkspaceMemberDetails(userId);
    if (!memberDetails) throw new Error("Member not found");
    await this.workspaceService.deleteWorkspaceMember(workspaceSlug, memberDetails?.id).then(() => {
      runInAction(() => {
        set(this.workspaceMemberMap, [workspaceSlug, userId, "is_active"], false);
      });
    });
  };

  /**
   * @description fetch all the member invitations of a workspace
   * @param workspaceSlug
   */
  fetchWorkspaceMemberInvitations = async (workspaceSlug: string) =>
    await this.workspaceService.workspaceInvitations(workspaceSlug).then((response) => {
      runInAction(() => {
        set(this.workspaceMemberInvitations, workspaceSlug, response);
      });
      return response;
    });

  /**
   * @description bulk invite members to a workspace
   * @param workspaceSlug
   * @param data
   */
  inviteMembersToWorkspace = async (workspaceSlug: string, data: IWorkspaceBulkInviteFormData) => {
    const response = await this.workspaceService.inviteWorkspace(workspaceSlug, data);
    await this.fetchWorkspaceMemberInvitations(workspaceSlug);
    return response;
  };

  /**
   * @description update the role of a member invitation
   * @param workspaceSlug
   * @param invitationId
   * @param data
   */
  updateMemberInvitation = async (
    workspaceSlug: string,
    invitationId: string,
    data: Partial<IWorkspaceMemberInvitation>
  ) => {
    const originalMemberInvitations = [...this.workspaceMemberInvitations?.[workspaceSlug]]; // in case of error, we will revert back to original members
    try {
      const memberInvitations = originalMemberInvitations?.map((invitation) => ({
        ...invitation,
        ...(invitation.id === invitationId && data),
      }));
      // optimistic update
      runInAction(() => {
        set(this.workspaceMemberInvitations, workspaceSlug, memberInvitations);
      });
      await this.workspaceService.updateWorkspaceInvitation(workspaceSlug, invitationId, data);
    } catch (error) {
      // revert back to original members in case of error
      runInAction(() => {
        set(this.workspaceMemberInvitations, workspaceSlug, originalMemberInvitations);
      });
      throw error;
    }
  };

  /**
   * @description delete a member invitation
   * @param workspaceSlug
   * @param memberId
   */
  deleteMemberInvitation = async (workspaceSlug: string, invitationId: string) =>
    await this.workspaceService.deleteWorkspaceInvitations(workspaceSlug.toString(), invitationId).then(() => {
      runInAction(() => {
        this.workspaceMemberInvitations[workspaceSlug] = this.workspaceMemberInvitations[workspaceSlug].filter(
          (inv) => inv.id !== invitationId
        );
      });
    });

  isUserSuspended = computedFn((userId: string, workspaceSlug: string) => {
    if (!workspaceSlug) return false;
    const workspaceMember = this.workspaceMemberMap?.[workspaceSlug]?.[userId];
    return workspaceMember?.is_active === false;
  });
}
