/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extension-point type for the page entity in the `@plane/types/page` subfolder.
 *
 * Provides a stable named operand for the `TPage` intersection in `./core.ts` so that
 * feature-flagged builds and downstream forks can layer additional fields onto the
 * canonical page model without modifying the shared core shape. The base export is
 * intentionally permissive (`object`) — narrower per-build declarations belong in
 * the consumer that owns them.
 *
 * Consumed by `./core.ts` (`TPage` intersection) and by any plane-edition build that
 * re-declares the alias to attach additional fields.
 */

/**
 * Extensibility hook layered into `TPage` via intersection.
 *
 * Defined as the wide `object` type so that the base build imposes no additional
 * constraints on a page record. Feature builds may narrow this alias to introduce
 * additional required/optional fields (for example, page hierarchy parent ids, EE-only
 * presence metadata, or rollup counters) without touching the shared `TPage` shape
 * in `./core.ts`.
 *
 * Per AAP §0.2.4 "no refactoring, renaming, or restructuring of any kind", the base
 * `object` declaration is preserved verbatim and must not be narrowed here.
 */
export type TPageExtended = object;
