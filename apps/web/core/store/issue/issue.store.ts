/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared client-side cache of all `TIssue` records for the web app, keyed by issue uuid,
 * with a parallel lookup map of `${projectIdentifier}-${sequenceId}` -> issue uuid so the UI
 * can resolve issues by their human-readable identifier (e.g. "PLAN-123"). Every branch-specific
 * issue store (cycle / module / project / profile / archived / workspace / workspace-draft /
 * project-views) reads from this cache so issue payloads stay normalized across views.
 *
 * State slice (observable):
 *   - issuesMap: Record<string, TIssue>
 *       Primary cache keyed by issue uuid. Mutated by `addIssue`, `updateIssue`, `removeIssue`,
 *       and (via `runInAction`) by `getIssues`.
 *   - issuesIdentifierMap: Record<string, string>
 *       Secondary index keyed by `${projectIdentifier}-${sequenceId}` resolving to the issue uuid.
 *       Populated as a side effect of `addIssue` (and explicitly by `addIssueIdentifier`).
 *       Cross-store dependency: project identifier is resolved through
 *       `rootStore.projectRoot.project.getProjectIdentifierById` — if the project record is not
 *       yet loaded for an issue's `project_id`, the identifier slot will silently encode `undefined`
 *       and identifier-based lookups for that issue will miss.
 *
 * Actions (registered on `makeObservable`):
 *   - addIssue(issues): upserts each issue into `issuesMap` (shallow-merging existing entries
 *       via `lodash.update`) and stamps the identifier map for each entry.
 *   - addIssueIdentifier(issueIdentifier, issueId): writes a single identifier -> id mapping.
 *   - updateIssue(issueId, partial): patches an existing entry in place and stamps `updated_at`
 *       with `getCurrentDateTimeInISO()` from `@plane/utils`. No-op if the issue is not cached.
 *   - removeIssue(issueId): deletes the entry from `issuesMap`. No-op if absent.
 *
 * Async (NOT registered on `makeObservable` by design — the MobX-aware mutation site is the
 * embedded `runInAction` inside the method body):
 *   - getIssues(workspaceSlug, projectId, issueIds): fetches via `IssueService.retrieveIssues`,
 *       commits any results that are not already cached into `issuesMap`, and returns the
 *       fetched list. Existing cached entries are left untouched (no overwrite on hit).
 *
 * Computed helpers (memoized per-argument via `mobx-utils` `computedFn`):
 *   - getIssueById(issueId): returns the cached `TIssue` for an id or `undefined`; recomputes
 *       when `issuesMap` changes.
 *   - getIssueIdByIdentifier(issueIdentifier): returns the cached issue uuid for a
 *       `${projectIdentifier}-${sequenceId}` key or `undefined`; recomputes when
 *       `issuesIdentifierMap` changes.
 *   - getIssuesByIds(issueIds, type): returns matching `TIssue[]` filtered by archive state
 *       through the `archived_at` discriminant — `"archived"` keeps entries with a truthy
 *       `archived_at`, `"un-archived"` keeps entries whose `archived_at` is null/undefined.
 *       Callers should NOT re-filter on `archived_at` at the call site. Recomputes per
 *       `(ids, type)` tuple when `issuesMap` changes.
 *
 * Services:
 *   - issueService: `IssueService` instance constructed in the class constructor; the only
 *       network surface used by this store (via `getIssues` -> `retrieveIssues`).
 *
 * Consumers:
 *   - apps/web/core/store/issue/helpers/base-issues.store.ts — abstract base that every
 *       branch-specific issue store extends; reads/writes through this cache.
 *   - apps/web/core/store/issue/issue-details/issue.store.ts — issue-detail page hydrates
 *       loaded records here.
 *   - apps/web/core/store/issue/issue-details/sub_issues.store.ts — sub-issue records hydrate
 *       into this same map (one shared cache for both parent and child issues).
 *   - Branch issue stores at apps/web/core/store/issue/{archived,cycle,module,profile,project,
 *       project-views,workspace,workspace-draft}/issue.store.ts.
 *   - Composed by apps/web/core/store/issue/root.store.ts as `issues` and exposed through the
 *       root MobX store provided via React context (`@/lib/store-context`).
 *   - Read indirectly by every component under apps/web/core/components/issues/** through the
 *       branch stores and the `useIssues(...)` hook in apps/web/core/hooks/store/use-issues.ts.
 */

import { set, update } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type { TIssue } from "@plane/types";
// helpers
import { getCurrentDateTimeInISO } from "@plane/utils";
import { rootStore } from "@/lib/store-context";
// services
import { IssueService } from "@/services/issue";

export type IIssueStore = {
  // observables
  issuesMap: Record<string, TIssue>; // Record defines issue_id as key and TIssue as value
  issuesIdentifierMap: Record<string, string>; // Record defines issue_identifier as key and issue_id as value
  // actions
  getIssues(workspaceSlug: string, projectId: string, issueIds: string[]): Promise<TIssue[]>;
  addIssue(issues: TIssue[]): void;
  addIssueIdentifier(issueIdentifier: string, issueId: string): void;
  updateIssue(issueId: string, issue: Partial<TIssue>): void;
  removeIssue(issueId: string): void;
  // helper methods
  getIssueById(issueId: string): undefined | TIssue;
  getIssueIdByIdentifier(issueIdentifier: string): undefined | string;
  getIssuesByIds(issueIds: string[], type: "archived" | "un-archived"): TIssue[]; // Record defines issue_id as key and TIssue as value
};

export class IssueStore implements IIssueStore {
  // observables
  issuesMap: { [issue_id: string]: TIssue } = {};
  issuesIdentifierMap: { [issue_identifier: string]: string } = {};
  // service
  issueService;

  constructor() {
    makeObservable(this, {
      // observable
      issuesMap: observable,
      issuesIdentifierMap: observable,
      // actions
      addIssue: action,
      addIssueIdentifier: action,
      updateIssue: action,
      removeIssue: action,
    });
    this.issueService = new IssueService();
  }

  // actions
  /**
   * @description This method will add issues to the issuesMap
   * @param {TIssue[]} issues
   * @returns {void}
   */
  addIssue = (issues: TIssue[]) => {
    if (issues && issues.length <= 0) return;
    runInAction(() => {
      issues.forEach((issue) => {
        // add issue identifier to the issuesIdentifierMap
        const projectIdentifier = rootStore.projectRoot.project.getProjectIdentifierById(issue?.project_id);
        const workItemSequenceId = issue?.sequence_id;
        const issueIdentifier = `${projectIdentifier}-${workItemSequenceId}`;
        set(this.issuesIdentifierMap, issueIdentifier, issue.id);

        if (!this.issuesMap[issue.id]) set(this.issuesMap, issue.id, issue);
        else update(this.issuesMap, issue.id, (prevIssue) => ({ ...prevIssue, ...issue }));
      });
    });
  };

  /**
   * @description This method will add issue_identifier to the issuesIdentifierMap
   * @param issueIdentifier
   * @param issueId
   * @returns {void}
   */
  addIssueIdentifier = (issueIdentifier: string, issueId: string) => {
    if (!issueIdentifier || !issueId) return;
    runInAction(() => {
      set(this.issuesIdentifierMap, issueIdentifier, issueId);
    });
  };

  getIssues = async (workspaceSlug: string, projectId: string, issueIds: string[]) => {
    const issues = await this.issueService.retrieveIssues(workspaceSlug, projectId, issueIds);

    runInAction(() => {
      issues.forEach((issue) => {
        if (!this.issuesMap[issue.id]) set(this.issuesMap, issue.id, issue);
      });
    });

    return issues;
  };

  /**
   * @description This method will update the issue in the issuesMap
   * @param {string} issueId
   * @param {Partial<TIssue>} issue
   * @returns {void}
   */
  updateIssue = (issueId: string, issue: Partial<TIssue>) => {
    if (!issue || !issueId || !this.issuesMap[issueId]) return;
    runInAction(() => {
      set(this.issuesMap, [issueId, "updated_at"], getCurrentDateTimeInISO());
      Object.keys(issue).forEach((key) => {
        set(this.issuesMap, [issueId, key], issue[key as keyof TIssue]);
      });
    });
  };

  /**
   * @description This method will remove the issue from the issuesMap
   * @param {string} issueId
   * @returns {void}
   */
  removeIssue = (issueId: string) => {
    if (!issueId || !this.issuesMap[issueId]) return;
    runInAction(() => {
      delete this.issuesMap[issueId];
    });
  };

  // helper methods
  /**
   * @description This method will return the issue from the issuesMap
   * @param {string} issueId
   * @returns {TIssue | undefined}
   */
  getIssueById = computedFn((issueId: string) => {
    if (!issueId || !this.issuesMap[issueId]) return undefined;
    return this.issuesMap[issueId];
  });

  /**
   * @description This method will return the issue_id from the issuesIdentifierMap
   * @param {string} issueIdentifier
   * @returns {string | undefined}
   */
  getIssueIdByIdentifier = computedFn((issueIdentifier: string) => {
    if (!issueIdentifier || !this.issuesIdentifierMap[issueIdentifier]) return undefined;
    return this.issuesIdentifierMap[issueIdentifier];
  });

  /**
   * @description This method will return the issues from the issuesMap
   * @param {string[]} issueIds
   * @param {boolean} archivedIssues
   * @returns {Record<string, TIssue> | undefined}
   */
  getIssuesByIds = computedFn((issueIds: string[], type: "archived" | "un-archived") => {
    if (!issueIds || issueIds.length <= 0) return [];
    const filteredIssues: TIssue[] = [];
    Object.values(issueIds).forEach((issueId) => {
      // if type is archived then check archived_at is not null
      // if type is un-archived then check archived_at is null
      const issue = this.issuesMap[issueId];
      if (issue && ((type === "archived" && issue.archived_at) || (type === "un-archived" && !issue?.archived_at))) {
        filteredIssues.push(issue);
      }
    });
    return filteredIssues;
  });
}
