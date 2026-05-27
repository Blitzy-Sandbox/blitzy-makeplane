/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project-scoped page model — specializes `BasePage` for pages that belong to one
 * or more projects. Binds the shared page state machine to project-aware backend
 * operations and derives capability flags from the current user's project roles.
 *
 * Inheritance:
 *   - `class ProjectPage extends BasePage implements TProjectPage` (`TProjectPage = TPageInstance`).
 *   - All observables and lifecycle actions (name, description, archive, lock, favorite, duplicate, etc.) are inherited from `BasePage`; this file only adds the project-scoped service wiring and the permission-aware computed getters.
 *
 * State slice contribution:
 *   - No additional observables are declared at this level. All page-level reactive state is owned by `BasePage` (page metadata, ownership, access/lock/archive state, audit fields, editor sub-store).
 *
 * Constructor wiring:
 *   - Reads `workspaceSlug` from `store.router` and `projectId` from `page.project_ids?.[0]`.
 *   - Passes a fully bound `TBasePageServices` object into `super(store, page, services)`. Each callback validates that `workspaceSlug`, `projectId`, and `page.id` are present and otherwise throws `"Missing required fields."` before invoking the module-level `projectPageService` singleton (a `ProjectPageService` instance declared once at module scope). Bound endpoints: update, updateDescription, updateAccess, lock, unlock, archive, restore, duplicate.
 *
 * Computed (permission flags, all registered via `makeObservable`):
 *   - canCurrentUserAccessPage — true when the page is `EPageAccess.PUBLIC` or the current user is the owner.
 *   - canCurrentUserEditPage — true when (public AND highest project role ≥ MEMBER) OR (private AND current user is the owner).
 *   - canCurrentUserDuplicatePage — true when highest project role ≥ MEMBER.
 *   - canCurrentUserLockPage — true when current user is the owner OR highest project role === ADMIN.
 *   - canCurrentUserChangeAccess — same as lock.
 *   - canCurrentUserArchivePage — same as lock.
 *   - canCurrentUserDeletePage — same as lock.
 *   - canCurrentUserFavoritePage — true when highest project role ≥ MEMBER.
 *   - canCurrentUserMovePage — same as lock.
 *   - isContentEditable — true when not archived AND not locked AND (owner OR (public AND highest project role ≥ MEMBER)). Drives the editor read-only flag in the page detail view.
 *   - All flags recompute when the page's `access`, `owned_by`, `archived_at`, `is_locked`, `project_ids`, the router workspace slug, or the user's workspace/project role membership map changes.
 *
 * Memoized helpers (`computedFn` from `mobx-utils` — parameter-aware computed):
 *   - getHighestRoleAcrossProjects (private) — walks every entry in `project_ids`, calls `rootStore.user.permission.getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId)`, and returns the numerically highest `EUserPermissions` value encountered (or undefined when no membership exists). This memoized result is the single source for every capability flag above.
 *   - getRedirectionLink — returns `/${workspaceSlug}/projects/${this.project_ids?.[0]}/pages/${this.id}` for the active workspace. Used by link rendering in page list / breadcrumb / favorite components and by router pushes in command palette navigation.
 *
 * Services / cross-store collaborators:
 *   - ProjectPageService (module-level singleton `projectPageService`) — performs all backend calls (`workspaces/<slug>/projects/<id>/pages/...`) for project-scoped page operations.
 *   - rootStore.router — `workspaceSlug` resolution for service calls and redirection link.
 *   - rootStore.user.permission — role lookups for every capability flag.
 *
 * Exported symbols:
 *   - TProjectPage — type alias for `TPageInstance`; identifies a fully-instantiated project page model.
 *   - ProjectPage — concrete class instantiated by `ProjectPageStore` when populating the project page cache.
 *
 * Consumers:
 *   - apps/web/core/store/pages/project-page.store.ts — instantiates `ProjectPage` on every `fetchPagesList`, `fetchPageDetails`, and `createPage` cache miss.
 *   - apps/web/core/components/pages/** — page list rows, header actions, editor toolbar, favorite controls, copy-link controls, applied-filter pills all read `ProjectPage` instances and consume the capability flags above to gate buttons and inputs.
 *   - apps/web/ce/components/command-palette/modals/project-level.tsx — `CreatePageModal` (rendered with `storeType={EPageStoreType.PROJECT}`) ultimately constructs new instances via the store.
 */

import { computed, makeObservable } from "mobx";
import { computedFn } from "mobx-utils";
// constants
import { EPageAccess, EUserPermissions } from "@plane/constants";
import type { TPage } from "@plane/types";
// plane web store
import type { RootStore } from "@/plane-web/store/root.store";
// services
import { ProjectPageService } from "@/services/page";
const projectPageService = new ProjectPageService();
// store
import { BasePage } from "./base-page";
import type { TPageInstance } from "./base-page";

export type TProjectPage = TPageInstance;

export class ProjectPage extends BasePage implements TProjectPage {
  constructor(store: RootStore, page: TPage) {
    // required fields for API calls
    const { workspaceSlug } = store.router;
    const projectId = page.project_ids?.[0];
    // initialize base instance
    super(store, page, {
      update: async (payload) => {
        if (!workspaceSlug || !projectId || !page.id) throw new Error("Missing required fields.");
        return await projectPageService.update(workspaceSlug, projectId, page.id, payload);
      },
      updateDescription: async (document) => {
        if (!workspaceSlug || !projectId || !page.id) throw new Error("Missing required fields.");
        await projectPageService.updateDescription(workspaceSlug, projectId, page.id, document);
      },
      updateAccess: async (payload) => {
        if (!workspaceSlug || !projectId || !page.id) throw new Error("Missing required fields.");
        await projectPageService.updateAccess(workspaceSlug, projectId, page.id, payload);
      },
      lock: async () => {
        if (!workspaceSlug || !projectId || !page.id) throw new Error("Missing required fields.");
        await projectPageService.lock(workspaceSlug, projectId, page.id);
      },
      unlock: async () => {
        if (!workspaceSlug || !projectId || !page.id) throw new Error("Missing required fields.");
        await projectPageService.unlock(workspaceSlug, projectId, page.id);
      },
      archive: async () => {
        if (!workspaceSlug || !projectId || !page.id) throw new Error("Missing required fields.");
        return await projectPageService.archive(workspaceSlug, projectId, page.id);
      },
      restore: async () => {
        if (!workspaceSlug || !projectId || !page.id) throw new Error("Missing required fields.");
        await projectPageService.restore(workspaceSlug, projectId, page.id);
      },
      duplicate: async () => {
        if (!workspaceSlug || !projectId || !page.id) throw new Error("Missing required fields.");
        return await projectPageService.duplicate(workspaceSlug, projectId, page.id);
      },
    });
    makeObservable(this, {
      // computed
      canCurrentUserAccessPage: computed,
      canCurrentUserEditPage: computed,
      canCurrentUserDuplicatePage: computed,
      canCurrentUserLockPage: computed,
      canCurrentUserChangeAccess: computed,
      canCurrentUserArchivePage: computed,
      canCurrentUserDeletePage: computed,
      canCurrentUserFavoritePage: computed,
      canCurrentUserMovePage: computed,
      isContentEditable: computed,
    });
  }

  private getHighestRoleAcrossProjects = computedFn((): EUserPermissions | undefined => {
    const { workspaceSlug } = this.rootStore.router;
    if (!workspaceSlug || !this.project_ids?.length) return;
    let highestRole: EUserPermissions | undefined = undefined;
    this.project_ids.map((projectId) => {
      const currentUserProjectRole = this.rootStore.user.permission.getProjectRoleByWorkspaceSlugAndProjectId(
        workspaceSlug?.toString() || "",
        projectId?.toString() || ""
      );
      if (currentUserProjectRole) {
        if (!highestRole) highestRole = currentUserProjectRole;
        else if (currentUserProjectRole > highestRole) highestRole = currentUserProjectRole;
      }
    });
    return highestRole;
  });

  /**
   * @description returns true if the current logged in user can access the page
   */
  get canCurrentUserAccessPage() {
    const isPagePublic = this.access === EPageAccess.PUBLIC;
    return isPagePublic || this.isCurrentUserOwner;
  }

  /**
   * @description returns true if the current logged in user can edit the page
   */
  get canCurrentUserEditPage() {
    const highestRole = this.getHighestRoleAcrossProjects();
    const isPagePublic = this.access === EPageAccess.PUBLIC;
    return (
      (isPagePublic && !!highestRole && highestRole >= EUserPermissions.MEMBER) ||
      (!isPagePublic && this.isCurrentUserOwner)
    );
  }

  /**
   * @description returns true if the current logged in user can create a duplicate the page
   */
  get canCurrentUserDuplicatePage() {
    const highestRole = this.getHighestRoleAcrossProjects();
    return !!highestRole && highestRole >= EUserPermissions.MEMBER;
  }

  /**
   * @description returns true if the current logged in user can lock the page
   */
  get canCurrentUserLockPage() {
    const highestRole = this.getHighestRoleAcrossProjects();
    return this.isCurrentUserOwner || highestRole === EUserPermissions.ADMIN;
  }

  /**
   * @description returns true if the current logged in user can change the access of the page
   */
  get canCurrentUserChangeAccess() {
    const highestRole = this.getHighestRoleAcrossProjects();
    return this.isCurrentUserOwner || highestRole === EUserPermissions.ADMIN;
  }

  /**
   * @description returns true if the current logged in user can archive the page
   */
  get canCurrentUserArchivePage() {
    const highestRole = this.getHighestRoleAcrossProjects();
    return this.isCurrentUserOwner || highestRole === EUserPermissions.ADMIN;
  }

  /**
   * @description returns true if the current logged in user can delete the page
   */
  get canCurrentUserDeletePage() {
    const highestRole = this.getHighestRoleAcrossProjects();
    return this.isCurrentUserOwner || highestRole === EUserPermissions.ADMIN;
  }

  /**
   * @description returns true if the current logged in user can favorite the page
   */
  get canCurrentUserFavoritePage() {
    const highestRole = this.getHighestRoleAcrossProjects();
    return !!highestRole && highestRole >= EUserPermissions.MEMBER;
  }

  /**
   * @description returns true if the current logged in user can move the page
   */
  get canCurrentUserMovePage() {
    const highestRole = this.getHighestRoleAcrossProjects();
    return this.isCurrentUserOwner || highestRole === EUserPermissions.ADMIN;
  }

  /**
   * @description returns true if the page can be edited
   */
  get isContentEditable() {
    const highestRole = this.getHighestRoleAcrossProjects();
    const isOwner = this.isCurrentUserOwner;
    const isPublic = this.access === EPageAccess.PUBLIC;
    const isArchived = this.archived_at;
    const isLocked = this.is_locked;

    return (
      !isArchived && !isLocked && (isOwner || (isPublic && !!highestRole && highestRole >= EUserPermissions.MEMBER))
    );
  }

  getRedirectionLink = computedFn(() => {
    const { workspaceSlug } = this.rootStore.router;
    return `/${workspaceSlug}/projects/${this.project_ids?.[0]}/pages/${this.id}`;
  });
}
