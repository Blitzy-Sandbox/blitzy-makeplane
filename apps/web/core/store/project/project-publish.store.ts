/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project publish store — manages publish/deploy-board lifecycle state for
 * individual projects.
 *
 * Publishing a project creates a `DeployBoard` entity server-side (see
 * apps/api/plane/db/models/deploy_board.py) that exposes a read-only public
 * URL for the project. This store caches publish settings client-side keyed
 * by project ID and synchronizes the project's `anchor` field on the main
 * project store so detail pages know whether a project is currently public.
 *
 * State slice (each registered as observable in the `makeObservable` block):
 *   - generalLoader: boolean (observable.ref) — true while publish/unpublish
 *     or settings-update is in flight.
 *   - fetchSettingsLoader: boolean (observable.ref) — true while fetching
 *     existing publish settings.
 *   - publishSettingsMap: Record<string, TProjectPublishSettings>
 *       In-memory cache of publish settings keyed by projectID.
 *
 * Helper:
 *   - getPublishSettingsByProjectID(projectID) — synchronous lookup against
 *     `publishSettingsMap`; returns undefined when the project has not been
 *     fetched/published.
 *
 * Actions:
 *   - fetchPublishSettings(workspaceSlug, projectID) — GETs settings from
 *     ProjectPublishService; populates publishSettingsMap[projectID];
 *     toggles fetchSettingsLoader.
 *   - publishProject(workspaceSlug, projectID, data) — POSTs to
 *     ProjectPublishService.publishProject; on success writes settings into
 *     publishSettingsMap[projectID] AND mutates
 *     projectRootStore.project.projectMap[projectID].anchor with the new
 *     anchor returned by the server.
 *   - updatePublishSettings(workspaceSlug, projectID, projectPublishId, data)
 *       — PATCHes publish settings via ProjectPublishService.updatePublishSettings
 *       and refreshes publishSettingsMap[projectID].
 *   - unPublishProject(workspaceSlug, projectID, projectPublishId) — DELETEs
 *     the deploy-board; on success `unset`s publishSettingsMap[projectID] and
 *     nulls projectMap[projectID].anchor so detail pages re-render as private.
 *
 * Cross-store writes (anchor field synchronization):
 *   - projectRootStore.project.projectMap[projectID].anchor — set on publish,
 *     cleared on unpublish. This is the channel by which other consumers
 *     observe whether a project is currently public.
 *
 * Service dependency:
 *   - ProjectPublishService (from @/services/project) — performs the HTTP
 *     calls against apps/api publish endpoints.
 *
 * Consumers:
 *   - Project settings → publish dialog/components under
 *     apps/web/core/components/project/** that invoke publishProject /
 *     unPublishProject.
 *   - Components that read `anchor` on TProject to decide whether to render
 *     "View public page" affordances (e.g., project header / settings).
 *
 * Composition:
 *   - Constructed by ProjectRootStore (apps/web/core/store/project/index.ts)
 *     with `this` (the ProjectRootStore instance) so it can mutate the sibling
 *     project store's `projectMap.anchor` field on publish/unpublish.
 */

import { unset, set } from "lodash-es";
import { observable, action, makeObservable, runInAction } from "mobx";
// types
import type { TProjectPublishSettings } from "@plane/types";
// services
import { ProjectPublishService } from "@/services/project";
// store
import type { ProjectRootStore } from "@/store/project";

export interface IProjectPublishStore {
  // states
  generalLoader: boolean;
  fetchSettingsLoader: boolean;
  // observables
  publishSettingsMap: Record<string, TProjectPublishSettings>; // projectID => TProjectPublishSettings
  // helpers
  getPublishSettingsByProjectID: (projectID: string) => TProjectPublishSettings | undefined;
  // actions
  fetchPublishSettings: (workspaceSlug: string, projectID: string) => Promise<TProjectPublishSettings>;
  updatePublishSettings: (
    workspaceSlug: string,
    projectID: string,
    projectPublishId: string,
    data: Partial<TProjectPublishSettings>
  ) => Promise<TProjectPublishSettings>;
  publishProject: (
    workspaceSlug: string,
    projectID: string,
    data: Partial<TProjectPublishSettings>
  ) => Promise<TProjectPublishSettings>;
  unPublishProject: (workspaceSlug: string, projectID: string, projectPublishId: string) => Promise<void>;
}

export class ProjectPublishStore implements IProjectPublishStore {
  // states
  generalLoader: boolean = false;
  fetchSettingsLoader: boolean = false;
  // observables
  publishSettingsMap: Record<string, TProjectPublishSettings> = {};
  // root store
  projectRootStore: ProjectRootStore;
  // services
  projectPublishService;

  constructor(_projectRootStore: ProjectRootStore) {
    makeObservable(this, {
      // states
      generalLoader: observable.ref,
      fetchSettingsLoader: observable.ref,
      // observables
      publishSettingsMap: observable,
      // actions
      fetchPublishSettings: action,
      updatePublishSettings: action,
      publishProject: action,
      unPublishProject: action,
    });
    // root store
    this.projectRootStore = _projectRootStore;
    // services
    this.projectPublishService = new ProjectPublishService();
  }

  /**
   * @description returns the publish settings of a particular project
   * @param {string} projectID
   * @returns {TProjectPublishSettings | undefined}
   */
  getPublishSettingsByProjectID = (projectID: string): TProjectPublishSettings | undefined =>
    this.publishSettingsMap?.[projectID] ?? undefined;

  /**
   * Fetches project publish settings
   * @param workspaceSlug
   * @param projectID
   * @returns
   */
  fetchPublishSettings = async (workspaceSlug: string, projectID: string) => {
    try {
      runInAction(() => {
        this.fetchSettingsLoader = true;
      });
      const response = await this.projectPublishService.fetchPublishSettings(workspaceSlug, projectID);

      runInAction(() => {
        set(this.publishSettingsMap, [projectID], response);
        this.fetchSettingsLoader = false;
      });
      return response;
    } catch (error) {
      runInAction(() => {
        this.fetchSettingsLoader = false;
      });
      throw error;
    }
  };

  /**
   * Publishes project and updates project publish status in the store
   * @param workspaceSlug
   * @param projectID
   * @param data
   * @returns
   */
  publishProject = async (workspaceSlug: string, projectID: string, data: Partial<TProjectPublishSettings>) => {
    try {
      runInAction(() => {
        this.generalLoader = true;
      });
      const response = await this.projectPublishService.publishProject(workspaceSlug, projectID, data);
      runInAction(() => {
        set(this.publishSettingsMap, [projectID], response);
        set(this.projectRootStore.project.projectMap, [projectID, "anchor"], response.anchor);
        this.generalLoader = false;
      });
      return response;
    } catch (error) {
      runInAction(() => {
        this.generalLoader = false;
      });
      throw error;
    }
  };

  /**
   * Updates project publish settings
   * @param workspaceSlug
   * @param projectID
   * @param projectPublishId
   * @param data
   * @returns
   */
  updatePublishSettings = async (
    workspaceSlug: string,
    projectID: string,
    projectPublishId: string,
    data: Partial<TProjectPublishSettings>
  ) => {
    try {
      runInAction(() => {
        this.generalLoader = true;
      });
      const response = await this.projectPublishService.updatePublishSettings(
        workspaceSlug,
        projectID,
        projectPublishId,
        data
      );
      runInAction(() => {
        set(this.publishSettingsMap, [projectID], response);
        this.generalLoader = false;
      });
      return response;
    } catch (error) {
      runInAction(() => {
        this.generalLoader = false;
      });
      throw error;
    }
  };

  /**
   * Unpublishes project and updates project publish status in the store
   * @param workspaceSlug
   * @param projectID
   * @param projectPublishId
   * @returns
   */
  unPublishProject = async (workspaceSlug: string, projectID: string, projectPublishId: string) => {
    try {
      runInAction(() => {
        this.generalLoader = true;
      });
      const response = await this.projectPublishService.unpublishProject(workspaceSlug, projectID, projectPublishId);
      runInAction(() => {
        unset(this.publishSettingsMap, [projectID]);
        set(this.projectRootStore.project.projectMap, [projectID, "anchor"], null);
        this.generalLoader = false;
      });
      return response;
    } catch (error) {
      runInAction(() => {
        this.generalLoader = false;
      });
      throw error;
    }
  };
}
