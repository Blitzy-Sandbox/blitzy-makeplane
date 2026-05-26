/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Name registries for CE extensions beyond the core extension set.
 *
 * This module is the canonical authority for `ADDITIONAL_EXTENSIONS`, re-exported
 * via `packages/editor/src/index.ts` and re-exported as a workspace-shared name
 * by `@plane/utils` for cross-package access. Both exports are currently empty
 * placeholders in CE, reserved as substitution seams for EE extensions that
 * extend the core extension set.
 */

/**
 * TypeScript enum of all extensions added beyond `CORE_EXTENSIONS`.
 *
 * Currently empty in CE — this is the documented intent, not an incomplete
 * implementation. The enum exists as a stable, type-narrowable name registry so
 * callers (e.g., `NODE_FILE_MAP` in `./utility.ts`, `ADDITIONAL_ASSETS_META_DATA_RECORD`
 * in `./assets.ts`) can key registries on `ADDITIONAL_EXTENSIONS` members without
 * type-cast workarounds when EE adds entries. EE may augment this enum to register
 * enterprise extension names; the empty-enum compiles to a runtime `{}` object so
 * consumers iterating its keys behave correctly even in the CE case.
 */
export enum ADDITIONAL_EXTENSIONS {}

/**
 * Names of block-level node types contributed by additional (non-core) extensions.
 *
 * Currently empty in CE; consumed by block-handling logic in `core/extensions/`
 * and `core/plugins/` to recognize which DOM/ProseMirror nodes are block-level
 * vs. inline when added beyond the core extensions. EE may extend this list to
 * register enterprise block node types.
 */
export const ADDITIONAL_BLOCK_NODE_TYPES = [];
