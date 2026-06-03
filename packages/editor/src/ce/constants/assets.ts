/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Asset metadata registry for CE extensions beyond the core extension set.
 *
 * Currently empty in CE; EE may override this module to populate asset metadata
 * for enterprise extensions. Consumed by the editor's asset metadata aggregation
 * in `core/helpers/assets.ts`, which spreads this record into the unified
 * `Record<CORE_EXTENSIONS | ADDITIONAL_EXTENSIONS, TAssetMetaDataRecord>` used
 * for asset-restore and orphan-cleanup logic.
 */

// helpers
import type { TAssetMetaDataRecord } from "@/helpers/assets";
// local imports
import type { ADDITIONAL_EXTENSIONS } from "./extensions";

/**
 * Typed, currently-empty asset metadata registry keyed by additional-extension name.
 *
 * Defining the typed shape upfront lets future entries be added without touching
 * call sites that read this record (e.g., asset-restore and orphan-cleanup logic
 * in `core/helpers/assets.ts`). Each entry maps an `ADDITIONAL_EXTENSIONS` member
 * to a `TAssetMetaDataRecord` resolver that extracts asset attributes from a
 * ProseMirror node's attrs.
 */
export const ADDITIONAL_ASSETS_META_DATA_RECORD: Partial<Record<ADDITIONAL_EXTENSIONS, TAssetMetaDataRecord>> = {};
