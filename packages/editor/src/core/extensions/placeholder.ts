/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Context-aware placeholder extension for the Plane editor.
 *
 * Exports `CustomPlaceholderExtension`, a Plane wrapper around
 * `@tiptap/extension-placeholder` that injects context-aware placeholder
 * text into empty editor blocks. The visibility rule is non-trivial —
 * heading nodes always show their own level-aware placeholder
 * (`"Heading 1"`, `"Heading 2"`, etc.) while tables, code-blocks,
 * images, and in-flight uploads suppress the placeholder entirely
 * because those nodes own their own empty-state affordance.
 *
 * Consumed by the editor extension registries (`starter-kit.ts` and
 * the sibling `core/extensions/*` modules) when composing the active
 * extension array. The `placeholder` and `showPlaceholderOnEmpty`
 * options pass through from `IEditorProps` on each editor variant.
 */

import { Placeholder } from "@tiptap/extension-placeholder";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// types
import type { IEditorProps } from "@/types";

/** Constructor arguments accepted by `CustomPlaceholderExtension`. */
type TArgs = {
  placeholder: IEditorProps["placeholder"];
  showPlaceholderOnEmpty: IEditorProps["showPlaceholderOnEmpty"];
};

/**
 * Builds the Plane editor's contextual placeholder extension.
 *
 * Exposes:
 *   - The `@tiptap/extension-placeholder` decoration pipeline —
 *     placeholder text is rendered via ProseMirror decoration on empty
 *     blocks (rather than being inserted into the document tree).
 *   - `includeChildren: true` so the placeholder rule is evaluated for
 *     nested empty blocks (e.g., empty list items inside a list).
 *
 * Overrides:
 *   - The upstream `placeholder` option is supplied as a function
 *     instead of a static string so visibility is computed per-node:
 *       - `CORE_EXTENSIONS.HEADING` → `"Heading {level}"` (level-aware
 *         via `node.attrs.level`).
 *       - Non-editable views (`editor.isEditable === false`) → empty
 *         string.
 *       - `CORE_EXTENSIONS.TABLE`, `CORE_EXTENSIONS.CODE_BLOCK`,
 *         `CORE_EXTENSIONS.IMAGE`, or `CORE_EXTENSIONS.CUSTOM_IMAGE`
 *         active → empty string.
 *       - `editor.storage.utility?.uploadInProgress === true` → empty
 *         string. Cross-extension contract: `uploadInProgress` is
 *         written by `core/extensions/utility.ts` through the
 *         file-handler upload pipeline.
 *       - When `showPlaceholderOnEmpty === true`, non-empty documents
 *         return an empty string so the placeholder only renders while
 *         the entire document has zero text content.
 *       - Caller-supplied `args.placeholder`: a string is returned
 *         verbatim; a function is invoked with
 *         `(editor.isFocused, editor.getHTML())` to compute the string.
 *       - Final fallback: `"Press '/' for commands..."`.
 *
 * Hides:
 *   - The upstream static-string `placeholder` option is unreachable at
 *     the wrapper level — callers cannot bypass the contextual rule
 *     because the rule function always runs first before any
 *     caller-supplied value is consulted.
 *
 * WHY the contextual visibility rule:
 *   - Heading-level placeholders are essential UX: users typing into an
 *     empty H1/H2/H3 need the visual cue identifying which level they
 *     are in.
 *   - Tables, code-blocks, and images suppress the placeholder because
 *     those nodes own their own internal empty-state affordance (e.g.,
 *     a table cell has its own empty appearance; a code-block carries
 *     its language label).
 *   - `uploadInProgress` suppression prevents placeholder flicker
 *     during the brief window between file selection and the image
 *     node being inserted into the document.
 *   - `showPlaceholderOnEmpty=true` is a per-caller mode used by title
 *     editors and small inline editors that want a single placeholder
 *     string for the whole document rather than per-block placeholders.
 *
 * @param args.placeholder Optional `string | (isFocused, html) => string`
 *   per `IEditorProps["placeholder"]`. When a function, the wrapper
 *   invokes it with the current focus state and editor HTML.
 * @param args.showPlaceholderOnEmpty Optional, defaults to `false`. When
 *   `true`, the placeholder is shown only when the document has zero
 *   text content.
 * @returns Configured `Placeholder` extension instance ready to be
 *   added to the editor's extension array.
 */
export const CustomPlaceholderExtension = (args: TArgs) => {
  const { placeholder, showPlaceholderOnEmpty = false } = args;

  return Placeholder.configure({
    placeholder: ({ editor, node }) => {
      if (!editor.isEditable) return "";

      if (node.type.name === CORE_EXTENSIONS.HEADING) return `Heading ${node.attrs.level}`;

      const isUploadInProgress = editor.storage.utility?.uploadInProgress;

      if (isUploadInProgress) return "";

      const shouldHidePlaceholder =
        editor.isActive(CORE_EXTENSIONS.TABLE) ||
        editor.isActive(CORE_EXTENSIONS.CODE_BLOCK) ||
        editor.isActive(CORE_EXTENSIONS.IMAGE) ||
        editor.isActive(CORE_EXTENSIONS.CUSTOM_IMAGE);

      if (shouldHidePlaceholder) return "";

      if (showPlaceholderOnEmpty) {
        const isDocumentEmpty = editor.state.doc.textContent.length === 0;
        if (!isDocumentEmpty) {
          return "";
        }
      }

      if (placeholder) {
        if (typeof placeholder === "string") return placeholder;
        else return placeholder(editor.isFocused, editor.getHTML());
      }

      return "Press '/' for commands...";
    },
    includeChildren: true,
  });
};
