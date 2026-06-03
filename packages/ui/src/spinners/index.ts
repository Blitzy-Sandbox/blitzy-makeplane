/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Re-exports the `Spinner` and `CircularBarSpinner` components (and the
 * `ISpinner` prop interface) used for indeterminate loading states across
 * the UI.
 *
 * Public barrel for `packages/ui/src/spinners` — consumers import these
 * symbols from `@plane/ui` (resolved via the package's `src/index.ts`
 * aggregator) rather than the underlying implementation files so the
 * internal layout can evolve without breaking call sites.
 */

export * from "./circular-spinner";
export * from "./circular-bar-spinner";
