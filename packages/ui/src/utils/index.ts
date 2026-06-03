/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for the `packages/ui/src/utils` namespace. Re-exports the class-name
 * merging helper (`cn`) and icon-selection utilities (`getRandomIconName`) used
 * across `@plane/ui`.
 *
 * Provides a single stable import path so the folder's internal layout can
 * evolve without churning call sites that consume these utilities.
 */

export * from "./classname";
export * from "./icons";
