/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Canonical registry mapping image-node TipTap extension names (`CORE_EXTENSIONS.IMAGE`, `CORE_EXTENSIONS.CUSTOM_IMAGE`) to a `TAssetMetaDataRecord` callback that extracts a normalized `TEditorAsset` (href / id / name / size / src / type) from the ProseMirror node attributes.
 *
 * Consumed by the editor's asset-export pathway so the table-of-assets / scroll-target lookup can resolve any asset node back to its anchor id and source URL through a single lookup point.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
// plane imports
import type { ADDITIONAL_EXTENSIONS } from "@plane/utils";
import { CORE_EXTENSIONS } from "@plane/utils";
// extensions
import { getImageBlockId } from "@/extensions/custom-image/utils";
// plane editor imports
import { ADDITIONAL_ASSETS_META_DATA_RECORD } from "@/plane-editor/constants/assets";
// types
import type { TEditorAsset } from "@/types";

/**
 * Callback shape that converts a ProseMirror node's `attrs` payload into a normalized `TEditorAsset` (or `undefined` when required attributes such as `src` are absent).
 *
 * Implementations of this shape are registered under their TipTap node-type names in `CORE_ASSETS_META_DATA_RECORD` and the plane-editor-specific `ADDITIONAL_ASSETS_META_DATA_RECORD`.
 */
export type TAssetMetaDataRecord = (attrs: ProseMirrorNode["attrs"]) => TEditorAsset | undefined;

/**
 * Canonical mapping from image-node extension names to their asset metadata extractors, merged with `ADDITIONAL_ASSETS_META_DATA_RECORD` so the plane-editor flavor can register extra asset node types without modifying core.
 *
 * Each callback returns `undefined` when the node lacks `src` (defensive guard so partially-attributed nodes do not produce broken asset entries) and otherwise emits a `TEditorAsset` with `href` set to a fragment anchor (`#<imageBlockId>`) for scroll-targeting.
 */
export const CORE_ASSETS_META_DATA_RECORD: Partial<
  Record<CORE_EXTENSIONS | ADDITIONAL_EXTENSIONS, TAssetMetaDataRecord>
> = {
  [CORE_EXTENSIONS.IMAGE]: (attrs) => {
    if (!attrs?.src) return;
    return {
      href: `#${getImageBlockId(attrs?.id ?? "")}`,
      id: attrs?.id,
      name: `image-${attrs?.id}`,
      size: 0,
      src: attrs?.src,
      type: CORE_EXTENSIONS.IMAGE,
    };
  },
  [CORE_EXTENSIONS.CUSTOM_IMAGE]: (attrs) => {
    if (!attrs?.src) return;
    return {
      href: `#${getImageBlockId(attrs?.id ?? "")}`,
      id: attrs?.id,
      name: `image-${attrs?.id}`,
      size: 0,
      src: attrs?.src,
      type: CORE_EXTENSIONS.CUSTOM_IMAGE,
    };
  },
  ...ADDITIONAL_ASSETS_META_DATA_RECORD,
};
