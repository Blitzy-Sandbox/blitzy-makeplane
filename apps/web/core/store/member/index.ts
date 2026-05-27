/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Member domain composition root: owns the global lightweight user cache and
 * composes the workspace + project member sub-stores. Provides the single
 * source of truth for resolving `userId` strings into `IUserLite` profile
 * details across every member-aware feature.
 *
 * State slice:
 *   - memberMap: Record<string, IUserLite> — lightweight user-profile cache
 *       keyed by user id. Hydrated incrementally by the workspace + project
 *       sub-stores' fetch actions as they receive embedded `member` payloads
 *       from the backend; never fetched directly from this root.
 *
 * Computed actions (computedFn from mobx-utils — memoized per-argument):
 *   - getMemberIds(): string[] — returns Object.keys(memberMap); recomputes
 *       when memberMap keys change. Used wherever a "list of all known user
 *       ids" is needed.
 *   - getUserDetails(userId: string): IUserLite | undefined — O(1) lookup
 *       into memberMap; recomputes when memberMap[userId] changes. Returns
 *       undefined for unknown users (callers must handle the missing case).
 *
 * Sub-stores (instantiated in the constructor with `this` and the root
 * RootStore so each sub-store can resolve cross-store dependencies):
 *   - workspace: IWorkspaceMemberStore — workspace member registry +
 *       invitations (./workspace/workspace-member.store)
 *   - project: IProjectMemberStore — project member registry; resolves to
 *       the plane-web ProjectMemberStore subclass which extends the base
 *       store in ./project/base-project-member.store.ts
 *
 * Consumers:
 *   - apps/web/core/store/root.store.ts (instantiates as `memberRoot`)
 *   - apps/web/core/hooks/store/use-member.ts (useMember() hook)
 *   - apps/web/core/components/workspace/settings/** (members list, invitations)
 *   - apps/web/core/components/project/settings/** (project members)
 *   - apps/web/core/components/issues/** (assignee + mention + creator
 *       dropdowns hydrate IUserLite via getUserDetails)
 *   - apps/web/core/components/project/member-select.tsx,
 *       member-list.tsx, member-list-item.tsx, send-project-invitation-modal.tsx
 *   - apps/web/core/store/issue/issue-details/sub_issues.store.ts
 *       (cross-store member hydration for sub-issue creators/assignees)
 */

import { makeObservable, observable } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type { IUserLite } from "@plane/types";
// plane web imports
import type { IProjectMemberStore } from "@/plane-web/store/member/project-member.store";
import { ProjectMemberStore } from "@/plane-web/store/member/project-member.store";
import type { RootStore } from "@/plane-web/store/root.store";
// local imports
import type { IWorkspaceMemberStore } from "./workspace/workspace-member.store";
import { WorkspaceMemberStore } from "./workspace/workspace-member.store";

export interface IMemberRootStore {
  // observables
  memberMap: Record<string, IUserLite>;
  // computed actions
  getMemberIds: () => string[];
  getUserDetails: (userId: string) => IUserLite | undefined;
  // sub-stores
  workspace: IWorkspaceMemberStore;
  project: IProjectMemberStore;
}

export class MemberRootStore implements IMemberRootStore {
  // observables
  memberMap: Record<string, IUserLite> = {};
  // sub-stores
  workspace: IWorkspaceMemberStore;
  project: IProjectMemberStore;

  constructor(_rootStore: RootStore) {
    makeObservable(this, {
      // observables
      memberMap: observable,
    });
    // sub-stores
    this.workspace = new WorkspaceMemberStore(this, _rootStore);
    this.project = new ProjectMemberStore(this, _rootStore);
  }

  /**
   * @description get all member ids
   */
  getMemberIds = computedFn(() => Object.keys(this.memberMap));

  /**
   * @description get user details from userId
   * @param userId
   */
  getUserDetails = computedFn((userId: string): IUserLite | undefined => this.memberMap?.[userId] ?? undefined);
}
