/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the module-scoped issue store package. Re-exports the
 * filter store (`./filter.store`) and the issue collection store
 * (`./issue.store`) so consumers — the root issue store wiring in
 * `apps/web/core/store/issue/root.store.ts` and module issue components in
 * `apps/web/core/components/issues/**` (via `@/hooks/store/use-issues`) —
 * can import the full module-issues contract (`IModuleIssues`,
 * `IModuleIssuesFilter`, `ModuleIssues`, `ModuleIssuesFilter`) from a single
 * stable path.
 */

export * from "./filter.store";
export * from "./issue.store";
