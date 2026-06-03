/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Client-editor (CE) asset duplication helpers.
 *
 * This module is the registry of per-component duplication strategies invoked
 * when pasting Plane-specific HTML (clipboard MIME type
 * `text/plane-editor-html`) into the editor. The consumer chain is:
 * `core/props.ts` paste handler →
 * `core/helpers/paste-asset.ts::processAssetDuplication` (entry point) →
 * `assetDuplicationHandlers` exported below.
 *
 * Why duplicate: asset-bearing components like images must be cloned rather
 * than shared between the source and pasted nodes; otherwise both nodes would
 * point to the same backend asset and a future delete on one would orphan the
 * other. EE may shadow this module via the
 * `@/plane-editor/helpers/asset-duplication` alias (resolved per the editor
 * package's `tsconfig.json` paths) to register additional component handlers
 * without changing the consumer call site.
 */

import { v4 as uuidv4 } from "uuid";
import { ECustomImageAttributeNames, ECustomImageStatus } from "@/extensions/custom-image/types";

/**
 * Input passed to each `AssetDuplicationHandler`: the DOM element being
 * processed and the surrounding original HTML snippet. `originalHtml` is the
 * working HTML accumulated across handler iterations — each handler returns
 * the new running value as `AssetDuplicationResult.modifiedHtml`.
 */
export type AssetDuplicationContext = {
  element: Element;
  originalHtml: string;
};

/**
 * Output returned by each `AssetDuplicationHandler`.
 *
 * `shouldProcess` is `false` when the asset is non-duplicable (for example,
 * remote `http://` URLs that the editor does not own); in that case
 * `modifiedHtml` equals the input `originalHtml` unchanged.
 */
export type AssetDuplicationResult = {
  modifiedHtml: string;
  shouldProcess: boolean;
};

/**
 * Function signature for a per-component asset duplication handler. Handlers
 * are registered by component tag name in `assetDuplicationHandlers` and
 * invoked by `processAssetDuplication` for every matching DOM element in the
 * pasted HTML.
 */
export type AssetDuplicationHandler = (context: AssetDuplicationContext) => AssetDuplicationResult;

/**
 * Duplication handler for custom-image components.
 *
 * Skips images with no `src` or with an `http`-prefixed `src` — those are
 * remote/external images the editor does not own and require no duplication
 * (returns `shouldProcess: false` with `originalHtml` unchanged).
 *
 * For local (Plane-owned) images, generates a fresh UUID via `uuidv4()`, marks
 * the element with `ECustomImageStatus.DUPLICATING` and a new
 * `ECustomImageAttributeNames.ID`, then rewrites every occurrence of the
 * original tag in the surrounding HTML via `replaceAll` (if the same image
 * appears multiple times in the pasted snippet, all instances are rewritten
 * with the new ID — this multi-occurrence behavior is intentional). The
 * `DUPLICATING` status is a transient mid-flight signal the asset-restore
 * subsystem watches; a follow-up backend call resolves the real asset ID and
 * transitions the status to `UPLOADED` (or `DUPLICATION_FAILED` on error).
 */
const imageComponentHandler: AssetDuplicationHandler = ({ element, originalHtml }) => {
  const src = element.getAttribute("src");

  if (!src || src.startsWith("http")) {
    return { modifiedHtml: originalHtml, shouldProcess: false };
  }

  // Capture the original HTML BEFORE making any modifications
  const originalTag = element.outerHTML;

  // Use setAttribute to update attributes
  const newId = uuidv4();
  element.setAttribute(ECustomImageAttributeNames.STATUS, ECustomImageStatus.DUPLICATING);
  element.setAttribute(ECustomImageAttributeNames.ID, newId);

  // Get the modified HTML AFTER the changes
  const modifiedTag = element.outerHTML;
  const modifiedHtml = originalHtml.replaceAll(originalTag, modifiedTag);

  return { modifiedHtml, shouldProcess: true };
};

/**
 * Registry of asset duplication handlers keyed by component tag name.
 *
 * Currently registers only `"image-component" → imageComponentHandler`. New
 * entries extend the registry without changing the consumer call site in
 * `core/helpers/paste-asset.ts::processAssetDuplication`, which iterates
 * `Object.entries(assetDuplicationHandlers)` and applies each handler to every
 * `tempDiv.querySelectorAll(componentName)` result in the pasted HTML.
 */
export const assetDuplicationHandlers: Record<string, AssetDuplicationHandler> = {
  "image-component": imageComponentHandler,
};
