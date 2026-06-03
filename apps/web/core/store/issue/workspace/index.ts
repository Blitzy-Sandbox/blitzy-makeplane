/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace issue store barrel — module-aggregation entry point for the MobX
 * store pair that backs workspace-scoped ("all issues" / global view) issue
 * lists in the web app. Consumers import from this canonical path instead of
 * reaching into the individual `./filter.store` and `./issue.store` modules,
 * which stabilizes the public surface of the `store/issue/workspace` package.
 *
 * Re-exports:
 *   - From `./filter.store`: `WorkspaceIssuesFilter` (concrete MobX store class)
 *     + `IWorkspaceIssuesFilter` (public interface) + `TBaseFilterStore` (the
 *     `IBaseIssueFilterStore & IIssueFilterHelperStore` intersection that
 *     defines the shared filter contract).
 *   - From `./issue.store`: `WorkspaceIssues` (concrete MobX store class) +
 *     `IWorkspaceIssues` (public interface) — the paginated workspace-view
 *     issue collection backed by `WorkspaceService.getViewIssues`.
 *
 * Override seam: `apps/web/core/store/issue/root.store.ts` wires the workspace
 * issues *collection* through the plane-web indirection
 * `@/plane-web/store/issue/workspace/issue.store` (which in the CE/community
 * tier — `apps/web/ce/store/issue/workspace/issue.store.ts` — is a one-line
 * `export * from "@/store/issue/workspace/issue.store";` passthrough to the
 * concrete class defined in our `./issue.store.ts`). The same root store
 * imports `WorkspaceIssuesFilter` directly from this barrel because the
 * filter side has no enterprise override. Consumers that require the
 * override-aware instantiation should import via the plane-web path, not
 * this barrel; consumers that need only the filter store or the base types
 * should import from this barrel.
 *
 * Runtime semantics: no executable logic, no observable state, no branching —
 * this module is purely TypeScript module aggregation and import path
 * stabilization, and `tsc` erases it to nothing more than re-exports.
 */

export * from "./filter.store";
export * from "./issue.store";
