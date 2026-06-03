/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compile-time discriminants for editor content formats (HTML string vs.
 * ProseMirror JSON node tree) — locally defined to avoid a runtime dep on
 * TipTap/ProseMirror; consumed by `@plane/editor`, the page/issue
 * description UI, and `apps/live/src/extensions/title-sync.ts`.
 */

/**
 * One node in a TipTap/ProseMirror JSON document tree (recursive via `content`);
 * `text` and `content` are mutually exclusive in well-formed documents, and the
 * trailing index signature is an intentional escape hatch for extension metadata.
 */
export type JSONContent = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JSONContent[];
  marks?: {
    type: string;
    attrs?: Record<string, unknown>;
    [key: string]: unknown;
  }[];
  text?: string;
  [key: string]: unknown;
};

/**
 * HTML-serialized rich-text payload — a semantic `string` alias to distinguish
 * editor HTML from arbitrary strings at type-call sites; at runtime it's a
 * bare string with no well-formedness enforcement.
 */
export type HTMLContent = string;

/**
 * Umbrella union of supported editor content forms (HTML string, single
 * ProseMirror JSON root, JSON fragment array, or `null`); `null` is
 * semantically distinct from an empty doc (`{ type: "doc", content: [] }`)
 * and signals "no content set yet".
 */
export type Content = HTMLContent | JSONContent | JSONContent[] | null;
