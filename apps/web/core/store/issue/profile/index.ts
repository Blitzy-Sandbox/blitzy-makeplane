/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Profile issue store barrel — single import entrypoint for the MobX store
 * pair that backs profile-scoped (`EIssuesStoreType.PROFILE`) work-item lists
 * in the web app: the per-user filter slice keyed by the profile being
 * viewed, and the issue collection that toggles between assigned / created /
 * subscribed views. Pairs `ProfileIssuesFilter` with `ProfileIssues` so
 * consumers depend on the stable package path `@/store/issue/profile` instead
 * of reaching into the sibling `./filter.store` and `./issue.store` modules
 * directly, which stabilizes the public surface of this slice as a unit and
 * lets the underlying file layout evolve without breaking call sites.
 *
 * Re-exports:
 *   - From `./filter.store`: `ProfileIssuesFilter` (concrete MobX store class
 *     extending `IssueFilterHelperStore`) + `IProfileIssuesFilter` (public
 *     contract for the per-user filter slice — filter snapshots keyed by
 *     `userId`, layout-aware query-param derivation through `getFilterParams`,
 *     and persistence that hydrates from browser local storage scoped to
 *     `EIssuesStoreType.PROFILE` with no remote network call on the current
 *     code path).
 *   - From `./issue.store`: `ProfileIssues` (concrete MobX store class
 *     extending `BaseIssuesStore`) + `IProfileIssues` (public contract for the
 *     profile issue collection — `fetchIssues`, `fetchNextIssues`,
 *     `fetchIssuesWithExistingPagination`, `setViewId`, plus the `viewFlags`
 *     computed and the `currentView` discriminant that switches between
 *     `"assigned"` / `"created"` / `"subscribed"` query modes against
 *     `UserService.getUserProfileIssues`).
 *
 * Consumers:
 *   - `apps/web/core/store/issue/root.store.ts` — instantiates
 *     `new ProfileIssuesFilter(this)` and
 *     `new ProfileIssues(this, this.profileIssuesFilter)` to compose
 *     `profileIssuesFilter` and `profileIssues` into the issue-domain root
 *     store.
 *   - UI consumers reach the pair through `useIssues(EIssuesStoreType.PROFILE)`
 *     (`apps/web/core/hooks/store/use-issues.ts`) — primary call sites are
 *     `apps/web/core/components/profile/profile-issues.tsx`,
 *     `apps/web/core/components/profile/profile-issues-filter.tsx`,
 *     `apps/web/core/hooks/use-issues-actions.tsx`, and
 *     `apps/web/app/(all)/[workspaceSlug]/(projects)/profile/[userId]/mobile-header.tsx`.
 *
 * Runtime semantics: pure TypeScript module aggregation — `tsc` erases this
 * barrel to its constituent re-exports; no executable logic, no observable
 * state, and no side effects live in this file.
 */

export * from "./filter.store";
export * from "./issue.store";
