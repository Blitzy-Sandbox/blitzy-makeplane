/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Y.js (CRDT) encoding, decoding, and merging utilities for the `@plane/editor` package.
 *
 * # CRDT semantics
 * Yjs converges replicas via vector clocks (Lamport-style timestamps); concurrent edits resolve **last-writer-wins** at the operation level. There is **no explicit conflict resolution callback** — convergence is structural, so no code in this package or in `apps/live` registers a resolver. Two clients applying the same update set in any order produce byte-identical documents.
 *
 * # Binary update format
 * Y.js encodes incremental updates as binary buffers (`Uint8Array`). `Y.applyUpdate(doc, update)` merges a buffer into a document atomically — the merge is commutative, associative, and idempotent, so applying the same update twice is a no-op.
 *
 * # Persistence lifecycle (tech spec §5.2.5.4)
 * Encoded updates produced by the helpers in this module flow to `apps/live` for persistence with a **10-second debounce** (`apps/live/src/extensions/database.ts`). On first edit of legacy content that lacks a binary representation, `apps/live` performs an **HTML→binary backfill** using `getBinaryDataFromDocumentEditorHTMLString` so the document gains a CRDT baseline.
 *
 * # Schema split
 * Two extension sets back two ProseMirror schemas: `RICH_TEXT_EDITOR_EXTENSIONS` (issue comments, descriptions) and `DOCUMENT_EDITOR_EXTENSIONS` (full-fidelity pages). Helper variants exist for each so encoded binaries round-trip through the schema they were produced for. Encoded binaries are NOT interchangeable across schemas.
 */

import { Buffer } from "buffer";
import type { Extensions, JSONContent } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import { generateHTML, generateJSON } from "@tiptap/html";
import { prosemirrorJSONToYDoc, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import * as Y from "yjs";
// extensions
import type { TDocumentPayload } from "@plane/types";
import {
  CoreEditorExtensionsWithoutProps,
  DocumentEditorExtensionsWithoutProps,
} from "@/extensions/core-without-props";
import { TitleExtensions } from "@/extensions/title-extension";
import { sanitizeHTML } from "@plane/utils";

// editor extension configs
const RICH_TEXT_EDITOR_EXTENSIONS = CoreEditorExtensionsWithoutProps;
const DOCUMENT_EDITOR_EXTENSIONS = [...CoreEditorExtensionsWithoutProps, ...DocumentEditorExtensionsWithoutProps];
/**
 * TipTap extension set backing the title editor schema (separate from the content schema so the title's Y.Doc fragment can be merged independently from the body).
 *
 * Consumed by `apps/live/src/extensions/title-sync.ts` to build the title Y.Doc fragment that is merged into the document under the `"title"` xml-fragment key.
 */
export const TITLE_EDITOR_EXTENSIONS: Extensions = TitleExtensions;
// editor schemas
const richTextEditorSchema = getSchema(RICH_TEXT_EDITOR_EXTENSIONS);
const documentEditorSchema = getSchema(DOCUMENT_EDITOR_EXTENSIONS);

/**
 * Apply updates to a document and return the merged document as binary.
 *
 * Constructs a fresh `Y.Doc`, applies the base `document` buffer, optionally applies an additional `updates` buffer on top, and returns the encoded merged state. Because Y.js merges are commutative + idempotent (CRDT semantics), the order of the two applies is invariant: callers can pass either buffer as `document` or `updates`.
 *
 * @description apply updates to a doc and return the updated doc in binary format
 * @param {Uint8Array} document - Base Y.js binary update.
 * @param {Uint8Array} updates - Optional additional binary update merged on top of `document`.
 * @returns {Uint8Array} Encoded merged state as `Uint8Array`.
 */
export const applyUpdates = (document: Uint8Array, updates?: Uint8Array): Uint8Array => {
  const yDoc = new Y.Doc();
  Y.applyUpdate(yDoc, document);
  if (updates) {
    Y.applyUpdate(yDoc, updates);
  }

  const encodedDoc = Y.encodeStateAsUpdate(yDoc);
  return encodedDoc;
};

/**
 * Encodes a Y.js binary update as a base64 string for transport over JSON (`description_binary` field on the page payload).
 *
 * Consumed by `apps/web/core/hooks/use-page-fallback.ts` when reconstructing missing binaries from HTML.
 *
 * @description this function encodes binary data to base64 string
 * @param {Uint8Array} document - Binary Y.js update.
 * @returns {string} Base64 string.
 */
export const convertBinaryDataToBase64String = (document: Uint8Array): string =>
  Buffer.from(document).toString("base64");

/**
 * Decodes a base64-encoded Y.js update back to its binary form for `Y.applyUpdate`.
 *
 * @description this function decodes base64 string to binary data
 * @param {string} document - Base64 string (typically read from `description_binary` on a page payload).
 * @returns {Buffer<ArrayBuffer>} Decoded `Buffer<ArrayBuffer>` ready for `Y.applyUpdate`.
 */
export const convertBase64StringToBinaryData = (document: string): Buffer<ArrayBuffer> =>
  Buffer.from(document, "base64");

/**
 * Converts an HTML string to its Y.js binary equivalent under the **rich text editor schema** (`RICH_TEXT_EDITOR_EXTENSIONS`).
 *
 * Pipeline: HTML → ProseMirror JSON via `generateJSON` → Y.Doc via `prosemirrorJSONToYDoc` (xml-fragment key `"default"`) → binary via `Y.encodeStateAsUpdate`. The xml-fragment key MUST stay `"default"` because consumers (live server, fallback hook) decode the same fragment by name.
 *
 * @description this function generates the binary equivalent of html content for the rich text editor
 * @param {string} descriptionHTML - HTML content (defaults to `<p></p>` when empty).
 * @returns {Uint8Array} Y.js binary update suitable for `Y.applyUpdate`.
 */
export const getBinaryDataFromRichTextEditorHTMLString = (descriptionHTML: string): Uint8Array => {
  // convert HTML to JSON
  const contentJSON = generateJSON(descriptionHTML ?? "<p></p>", RICH_TEXT_EDITOR_EXTENSIONS);
  // convert JSON to Y.Doc format
  const transformedData = prosemirrorJSONToYDoc(richTextEditorSchema, contentJSON, "default");
  // convert Y.Doc to Uint8Array format
  const encodedData = Y.encodeStateAsUpdate(transformedData);
  return encodedData;
};

/**
 * Builds a ProseMirror JSON document containing a single level-1 heading whose text is `text` (or an empty heading when `text` is empty).
 *
 * Consumed by `getBinaryDataFromDocumentEditorHTMLString` (for title-injecting backfills) and by `apps/live/src/extensions/title-sync.ts` (to build the title fragment from a server-issued title).
 *
 * @param {string} text - Title text; empty string is treated as an empty heading node.
 * @returns {JSONContent} ProseMirror JSON with a single `heading` (level 1) node.
 */
export const generateTitleProsemirrorJson = (text: string): JSONContent => {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        ...(text
          ? {
              content: [
                {
                  type: "text",
                  text,
                },
              ],
            }
          : {}),
      },
    ],
  };
};

/**
 * Converts an HTML string to its Y.js binary equivalent under the **document editor schema** (`DOCUMENT_EDITOR_EXTENSIONS`), optionally merging a `title` into the `"title"` xml-fragment.
 *
 * Backfill path: when `apps/live/src/extensions/database.ts` finds a page without `description_binary`, it calls this helper with the legacy `description_html` to create the initial CRDT baseline (tech spec §5.2.5.4 HTML→binary backfill).
 *
 * @description this function generates the binary equivalent of html content for the document editor
 * @param {string} descriptionHTML - The HTML content to convert (defaults to `<p></p>`).
 * @param {string} [title] - Optional title; when provided, a `heading` level-1 node is encoded into the `"title"` xml-fragment so the title and body share one Y.Doc.
 * @returns {Uint8Array} Y.js binary update suitable for `Y.applyUpdate`.
 */
export const getBinaryDataFromDocumentEditorHTMLString = (descriptionHTML: string, title?: string): Uint8Array => {
  // convert HTML to JSON
  const contentJSON = generateJSON(descriptionHTML ?? "<p></p>", DOCUMENT_EDITOR_EXTENSIONS);
  // convert JSON to Y.Doc format
  const transformedData = prosemirrorJSONToYDoc(documentEditorSchema, contentJSON, "default");

  // If title is provided, merge it into the document
  if (title != null) {
    const titleJSON = generateTitleProsemirrorJson(title);
    const titleField = prosemirrorJSONToYDoc(documentEditorSchema, titleJSON, "title");
    // Encode the title YDoc to updates and apply them to the main document
    const titleUpdates = Y.encodeStateAsUpdate(titleField);
    Y.applyUpdate(transformedData, titleUpdates);
  }

  // convert Y.Doc to Uint8Array format
  const encodedData = Y.encodeStateAsUpdate(transformedData);
  return encodedData;
};

/**
 * Decodes a rich-text Y.js binary update back to all three formats consumed by the apiserver page payload: base64 binary, JSON, and HTML.
 *
 * Reads the `"default"` xml-fragment (matching the encoder above) and converts via `yXmlFragmentToProseMirrorRootNode` + `generateHTML`.
 *
 * @description this function generates all document formats for the provided binary data for the rich text editor
 * @param {Uint8Array} description - Binary Y.js update.
 * @returns `{ contentBinaryEncoded, contentJSON, contentHTML }` — the three formats stored on the issue/comment payload.
 */
export const getAllDocumentFormatsFromRichTextEditorBinaryData = (
  description: Uint8Array
): {
  contentBinaryEncoded: string;
  contentJSON: object;
  contentHTML: string;
} => {
  // encode binary description data
  const base64Data = convertBinaryDataToBase64String(description);
  const yDoc = new Y.Doc();
  Y.applyUpdate(yDoc, description);
  // convert to JSON
  const type = yDoc.getXmlFragment("default");
  const contentJSON = yXmlFragmentToProseMirrorRootNode(type, richTextEditorSchema).toJSON();
  // convert to HTML
  const contentHTML = generateHTML(contentJSON, RICH_TEXT_EDITOR_EXTENSIONS);

  return {
    contentBinaryEncoded: base64Data,
    contentJSON,
    contentHTML,
  };
};

/**
 * Decodes a document Y.js binary update back to all three (or four) formats consumed by the apiserver page payload.
 *
 * When `updateTitle` is true, also decodes the `"title"` xml-fragment and runs the HTML through `extractTextFromHTML` to produce a plain-text title; this is the path used by `apps/live/src/extensions/database.ts` when persisting after a title sync and by `apps/live/src/services/pdf-export/pdf-export.service.ts` when rendering a PDF.
 *
 * @description this function generates all document formats for the provided binary data for the document editor
 * @param {Uint8Array} description - Binary Y.js update.
 * @param {boolean} updateTitle - When true, also extracts and returns `titleHTML` from the `"title"` xml-fragment.
 * @returns `{ contentBinaryEncoded, contentJSON, contentHTML }` and, when `updateTitle`, also `titleHTML`.
 */
export const getAllDocumentFormatsFromDocumentEditorBinaryData = (
  description: Uint8Array,
  updateTitle: boolean
): {
  contentBinaryEncoded: string;
  contentJSON: object;
  contentHTML: string;
  titleHTML?: string;
} => {
  // encode binary description data
  const base64Data = convertBinaryDataToBase64String(description);
  const yDoc = new Y.Doc();
  Y.applyUpdate(yDoc, description);
  // convert to JSON
  const type = yDoc.getXmlFragment("default");
  const contentJSON = yXmlFragmentToProseMirrorRootNode(type, documentEditorSchema).toJSON();
  // convert to HTML
  const contentHTML = generateHTML(contentJSON, DOCUMENT_EDITOR_EXTENSIONS);

  if (updateTitle) {
    const title = yDoc.getXmlFragment("title");
    const titleJSON = yXmlFragmentToProseMirrorRootNode(title, documentEditorSchema).toJSON();
    const titleHTML = extractTextFromHTML(generateHTML(titleJSON, DOCUMENT_EDITOR_EXTENSIONS));

    return {
      contentBinaryEncoded: base64Data,
      contentJSON,
      contentHTML,
      titleHTML,
    };
  } else {
    return {
      contentBinaryEncoded: base64Data,
      contentJSON,
      contentHTML,
    };
  }
};

type TConvertHTMLDocumentToAllFormatsArgs = {
  document_html: string;
  variant: "rich" | "document";
};

/**
 * Converts HTML content to all supported document formats (JSON, HTML, and binary) for a given editor variant.
 *
 * Routes to either `getBinaryDataFromRichTextEditorHTMLString` + `getAllDocumentFormatsFromRichTextEditorBinaryData` or the document equivalents. The output `description_binary` is base64-encoded so it can be sent over JSON to the apiserver; once persisted, future updates flow as raw binary Y.js updates through Hocuspocus (see `apps/live/src/extensions/database.ts` and tech spec §5.2.5.4).
 *
 * @description Converts HTML content to all supported document formats (JSON, HTML, and binary)
 * @param {TConvertHTMLDocumentToAllFormatsArgs} args - Arguments containing HTML content and variant type
 * @param {string} args.document_html - The HTML content to convert
 * @param {"rich" | "document"} args.variant - The type of editor variant to use for conversion (`"rich"` or `"document"`; selects the schema and extension set)
 * @returns {TDocumentPayload} Object containing the document in all supported formats — `description_json`, `description_html`, and base64 `description_binary`.
 * @throws {Error} If an invalid variant is provided
 */
export const convertHTMLDocumentToAllFormats = (args: TConvertHTMLDocumentToAllFormatsArgs): TDocumentPayload => {
  const { document_html, variant } = args;

  let allFormats: TDocumentPayload;

  if (variant === "rich") {
    // Convert HTML to binary format for rich text editor
    const contentBinary = getBinaryDataFromRichTextEditorHTMLString(document_html);
    // Generate all document formats from the binary data
    const { contentBinaryEncoded, contentHTML, contentJSON } =
      getAllDocumentFormatsFromRichTextEditorBinaryData(contentBinary);
    allFormats = {
      description_json: contentJSON,
      description_html: contentHTML,
      description_binary: contentBinaryEncoded,
    };
  } else if (variant === "document") {
    // Convert HTML to binary format for document editor
    const contentBinary = getBinaryDataFromDocumentEditorHTMLString(document_html);
    // Generate all document formats from the binary data
    const { contentBinaryEncoded, contentHTML, contentJSON } = getAllDocumentFormatsFromDocumentEditorBinaryData(
      contentBinary,
      false
    );
    allFormats = {
      description_json: contentJSON,
      description_html: contentHTML,
      description_binary: contentBinaryEncoded,
    };
  } else {
    throw new Error(`Invalid variant provided: ${variant}`);
  }

  return allFormats;
};

/**
 * Extracts plain text from an HTML string using `sanitizeHTML` to strip all tags and trims surrounding whitespace.
 *
 * Used for title extraction (`apps/live/src/extensions/title-update/title-utils.ts` mirrors the same shape); the leading/trailing trim is acceptable because titles are single-line.
 *
 * @param {string} html - HTML string to flatten.
 * @returns {string} Trimmed text content (empty string when sanitization yields nothing).
 */
export const extractTextFromHTML = (html: string): string => {
  // Use DOMPurify to safely extract text and remove all HTML tags
  // This is more secure than regex as it handles edge cases and prevents injection
  // Note: sanitizeHTML trims whitespace, which is acceptable for title extraction
  const sanitizedText = sanitizeHTML(html); // sanitize the string to remove all HTML tags
  return sanitizedText.trim() || ""; // trim the string to remove leading and trailing whitespaces
};
