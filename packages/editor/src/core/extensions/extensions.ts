/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Main editor extension composition factory for the Plane editor.
 *
 * `CoreEditorExtensions` is invoked by every interactive editor variant
 * (rich-text, lite-text, document, collaborative) to assemble the full
 * runtime extension array from per-instance props
 * (`fileHandler`, `mentionHandler`, `placeholder`, etc.) plus optional
 * Y.js collaboration provider.
 *
 * Pair with `CoreEditorExtensionsWithoutProps` (in `core-without-props.ts`)
 * for non-interactive contexts (server-side conversion, PDF export).
 */

import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Extensions } from "@tiptap/core";
import { CharacterCount } from "@tiptap/extension-character-count";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { Markdown } from "tiptap-markdown";
// extensions
import {
  CustomCalloutExtension,
  CustomCodeBlockExtension,
  CustomCodeInlineExtension,
  CustomColorExtension,
  CustomHorizontalRule,
  CustomKeymap,
  CustomLinkExtension,
  CustomMentionExtension,
  CustomQuoteExtension,
  CustomTextAlignExtension,
  CustomTypographyExtension,
  ImageExtension,
  ListKeymap,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  UtilityExtension,
} from "@/extensions";
// plane editor extensions
import { CoreEditorAdditionalExtensions } from "@/plane-editor/extensions";
// types
import type { IEditorProps } from "@/types";
// local imports
import { CustomImageExtension } from "./custom-image/extension";
import { EmojiExtension } from "./emoji/extension";
import { CustomPlaceholderExtension } from "./placeholder";
import { CustomStarterKitExtension } from "./starter-kit";
import { UniqueID } from "./unique-id/extension";

/**
 * Arguments accepted by `CoreEditorExtensions`. Includes editor props
 * forwarded from the caller plus `enableHistory`, `editable`, and the
 * optional Hocuspocus `provider` for collaborative mode.
 */
type TArguments = Pick<
  IEditorProps,
  | "disabledExtensions"
  | "flaggedExtensions"
  | "fileHandler"
  | "getEditorMetaData"
  | "isTouchDevice"
  | "mentionHandler"
  | "placeholder"
  | "showPlaceholderOnEmpty"
  | "tabIndex"
  | "extendedEditorProps"
> & {
  enableHistory: boolean;
  editable: boolean;
  provider: HocuspocusProvider | undefined;
};

/**
 * Builds the full interactive editor extension array.
 *
 * Composition stack (in returned order):
 *   1. StarterKit (base schema)
 *   2. EmojiExtension, CustomQuoteExtension, CustomHorizontalRule
 *   3. CustomKeymap (Mod-a + list merging), ListKeymap (Tab/Backspace)
 *   4. CustomLinkExtension, CustomTypographyExtension
 *   5. Underline, TextStyle (upstream)
 *   6. TaskList, TaskItem
 *   7. CustomCodeBlockExtension, CustomCodeInlineExtension
 *   8. Markdown (paste/copy serialization)
 *   9. Table, TableHeader, TableCell, TableRow
 *  10. CustomMentionExtension, CustomPlaceholderExtension
 *  11. CharacterCount (upstream)
 *  12. CustomColorExtension, CustomTextAlignExtension
 *  13. CustomCalloutExtension
 *  14. UtilityExtension (priority 1000 — pulls plugins to front of chain)
 *  15. ...CoreEditorAdditionalExtensions (commercial features)
 *  16. UniqueID (needs all other schemas registered first)
 *  17. ImageExtension + CustomImageExtension (conditional on `"image"` not disabled)
 *
 * WHY the order:
 *   - StarterKit FIRST establishes the base schema. Custom overrides
 *     (HorizontalRule/Quote/CodeBlock/CodeInline) come AFTER so StarterKit's
 *     `code: false` / `codeBlock: false` / `horizontalRule: false` /
 *     `blockquote: false` disables register before the replacements install.
 *   - `CustomKeymap` and `ListKeymap` follow StarterKit so their keyboard
 *     shortcuts reference node types (`bulletList`, `orderedList`, …) that the
 *     base schema has already registered, keeping the array readable as
 *     "schema → behavior".
 *   - `...CoreEditorAdditionalExtensions(...)` runs after the core stack so
 *     commercial-feature extensions can safely override any base behavior.
 *   - `UtilityExtension` carries `priority: 1000` so its plugins run at the
 *     front of the ProseMirror plugin chain despite the late array position;
 *     this allows earlier extensions to read `editor.storage.utility.*`
 *     (placeholder, enter-key, mention/emoji/slash dropbars).
 *   - `UniqueID` is near-last so every other extension's schema is
 *     registered before it begins assigning IDs.
 *   - Image extensions are pushed conditionally at the end so the always-on
 *     core stack is stable when image upload is disabled.
 *
 * @param args - Per-instance composition arguments:
 *   - `disabledExtensions` — extension names to omit; gates the conditional image push and is forwarded to utility/commercial layers.
 *   - `flaggedExtensions` — feature-flagged extensions forwarded to `UtilityExtension` and `CoreEditorAdditionalExtensions`.
 *   - `fileHandler` — upload/restore/delete callbacks consumed by image and utility extensions.
 *   - `getEditorMetaData` — workspace/project/issue context lookup forwarded to `UtilityExtension`.
 *   - `isTouchDevice` — pointer-environment flag forwarded to `UtilityExtension` (defaults to `false`).
 *   - `mentionHandler` — suggestion + render config for the `@`-mention node.
 *   - `placeholder` — static string or function yielding the placeholder text.
 *   - `showPlaceholderOnEmpty` — only render placeholder when the document is empty.
 *   - `tabIndex` — keyboard `tabindex` consumed by `ListKeymap`.
 *   - `extendedEditorProps` — opaque payload forwarded to commercial extensions.
 *   - `enableHistory` — toggles the StarterKit undo/redo history sub-extension.
 *   - `editable` — passed to `UtilityExtension` as `isEditable` and to `CustomImageExtension` (controls non-editable image rendering).
 *   - `provider` — optional Hocuspocus provider forwarded to `UniqueID` for collaborative-safe ID generation.
 * @returns The complete `Extensions` array, ready to pass to the editor's
 *   `useEditor({ extensions: ... })` hook.
 */
export const CoreEditorExtensions = (args: TArguments): Extensions => {
  const {
    disabledExtensions,
    enableHistory,
    fileHandler,
    flaggedExtensions,
    getEditorMetaData,
    isTouchDevice = false,
    mentionHandler,
    placeholder,
    showPlaceholderOnEmpty,
    tabIndex,
    editable,
    extendedEditorProps,
    provider,
  } = args;

  const extensions = [
    CustomStarterKitExtension({
      enableHistory,
    }),
    EmojiExtension,
    CustomQuoteExtension,
    CustomHorizontalRule,
    CustomKeymap,
    ListKeymap({ tabIndex }),
    CustomLinkExtension,
    CustomTypographyExtension,
    Underline,
    TextStyle,
    TaskList.configure({
      HTMLAttributes: {
        class: "not-prose pl-2 space-y-2",
      },
    }),
    TaskItem.configure({
      HTMLAttributes: {
        class: "relative",
      },
      nested: true,
    }),
    CustomCodeBlockExtension,
    CustomCodeInlineExtension,
    Markdown.configure({
      html: true,
      transformCopiedText: false,
      transformPastedText: true,
      breaks: true,
    }),
    Table,
    TableHeader,
    TableCell,
    TableRow,
    CustomMentionExtension(mentionHandler),
    CustomPlaceholderExtension({ placeholder, showPlaceholderOnEmpty }),
    CharacterCount,
    CustomColorExtension,
    CustomTextAlignExtension,
    CustomCalloutExtension,
    UtilityExtension({
      disabledExtensions,
      flaggedExtensions,
      fileHandler,
      getEditorMetaData,
      isEditable: editable,
      isTouchDevice,
    }),
    ...CoreEditorAdditionalExtensions({
      disabledExtensions,
      flaggedExtensions,
      fileHandler,
      extendedEditorProps,
    }),
    UniqueID.configure({
      provider,
    }),
  ];

  if (!disabledExtensions.includes("image")) {
    extensions.push(
      ImageExtension({
        fileHandler,
      }),
      CustomImageExtension({
        fileHandler,
        isEditable: editable,
      })
    );
  }

  return extensions;
};
