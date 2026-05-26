/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Client-editor (CE) HTML asset extraction and replacement helpers.
 *
 * Both exports are intentional no-op placeholders in the CE build: they preserve
 * the public API shape that `core/helpers/parser.ts` depends on. The private
 * `extractAssetsFromHTMLContent` and `replaceAssetsInHTMLContent` helpers in
 * that module invoke these exports and then feed the public
 * `getEditorContentWithReplacedAssets` flow, but no HTML parsing or rewriting
 * is performed here. CE only ships `CORE_EXTENSIONS` whose asset references
 * (currently `image-component` nodes) are handled directly by the core parser;
 * EE may shadow this module via the `@/plane-editor/helpers/parser` alias
 * (mapped to `./src/ce/*` in the package tsconfig) to add enterprise-specific
 * asset extraction and rewriting.
 */

/**
 * @description Extracts URLs/identifiers of additional assets (assets
 * contributed by extensions beyond the core set) referenced in HTML content.
 * Currently a no-op placeholder in the CE build; returns an empty array
 * regardless of input. EE may override this function via the
 * `@/plane-editor/helpers/parser` alias to scan HTML for enterprise extension
 * asset references.
 * @param htmlContent HTML string to scan; intentionally unused in the CE no-op
 * implementation, signalled by the leading-underscore parameter name
 * (`_htmlContent`).
 * @returns {string[]} Array of additional asset sources/identifiers; always
 * `[]` in CE.
 */
export const extractAdditionalAssetsFromHTMLContent = (_htmlContent: string): string[] => [];

/**
 * @description Rewrites additional asset references in HTML content using the
 * provided ID map (e.g., when duplicating documents that contain
 * extension-specific assets). Currently a no-op placeholder in the CE build;
 * returns `props.htmlContent` unchanged and the `assetMap` is destructured-
 * and-ignored. EE may override this function via the
 * `@/plane-editor/helpers/parser` alias to rewrite enterprise extension asset
 * IDs using the ID map.
 * @param props
 * @param props.htmlContent HTML string to rewrite; returned unchanged in CE.
 * @param props.assetMap Mapping from old asset identifier to new asset
 * identifier; ignored in CE.
 * @returns {string} HTML content with replaced additional assets; the input
 * HTML is returned unchanged in CE.
 */
export const replaceAdditionalAssetsInHTMLContent = (props: {
  htmlContent: string;
  assetMap: Record<string, string>;
}): string => {
  const { htmlContent } = props;
  return htmlContent;
};
