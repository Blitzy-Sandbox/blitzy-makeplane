/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel entry point for the `@plane/ui` header feature area. Re-exports the
 * `Header` composition primitive (with attached `Header.LeftItem` and
 * `Header.RightItem` slot subcomponents) and the `EHeaderVariant` enum from
 * `./header`. Consumed at `@plane/ui` package level via `packages/ui/src/index.ts`.
 */

export * from "./header";
