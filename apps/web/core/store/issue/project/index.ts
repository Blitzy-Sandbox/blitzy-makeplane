/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project issue store barrel — single import entrypoint for the MobX store
 * pair that backs project-scoped (`EIssuesStoreType.PROJECT`) work-item
 * lists in the web app: the filter slice and the paginated issue
 * collection. Pairs `ProjectIssuesFilter` with `ProjectIssues` so
 * consumers depend on the stable package path `@/store/issue/project`
 * instead of reaching into the sibling `./filter.store` and
 * `./issue.store` modules directly, which stabilizes the public surface
 * of this slice as a unit and lets the underlying file layout evolve
 * without breaking call sites.
 *
 * Re-exports:
 *   - From `./filter.store`: `ProjectIssuesFilter` (concrete MobX store
 *     class extending `IssueFilterHelperStore`) + `IProjectIssuesFilter`
 *     (public contract for the per-project filter slice — filter state,
 *     hydration via `ProjectService.getProjectUserProperties`, and hybrid
 *     persistence that mirrors display filters/properties to the backend
 *     while keeping kanban grouping toggles device-local in
 *     `localStorage`).
 *   - From `./issue.store`: `ProjectIssues` (concrete MobX store class
 *     extending `BaseIssuesStore`) + `IProjectIssues` (public contract
 *     for the per-project paginated issue collection — `fetchIssues`,
 *     `fetchNextIssues`, `fetchIssuesWithExistingPagination`,
 *     `createIssue`, `updateIssue`, `archiveIssue`, `quickAddIssue`,
 *     `archiveBulkIssues`, plus `viewFlags`).
 *
 * Consumers:
 *   - `apps/web/core/store/issue/root.store.ts` — instantiates
 *     `new ProjectIssuesFilter(this)` and
 *     `new ProjectIssues(this, this.projectIssuesFilter)` to compose
 *     `projectIssuesFilter` and `projectIssues` into the issue-domain
 *     root store.
 *   - `apps/web/core/components/issues/**` — the project layout root
 *     (`issue-layouts/roots/project-layout-root.tsx`) plus every
 *     list / kanban / spreadsheet / calendar / gantt layout under
 *     `issue-layouts/{list,kanban,spreadsheet,calendar,gantt}/**`, the
 *     empty / quick-add / properties / filters / bulk-operations /
 *     issue-modal / peek-overview surfaces all reach the pair through
 *     `useIssues(EIssuesStoreType.PROJECT)`
 *     (`apps/web/core/hooks/store/use-issues.ts`).
 *
 * Runtime semantics: pure TypeScript module aggregation — `tsc` erases
 * this barrel to its constituent re-exports; no executable logic, no
 * observable state, and no side effects live in this file.
 */

export * from "./filter.store";
export * from "./issue.store";
