/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Router store: thin projection of the parsed URL query into typed observable
 * route parameters; the source of truth for "which entity is the user
 * currently viewing" across every domain store and component.
 *
 * State slice:
 *   - query: ParsedUrlQuery — the raw parsed query object from React Router
 *     (set externally by the route layout via setQuery on every navigation)
 *
 * Actions:
 *   - setQuery(query: ParsedUrlQuery) — replaces the observable query;
 *     called by `apps/web/core/lib/wrappers/store-wrapper.tsx` (or similar
 *     route-listener wrapper) on every navigation event. No service calls.
 *
 * Computed (all recompute when `query` changes; each extracts a single
 * named parameter from the URL):
 *   - workspaceSlug: string | undefined — workspace slug from /:workspaceSlug/
 *   - teamspaceId: string | undefined — teamspace id (EE only)
 *   - projectId: string | undefined — project uuid from route params
 *   - cycleId / moduleId / viewId / globalViewId — entity ids when on
 *     entity routes; undefined otherwise
 *   - profileViewId: TProfileViews | undefined — profile sub-view discriminant
 *   - userId / peekId / issueId / inboxId / webhookId / epicId — additional
 *     route parameter projections
 *
 * Consumers (this store is read by virtually every domain store and most
 * components; representative examples below):
 *   - apps/web/core/store/cycle.store.ts (uses workspaceSlug + projectId in
 *     currentProjectCycleIds and other computed selectors)
 *   - apps/web/core/store/module.store.ts
 *   - apps/web/core/store/issue/** (every issue-store branch keys caches by
 *     route ids)
 *   - apps/web/core/components/** (any component that reads route state
 *     reactively via useRouter store hook)
 */

import type { ParsedUrlQuery } from "node:querystring";
import { action, makeObservable, observable, computed, runInAction } from "mobx";

import type { TProfileViews } from "@plane/types";
export interface IRouterStore {
  // observables
  query: ParsedUrlQuery;
  // actions
  setQuery: (query: ParsedUrlQuery) => void;
  // computed
  workspaceSlug: string | undefined;
  teamspaceId: string | undefined;
  projectId: string | undefined;
  cycleId: string | undefined;
  moduleId: string | undefined;
  viewId: string | undefined;
  globalViewId: string | undefined;
  profileViewId: TProfileViews | undefined;
  userId: string | undefined;
  peekId: string | undefined;
  issueId: string | undefined;
  inboxId: string | undefined;
  webhookId: string | undefined;
  epicId: string | undefined;
}

export class RouterStore implements IRouterStore {
  // observables
  query: ParsedUrlQuery = {};

  constructor() {
    makeObservable(this, {
      // observables
      query: observable,
      // actions
      setQuery: action.bound,
      //computed
      workspaceSlug: computed,
      teamspaceId: computed,
      projectId: computed,
      cycleId: computed,
      moduleId: computed,
      viewId: computed,
      globalViewId: computed,
      profileViewId: computed,
      userId: computed,
      peekId: computed,
      issueId: computed,
      inboxId: computed,
      webhookId: computed,
      epicId: computed,
    });
  }

  /**
   * Sets the query
   * @param query
   */
  setQuery = (query: ParsedUrlQuery) => {
    runInAction(() => {
      this.query = query;
    });
  };

  /**
   * Returns the workspace slug from the query
   * @returns string|undefined
   */
  get workspaceSlug() {
    return this.query?.workspaceSlug?.toString();
  }

  /**
   * Returns the teamspace id from the query
   * @returns string|undefined
   */
  get teamspaceId() {
    return this.query?.teamspaceId?.toString();
  }

  /**
   * Returns the project id from the query
   * @returns string|undefined
   */
  get projectId() {
    return this.query?.projectId?.toString();
  }

  /**
   * Returns the module id from the query
   * @returns string|undefined
   */
  get moduleId() {
    return this.query?.moduleId?.toString();
  }

  /**
   * Returns the cycle id from the query
   * @returns string|undefined
   */
  get cycleId() {
    return this.query?.cycleId?.toString();
  }

  /**
   * Returns the view id from the query
   * @returns string|undefined
   */
  get viewId() {
    return this.query?.viewId?.toString();
  }

  /**
   * Returns the global view id from the query
   * @returns string|undefined
   */
  get globalViewId() {
    return this.query?.globalViewId?.toString();
  }

  /**
   * Returns the profile view id from the query
   * @returns string|undefined
   */
  get profileViewId() {
    return this.query?.profileViewId?.toString() as TProfileViews;
  }

  /**
   * Returns the user id from the query
   * @returns string|undefined
   */
  get userId() {
    return this.query?.userId?.toString();
  }

  /**
   * Returns the peek id from the query
   * @returns string|undefined
   */
  get peekId() {
    return this.query?.peekId?.toString();
  }

  /**
   * Returns the issue id from the query
   * @returns string|undefined
   */
  get issueId() {
    return this.query?.issueId?.toString();
  }

  /**
   * Returns the inbox id from the query
   * @returns string|undefined
   */
  get inboxId() {
    return this.query?.inboxId?.toString();
  }

  /**
   * Returns the webhook id from the query
   * @returns string|undefined
   */
  get webhookId() {
    return this.query?.webhookId?.toString();
  }

  /**
   * Returns the epic id from the query
   * @returns string|undefined
   */
  get epicId() {
    return this.query?.epicId?.toString();
  }
}
