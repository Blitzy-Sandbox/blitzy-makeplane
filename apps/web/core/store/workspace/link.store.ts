/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for workspace quick-link CRUD and selection state.
 *
 * Interface split: `IWorkspaceLinkStoreActions` declares the mutating surface;
 * `IWorkspaceLinkStore` extends it with observables and helper methods.
 *
 * State slice (observables):
 * - `links: TLinkIdMap` — workspace-slug-keyed ordered arrays of link ids;
 *   populated by `addLinks` and `fetchLinks`.
 * - `linkMap: TLinkMap` — normalized link entities keyed by link id; written
 *   by every CRUD action.
 * - `linkData: TLink | undefined` — currently selected link bound to the
 *   create/update modal; set via `setLinkData`.
 * - `isLinkModalOpen: boolean` — modal visibility flag toggled by
 *   `toggleLinkModal`.
 *
 * Actions:
 * - `addLinks(workspaceSlug, links)` — `action.bound`; writes the id list to
 *   `links[workspaceSlug]` and normalizes each entity into `linkMap` via
 *   lodash `set`.
 * - `fetchLinks(workspaceSlug)` — GET via
 *   `workspaceService.fetchWorkspaceLinks`; delegates to `addLinks` to
 *   populate the caches.
 * - `createLink(workspaceSlug, data)` — POST via
 *   `workspaceService.createWorkspaceLink`; prepends the new id into
 *   `links[workspaceSlug]` and writes the returned entity into `linkMap`.
 * - `updateLink(workspaceSlug, linkId, data)` — optimistically writes partial
 *   fields into `linkMap[linkId]` BEFORE invoking
 *   `workspaceService.updateWorkspaceLink`; no rollback on failure.
 * - `removeLink(workspaceSlug, linkId)` — DELETE via
 *   `workspaceService.deleteWorkspaceLink`; on success removes the id from
 *   `links[workspaceSlug]` and deletes the `linkMap` entry.
 * - `setLinkData(link)` — sets the modal selection.
 * - `toggleLinkModal(isOpen)` — sets `isLinkModalOpen`.
 *
 * Helper methods:
 * - `getLinksByWorkspaceId(projectId)` — returns `links[projectId]`; the
 *   parameter is named `projectId` but callers pass a workspace slug because
 *   `links` is keyed by workspace slug.
 * - `getLinkById(linkId)` — returns `linkMap[linkId]`.
 *
 * Persistence: `WorkspaceService` (`@/services/workspace.service`) — same
 * service used by sibling workspace stores.
 *
 * Composition: leaf store with no sub-store dependencies; instantiated as
 * `HomeStore.quickLinks` at `apps/web/core/store/workspace/home.ts:71`. Not
 * exposed directly at the root store.
 *
 * Consumers: `apps/web/core/components/home/widgets/links/**` —
 * `link-detail.tsx`, `root.tsx`, `links.tsx`, `use-links.tsx`,
 * `create-update-link-modal.tsx`, `action.tsx`.
 */

import { set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
// types
import type { TLink, TLinkIdMap, TLinkMap } from "@plane/types";
// services
import { WorkspaceService } from "@/services/workspace.service";

export interface IWorkspaceLinkStoreActions {
  addLinks: (projectId: string, links: TLink[]) => void;
  fetchLinks: (workspaceSlug: string) => Promise<TLink[]>;
  createLink: (workspaceSlug: string, data: Partial<TLink>) => Promise<TLink>;
  updateLink: (workspaceSlug: string, linkId: string, data: Partial<TLink>) => Promise<TLink>;
  removeLink: (workspaceSlug: string, linkId: string) => Promise<void>;
  setLinkData: (link: TLink | undefined) => void;
  toggleLinkModal: (isOpen: boolean) => void;
}

export interface IWorkspaceLinkStore extends IWorkspaceLinkStoreActions {
  // observables
  links: TLinkIdMap;
  linkMap: TLinkMap;
  linkData: TLink | undefined;
  isLinkModalOpen: boolean;
  // helper methods
  getLinksByWorkspaceId: (projectId: string) => string[] | undefined;
  getLinkById: (linkId: string) => TLink | undefined;
}

export class WorkspaceLinkStore implements IWorkspaceLinkStore {
  // observables
  links: TLinkIdMap = {};
  linkMap: TLinkMap = {};
  linkData: TLink | undefined = undefined;
  isLinkModalOpen = false;
  // services
  workspaceService: WorkspaceService;

  constructor() {
    makeObservable(this, {
      // observables
      links: observable,
      linkMap: observable,
      linkData: observable,
      isLinkModalOpen: observable,
      // actions
      addLinks: action.bound,
      fetchLinks: action,
      createLink: action,
      updateLink: action,
      removeLink: action,
      setLinkData: action,
      toggleLinkModal: action,
    });
    // services
    this.workspaceService = new WorkspaceService();
  }

  // helper methods
  getLinksByWorkspaceId = (projectId: string) => {
    if (!projectId) return undefined;
    return this.links[projectId] ?? undefined;
  };

  getLinkById = (linkId: string) => {
    if (!linkId) return undefined;
    return this.linkMap[linkId] ?? undefined;
  };

  // actions
  setLinkData = (link: TLink | undefined) => {
    runInAction(() => {
      this.linkData = link;
    });
  };

  toggleLinkModal = (isOpen: boolean) => {
    runInAction(() => {
      this.isLinkModalOpen = isOpen;
    });
  };

  addLinks = (workspaceSlug: string, links: TLink[]) => {
    runInAction(() => {
      this.links[workspaceSlug] = links.map((link) => link.id);
      links.forEach((link) => set(this.linkMap, link.id, link));
    });
  };

  fetchLinks = async (workspaceSlug: string) => {
    const response = await this.workspaceService.fetchWorkspaceLinks(workspaceSlug);
    this.addLinks(workspaceSlug, response);
    return response;
  };

  createLink = async (workspaceSlug: string, data: Partial<TLink>) => {
    const response = await this.workspaceService.createWorkspaceLink(workspaceSlug, data);

    runInAction(() => {
      this.links[workspaceSlug] = [response.id, ...(this.links[workspaceSlug] ?? [])];
      set(this.linkMap, response.id, response);
    });
    return response;
  };

  updateLink = async (workspaceSlug: string, linkId: string, data: Partial<TLink>) => {
    runInAction(() => {
      Object.keys(data).forEach((key) => {
        set(this.linkMap, [linkId, key], data[key as keyof TLink]);
      });
    });

    const response = await this.workspaceService.updateWorkspaceLink(workspaceSlug, linkId, data);
    return response;
  };

  removeLink = async (workspaceSlug: string, linkId: string) => {
    // const issueLinkCount = this.getLinksByWorkspaceId(projectId)?.length ?? 0;
    await this.workspaceService.deleteWorkspaceLink(workspaceSlug, linkId);

    const linkIndex = this.links[workspaceSlug].findIndex((link) => link === linkId);
    if (linkIndex >= 0)
      runInAction(() => {
        this.links[workspaceSlug].splice(linkIndex, 1);
        delete this.linkMap[linkId];
      });
  };
}
