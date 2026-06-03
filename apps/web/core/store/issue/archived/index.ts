/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the archived-issue store namespace. Lets consumers
 * `import { ArchivedIssues, IArchivedIssues, ArchivedIssuesFilter, IArchivedIssuesFilter }
 * from "@/store/issue/archived"` without reaching into individual files, keeping the
 * EIssuesStoreType.ARCHIVED slice's filter + list pair behind a single import path.
 *
 * Re-exports:
 *   - `./filter.store` — `IArchivedIssuesFilter` interface and `ArchivedIssuesFilter`
 *     class (the per-project filter store for archived issues, extending
 *     `IssueFilterHelperStore`).
 *   - `./issue.store` — `IArchivedIssues` interface and `ArchivedIssues` class (the
 *     archived issue list store, extending `BaseIssuesStore`; restore + bulk
 *     operations only — `updateIssue`/`archiveIssue`/`quickAddIssue` are intentionally
 *     undefined for the archived scope).
 *
 * Consumers:
 *   - `apps/web/core/store/issue/root.store.ts` — composes `archivedIssuesFilter` and
 *     `archivedIssues` into the issue domain composition root and is the typed
 *     entrypoint for the `EIssuesStoreType.ARCHIVED` slice of the issue subsystem.
 */

export * from "./filter.store";
export * from "./issue.store";
