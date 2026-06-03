/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project-views issue store barrel — single import entrypoint for the MobX
 * store pair that backs Plane's custom Project Views feature, keyed to the
 * `EIssuesStoreType.PROJECT_VIEW` context. Pairs the per-view filter store
 * with the per-view paginated issue collection so consumers depend on the
 * stable package path `@/store/issue/project-views` rather than reaching
 * into the sibling `./filter.store` and `./issue.store` modules directly,
 * which stabilizes the public surface of this slice as a unit.
 *
 * Re-exports:
 *   - From `./filter.store`: `ProjectViewIssuesFilter` (concrete MobX store
 *     class extending `IssueFilterHelperStore`) + `IProjectViewIssuesFilter`
 *     (public contract for the per-view filter slice — `getFilterParams`,
 *     `getIssueFilters`, `mutateFilters`, `fetchFilters`,
 *     `updateFilterExpression`, `updateFilters`, `resetFilters`).
 *   - From `./issue.store`: `ProjectViewIssues` (concrete MobX store class
 *     extending `BaseIssuesStore`) + `IProjectViewIssues` (public contract
 *     for the per-view issue collection — `fetchIssues`, `fetchNextIssues`,
 *     `fetchIssuesWithExistingPagination`, `createIssue`, `updateIssue`,
 *     `archiveIssue`, `quickAddIssue`, `removeBulkIssues`,
 *     `archiveBulkIssues`, `bulkUpdateProperties`, and `viewFlags`).
 *
 * Consumers:
 *   - `apps/web/core/store/issue/root.store.ts` — instantiates
 *     `new ProjectViewIssuesFilter(this)` and `new ProjectViewIssues(this,
 *     this.projectViewIssuesFilter)` to compose `projectViewIssuesFilter`
 *     and `projectViewIssues` into the issue-domain root store.
 *   - `apps/web/core/hooks/store/use-issues.ts` — reads the
 *     `IProjectViewIssuesFilter` / `IProjectViewIssues` types so
 *     `useIssues(EIssuesStoreType.PROJECT_VIEW)` returns the correctly
 *     typed paired filter + issue stores.
 *   - `apps/web/core/components/issues/issue-layouts/calendar/**` —
 *     calendar layout surfaces (`calendar.tsx`, `header.tsx`, `day-tile`,
 *     `week-days`, month/options dropdowns) consume
 *     `IProjectViewIssuesFilter` for typed filter access.
 *   - `apps/web/ce/store/issue/team-views/{filter,issue}.store.ts` — the
 *     community-edition team-views layer subclasses
 *     `ProjectViewIssuesFilter` / `ProjectViewIssues` to inherit the
 *     project-view behavior as the team-views default in the CE tier.
 *
 * Runtime semantics: pure TypeScript module aggregation — `tsc` erases
 * this barrel to its constituent re-exports; no executable logic and no
 * observable state live here.
 */

export * from "./filter.store";
export * from "./issue.store";
