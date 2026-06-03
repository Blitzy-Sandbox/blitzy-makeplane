/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Paste-time asset normalization entry point.
 *
 * When the editor's `handlePaste` (`core/props.ts:41`) reads `text/plane-editor-html` from the clipboard, the payload references assets that may belong to another workspace; this helper walks the HTML, dispatches each matched element to a registered `assetDuplicationHandler` from `@/plane-editor/helpers/asset-duplication`, and returns rewritten HTML so the pasted markup is normalized before it lands in the document.
 */

import { assetDuplicationHandlers } from "@/plane-editor/helpers/asset-duplication";

/**
 * Walks a temporary in-memory DOM built from `htmlContent`, dispatches each matched element to its `assetDuplicationHandler`, and returns the rewritten HTML so the pasted markup is normalized before insertion.
 *
 * Wired into the paste pipeline by `core/props.ts:44` (`processAssetDuplication(htmlContent)`); downstream, full-document conversions are then handled by `helpers/parser.ts`. Each registered handler returns `{ shouldProcess, modifiedHtml }`; only handlers that mark `shouldProcess: true` mutate the in-flight HTML.
 *
 * @param htmlContent - Raw HTML pasted by the user (from `text/plane-editor-html` clipboard payload).
 * @returns Object with `processedHtml` — the same HTML with asset references rewritten through the registered handlers.
 */
export const processAssetDuplication = (htmlContent: string): { processedHtml: string } => {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlContent;

  let processedHtml = htmlContent;

  // Process each registered component type
  for (const [componentName, handler] of Object.entries(assetDuplicationHandlers)) {
    const elements = tempDiv.querySelectorAll(componentName);

    if (elements.length > 0) {
      elements.forEach((element) => {
        const result = handler({ element, originalHtml: processedHtml });
        if (result.shouldProcess) {
          processedHtml = result.modifiedHtml;
        }
      });

      // Update tempDiv with processed HTML for next iteration
      tempDiv.innerHTML = processedHtml;
    }
  }

  return { processedHtml };
};
