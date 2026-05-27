/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel entry point for the Badge subsystem of `@plane/ui`.
 *
 * Re-exports the {@link Badge} component (a forwardRef'd `<button>` with
 * variant/size-driven styling) and its `BadgeProps` interface from
 * `./badge`, which in turn pulls token tables and class-computation
 * helpers from `./helper`. Kept as a single star re-export so consumers
 * can import from the folder path (`@plane/ui/badge`) without coupling
 * to the implementation file name.
 */

export * from "./badge";
