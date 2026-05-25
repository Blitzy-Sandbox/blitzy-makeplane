/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * HTML → document-payload conversion orchestrator for cross-workspace paste and import flows.
 *
 * Composes four steps: (1) extract asset references from HTML, (2) duplicate the referenced assets into the current workspace through an injected service, (3) replace source URLs with the duplicated asset ids, (4) convert the rewritten HTML into a `TDocumentPayload` (binary + html + json) via `convertHTMLDocumentToAllFormats`.
 *
 * The duplication step exists because pasted documents (e.g., copied from another workspace) reference assets the destination workspace cannot read; cloning them into the destination's asset store is required for the assets to render. See `helpers/paste-asset.ts` for the upstream paste-side handler dispatch.
 */

// plane imports
import type { TDocumentPayload, TDuplicateAssetData, TDuplicateAssetResponse, TEditorAssetType } from "@plane/types";
// plane web imports
import {
  extractAdditionalAssetsFromHTMLContent,
  replaceAdditionalAssetsInHTMLContent,
} from "@/plane-editor/helpers/parser";
// local imports
import { convertHTMLDocumentToAllFormats } from "./yjs-utils";

/**
 * Function to extract all assets from HTML content by collecting `src` attributes from `image-component` elements and adding additional plane-editor-specific asset ids via `extractAdditionalAssetsFromHTMLContent`.
 *
 * @param htmlContent - HTML to scan.
 * @returns Array of unique asset sources (image src + additional asset ids).
 */
const extractAssetsFromHTMLContent = (htmlContent: string): string[] => {
  // create a DOM parser
  const parser = new DOMParser();
  // parse the HTML string into a DOM document
  const doc = parser.parseFromString(htmlContent, "text/html");
  // collect all unique asset sources
  const assetSources = new Set<string>();
  // extract sources from image components
  const imageComponents = doc.querySelectorAll("image-component");
  imageComponents.forEach((component) => {
    const src = component.getAttribute("src");
    if (src) assetSources.add(src);
  });
  const additionalAssetIds = extractAdditionalAssetsFromHTMLContent(htmlContent);
  return [...Array.from(assetSources), ...additionalAssetIds];
};

/**
 * Function to replace asset sources in HTML content using a `{ oldSrc -> newSrc }` mapping, covering both `image-component` `src` attributes and additional plane-editor-specific asset references.
 *
 * @param props.htmlContent - HTML to rewrite.
 * @param props.assetMap - Mapping from old asset source / id to its newly duplicated counterpart.
 * @returns Rewritten HTML.
 */
const replaceAssetsInHTMLContent = (props: { htmlContent: string; assetMap: Record<string, string> }): string => {
  const { htmlContent, assetMap } = props;
  // create a DOM parser
  const parser = new DOMParser();
  // parse the HTML string into a DOM document
  const doc = parser.parseFromString(htmlContent, "text/html");
  // replace sources in image components
  const imageComponents = doc.querySelectorAll("image-component");
  imageComponents.forEach((component) => {
    const oldSrc = component.getAttribute("src");
    if (oldSrc && assetMap[oldSrc]) {
      component.setAttribute("src", assetMap[oldSrc]);
    }
  });
  // replace additional sources
  const replacedHTMLContent = replaceAdditionalAssetsInHTMLContent({
    htmlContent: doc.body.innerHTML,
    assetMap,
  });
  return replacedHTMLContent;
};

/**
 * End-to-end orchestrator that takes raw HTML, duplicates referenced assets into the current workspace via `duplicateAssetService`, rewrites the HTML to point at the duplicates, and converts the result to a `TDocumentPayload` (binary + json + html) ready for persistence.
 *
 * The composition is: extract assets → duplicate via service → replace URLs in HTML → `convertHTMLDocumentToAllFormats`. Used for cross-workspace paste / import flows where the pasted document references assets the destination workspace does not yet own.
 *
 * @param props.descriptionHTML - The HTML document to process.
 * @param props.entityId - Target entity id receiving the duplicated assets (issue/page/etc.).
 * @param props.entityType - `TEditorAssetType` distinguishing which asset bucket the duplicates land in.
 * @param props.projectId - Optional project scope (undefined for workspace-scope entities).
 * @param props.variant - `"rich"` (rich-text editor schema) or `"document"` (document editor schema); selects the extension set used for HTML→binary conversion.
 * @param props.duplicateAssetService - Async service that takes asset ids and returns an `{ oldId -> newId }` map; the service implementation typically posts to the apiserver duplicate-asset endpoint.
 * @returns Promise resolving to the `TDocumentPayload` with `description_json`, `description_html`, and base64-encoded `description_binary`.
 */
export const getEditorContentWithReplacedAssets = async (props: {
  descriptionHTML: string;
  entityId: string;
  entityType: TEditorAssetType;
  projectId: string | undefined;
  variant: "rich" | "document";
  duplicateAssetService: (params: TDuplicateAssetData) => Promise<TDuplicateAssetResponse>;
}): Promise<TDocumentPayload> => {
  const { descriptionHTML, entityId, entityType, projectId, variant, duplicateAssetService } = props;
  let replacedDescription = descriptionHTML;
  // step 1: extract image assets from the description
  const assetIds = extractAssetsFromHTMLContent(descriptionHTML);
  if (assetIds.length !== 0) {
    // step 2: duplicate the image assets
    const duplicateAssetsResponse = await duplicateAssetService({
      entity_id: entityId,
      entity_type: entityType,
      project_id: projectId,
      asset_ids: assetIds,
    });
    if (Object.keys(duplicateAssetsResponse ?? {}).length > 0) {
      // step 3: replace the image assets in the description
      replacedDescription = replaceAssetsInHTMLContent({
        htmlContent: descriptionHTML,
        assetMap: duplicateAssetsResponse,
      });
    }
  }
  // step 4: convert the description to the document payload
  const documentPayload = convertHTMLDocumentToAllFormats({
    document_html: replacedDescription,
    variant,
  });
  return documentPayload;
};
