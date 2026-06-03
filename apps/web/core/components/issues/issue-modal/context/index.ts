/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public API surface for the issue-modal React Context layer.
 *
 * Re-exports every symbol from `./issue-modal-context` so consumers can
 * import the modal context via the folder path
 * (e.g. `@/components/issues/issue-modal/context`) rather than coupling
 * to the implementation filename. Removing this barrel would force all
 * consumers — including `IssueModalProvider` in
 * `apps/web/ce/components/issues/issue-modal/provider.tsx` and the
 * `useIssueModal` hook in `apps/web/core/hooks/context/use-issue-modal.tsx`
 * — to import the underlying source file directly.
 */

export * from "./issue-modal-context";
