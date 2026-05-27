/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sibling helper for the `title-update/` subtree of the `apps/live` real-time
 * collaboration layer. Exports {@link extractTextFromHTML}, which delegates to
 * the centralized `sanitizeHTML` from `@plane/utils` to convert TipTap-generated
 * `title` HTML fragments into plain page-title text — preferred over regex
 * because it handles nested tags, malformed input, and injection vectors.
 */
// INTENT UNCLEAR: extractTextFromHTML is exported but has no in-repo callers within title-update/; title-sync.ts imports the @plane/editor version instead.

import { sanitizeHTML } from "@plane/utils";

/**
 * Utility function to extract text from HTML content — converts an HTML string
 * to plain text for safe display as a page title.
 *
 * Delegates to `sanitizeHTML` from `@plane/utils` (which strips tags via
 * `sanitize-html` with `allowedTags: []` and trims whitespace), preferred over
 * a regex-based stripper because it handles nested tags, malformed input, and
 * injection vectors that a regex would miss. The whitespace trim is acceptable
 * here because page titles are single-line by convention. The `|| ""` fallback
 * coerces an empty sanitized result into the empty string so callers always
 * receive a string.
 *
 * @param html - HTML string to sanitize (may contain TipTap-generated tags or
 *   malformed markup).
 * @returns The sanitized plain-text output, or `""` when sanitization yields
 *   an empty value.
 *
 * @remarks
 * Caller note: `apps/live/src/extensions/title-sync.ts` imports a separate
 * `extractTextFromHTML` from `@plane/editor`, not this one. This export is
 * provided as a sibling helper for future title-update logic within the
 * `title-update/` subtree.
 */
export const extractTextFromHTML = (html: string): string => {
  // Use sanitizeHTML to safely extract text and remove all HTML tags
  // This is more secure than regex as it handles edge cases and prevents injection
  // Note: sanitizeHTML trims whitespace, which is acceptable for title extraction
  return sanitizeHTML(html) || "";
};
