/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel entrypoint for the full-screen image viewer subfeature.
 *
 * Re-exports `ImageFullScreenActionRoot` from `./root` so the parent toolbar
 * (`../root.tsx`) can import via the directory path without referencing the
 * implementation file. No logic, state, or side effects — pure module-boundary
 * management.
 */

export * from "./root";
