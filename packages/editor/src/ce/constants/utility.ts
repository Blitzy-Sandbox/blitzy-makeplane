/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Node-to-file-storage-bucket mapping for the editor's asset lifecycle bookkeeping.
 *
 * Associates extension nodes (currently `IMAGE` and `CUSTOM_IMAGE`) with their
 * corresponding storage key in `ImageExtensionStorage` (specifically `deletedImageSet`,
 * the bucket tracking pending-deletion image assets). Consumed by asset cleanup logic
 * when nodes are removed from the document (see `core/plugins/file/restore.ts` and
 * `core/plugins/file/delete.ts`).
 */

// plane imports
import type { ADDITIONAL_EXTENSIONS } from "@plane/utils";
import { CORE_EXTENSIONS } from "@plane/utils";
// plane editor imports
import type { ExtensionFileSetStorageKey } from "@/plane-editor/types/storage";

/**
 * Type shape for the node-to-file-set mapping.
 *
 * `Partial` because the map is sparse — only extensions that need special
 * asset-lifecycle handling are listed. Keys are extension names from
 * `CORE_EXTENSIONS` or `ADDITIONAL_EXTENSIONS`; values declare which
 * `ExtensionFileSetStorageKey` bucket tracks the node's pending-deletion assets.
 */
export type NodeFileMapType = Partial<
  Record<
    CORE_EXTENSIONS | ADDITIONAL_EXTENSIONS,
    {
      fileSetName: ExtensionFileSetStorageKey;
    }
  >
>;

/**
 * Maps extension node names to the storage bucket that tracks their pending-deletion assets.
 *
 * Currently maps `IMAGE` and `CUSTOM_IMAGE` to `deletedImageSet`; both share the same bucket
 * because image asset deletion logic is unified across the two image extensions
 * (see `core/extensions/image/` and `core/extensions/custom-image/`). Read by asset
 * orphan-cleanup logic when document nodes are removed.
 */
export const NODE_FILE_MAP: NodeFileMapType = {
  [CORE_EXTENSIONS.IMAGE]: {
    fileSetName: "deletedImageSet",
  },
  [CORE_EXTENSIONS.CUSTOM_IMAGE]: {
    fileSetName: "deletedImageSet",
  },
};
