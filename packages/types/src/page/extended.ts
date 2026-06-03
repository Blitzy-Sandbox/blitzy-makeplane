/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extension-point alias intersected into `TPage` so feature-flagged builds can
 * layer additional fields onto the canonical page shape without modifying
 * `./core.ts`.
 */

/**
 * Extensibility hook layered into `TPage`; the base `object` declaration is
 * preserved per AAP §0.2.4 (no restructuring) and must not be narrowed here —
 * narrower per-build declarations belong in the consuming edition.
 */
export type TPageExtended = object;
