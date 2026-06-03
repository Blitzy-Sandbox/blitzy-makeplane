/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Editor asset model — image asset shape plus the union over additional
 * shared asset variants supplied via the `@/plane-editor` overlay.
 *
 * Consumers: `core/helpers/assets.ts` (builds asset records from
 * ProseMirror node attrs), `core/extensions/utility.ts` (stores
 * `assetsList: TEditorAsset[]` in the editor's storage slot and exposes
 * the `updateAssetsList` command), `core/extensions/custom-image/`, and
 * `core/plugins/file/` (drives upload/delete lifecycle). The
 * `IEditorProps.onAssetChange` callback in `core/types/editor.ts`
 * streams these records to host applications.
 */

// constants
import type { CORE_EXTENSIONS } from "@/constants/extension";
// plane editor imports
import type { TAdditionalEditorAsset } from "@/plane-editor/types/asset";

/**
 * Shape of an image asset tracked by the editor, used by both the legacy
 * `IMAGE` node and Plane's componentized `CUSTOM_IMAGE` node.
 *
 * Field semantics:
 *   - `src` is the renderable URL used in the rendered `<img>` tag; this
 *     is the value returned by `fileHandler.upload` / `getAssetSrc` and
 *     is what `fileHandler.delete(assetSrc)` expects as its argument.
 *   - `href` is a DOM fragment identifier of the form
 *     `#editor-image-block-{id}` produced by
 *     `getImageBlockId(id)` (see
 *     `core/extensions/custom-image/utils.ts`); it points at the
 *     rendered image block in the editor DOM for in-document anchor
 *     navigation and is distinct from `src` — they are never
 *     interchangeable.
 *   - `id` is the asset's stable identifier used by the editor to
 *     deduplicate and look up entries in
 *     `UtilityExtensionStorage.assetsList`
 *     (see `core/extensions/utility.ts`); it is the same value
 *     consumed by `fileHandler.checkIfAssetExists(assetId)`.
 *   - `name` is the display filename surfaced in asset-metadata UI;
 *     for image nodes it defaults to `image-{id}`.
 *   - `type` is the union discriminant narrowing to
 *     `CORE_EXTENSIONS.IMAGE` (legacy image extension) or
 *     `CORE_EXTENSIONS.CUSTOM_IMAGE` (Plane's componentized image
 *     extension that adds resize, alignment, and upload-state controls).
 */
export type TEditorImageAsset = {
  href: string;
  id: string;
  name: string;
  src: string;
  type: CORE_EXTENSIONS.IMAGE | CORE_EXTENSIONS.CUSTOM_IMAGE;
};

/**
 * Union of every editor asset variant.
 *
 * Combines `TEditorImageAsset` with overlay-specific variants declared
 * in `@/plane-editor/types/asset` (`never` in CE, populated in editions
 * that ship attachment/file-asset nodes). Unified into a single type
 * so the entire asset lifecycle — storage, deduplication, and the
 * `IEditorProps.onAssetChange` stream — flows through one shape
 * regardless of the underlying asset kind.
 */
export type TEditorAsset = TEditorImageAsset | TAdditionalEditorAsset;
