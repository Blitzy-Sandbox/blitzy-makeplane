/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Storage-key alias derived from the image extension's storage shape, used by
 * `NODE_FILE_MAP` in `ce/constants/utility.ts`.
 */

// extensions
import type { ImageExtensionStorage } from "@/extensions/image";

/**
 * Narrowed type for the file-set storage key used by node-to-file mappings.
 *
 * Currently equals the literal `'deletedImageSet'` — extracted via
 * `Extract<keyof ImageExtensionStorage, 'deletedImageSet'>` so the type
 * automatically tracks any rename of the `deletedImageSet` key in
 * `ImageExtensionStorage`'s shape (compile-time coupling without runtime
 * overhead).
 *
 * Consumed by `NodeFileMapType` in `ce/constants/utility.ts`.
 */
export type ExtensionFileSetStorageKey = Extract<keyof ImageExtensionStorage, "deletedImageSet">;
