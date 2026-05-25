/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared editor helpers grab-bag for class-name composition, ProseMirror node lookup, DOM tree walking, HTML trimming, URL validation, and paragraph counting.
 *
 * Each helper exists so higher-level features (custom links, table commands, editor refs, paste handlers) can call into one canonical implementation instead of duplicating logic across toolbar actions, extensions, and refs.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Selection } from "@tiptap/pm/state";
// plane imports
import { cn } from "@plane/utils";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

type EditorClassNameArgs = {
  noBorder?: boolean;
  borderOnFocus?: boolean;
  containerClassName?: string;
};

/**
 * Builds the canonical Tailwind class string for the editor container with optional border / focus / consumer overrides.
 *
 * Consumed by `core/components/editors/editor-wrapper.tsx`, `core/components/editors/document/collaborative-editor.tsx`, and `core/components/editors/document/editor.tsx` to keep container styling consistent across the four editor variants.
 *
 * @param args.noBorder - When true, suppresses the default `border-subtle-1` ring (used for embedded surfaces).
 * @param args.borderOnFocus - When true, swaps in a focus-only border instead of an always-on one.
 * @param args.containerClassName - Caller-provided class string merged last so callers can override defaults.
 */
export const getEditorClassNames = ({ noBorder, borderOnFocus, containerClassName }: EditorClassNameArgs) =>
  cn(
    "w-full max-w-full focus:border-0 focus:outline-none sm:rounded-lg",
    {
      "border border-subtle-1": !noBorder,
      "border-strong focus:border": borderOnFocus,
    },
    containerClassName
  );

/**
 * Walks up the ProseMirror node ancestry from the current selection and returns the first ancestor whose type name is in `typeName`, or null if none match.
 *
 * Consumed by table-cell, table-row, and `insert-line-{above,below}-table-action` extensions to locate the enclosing table when the cursor is anywhere inside it.
 */
export const findParentNodeOfType = (
  selection: Selection,
  typeName: string[]
): {
  node: ProseMirrorNode;
  pos: number;
  depth: number;
} | null => {
  let depth = selection.$anchor.depth;
  while (depth > 0) {
    const node = selection.$anchor.node(depth);
    if (typeName.includes(node.type.name)) {
      return {
        node,
        pos: selection.$anchor.start(depth) - 1,
        depth,
      };
    }
    depth--;
  }
  return null;
};

/**
 * Walks up the DOM ancestry from a node until a `<table>` element is reached, returning that element or null.
 *
 * Used by `editor-commands.ts:insertTableCommand` to guard against nested table insertion (a table already wraps the current selection).
 */
export const findTableAncestor = (node: Node | null): HTMLTableElement | null => {
  while (node !== null && node.nodeName !== "TABLE") {
    node = node.parentNode;
  }
  return node as HTMLTableElement;
};

/**
 * Strips leading and trailing empty paragraph tags (`<p></p>`) from an HTML string.
 *
 * Empty paragraphs accumulate when users press Enter at the start or end of the editor; trimming them keeps stored content lean without altering visible structure.
 */
export const getTrimmedHTML = (html: string) =>
  html
    .replace(/^(?:<p><\/p>)+/g, "") // Remove from beginning
    .replace(/(?:<p><\/p>)+$/g, ""); // Remove from end

/**
 * Validates a URL string while blocking dangerous protocols (`javascript:`, `data:`, `vbscript:`, `file:`, `about:`) and, if the input lacks a protocol, retries with `https://` prepended.
 *
 * Consumed by `extensions/custom-link/extension.tsx` (line 135) as the `validate` callback for the link mark, so the protocol-block list is the security boundary for user-pasted link targets.
 *
 * @returns An object with `isValid` (boolean) and `url` (the normalized URL or the original string when invalid).
 */
export const isValidHttpUrl = (string: string): { isValid: boolean; url: string } => {
  // List of potentially dangerous protocols to block
  const blockedProtocols = ["javascript:", "data:", "vbscript:", "file:", "about:"];

  // First try with the original string
  try {
    const url = new URL(string);

    // Check for potentially dangerous protocols
    const protocol = url.protocol.toLowerCase();
    if (blockedProtocols.some((p) => protocol === p)) {
      return {
        isValid: false,
        url: string,
      };
    }

    // If URL has any valid protocol, return as is
    if (url.protocol && url.protocol !== "") {
      return {
        isValid: true,
        url: string,
      };
    }
  } catch {
    // Original string wasn't a valid URL - that's okay, we'll try with https
  }

  // Try again with https:// prefix
  try {
    const urlWithHttps = `https://${string}`;
    new URL(urlWithHttps);
    return {
      isValid: true,
      url: urlWithHttps,
    };
  } catch {
    return {
      isValid: false,
      url: string,
    };
  }
};

/**
 * Counts non-empty `paragraph` nodes in the document by walking `editorState.doc.descendants`.
 *
 * Consumed by `editor-ref.ts:getDocumentInfo` and `onDocumentInfoChange` to surface the paragraph count alongside characters and words from the character-count extension storage.
 */
export const getParagraphCount = (editorState: EditorState | undefined) => {
  if (!editorState) return 0;
  let paragraphCount = 0;
  editorState.doc.descendants((node) => {
    if (node.type.name === CORE_EXTENSIONS.PARAGRAPH && node.content.size > 0) paragraphCount++;
  });
  return paragraphCount;
};
