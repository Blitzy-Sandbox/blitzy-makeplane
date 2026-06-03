/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Prebuilt extension bundles for "without props" editor modes.
 *
 * Some editor consumers — notably the server-side HTML→Y.js converter used
 * by `apps/live` (via `@/core/helpers/yjs-utils`) and the in-memory document
 * renderer used by the PDF export pipeline — need an extension array that
 * does NOT depend on per-instance props (`fileHandler`, `mentionHandler`,
 * `placeholder` callback, Hocuspocus `provider`, etc.). These bundles
 * statically compose the extension stack using configuration-only variants
 * (`*ExtensionConfig` rather than the runtime `*Extension({ ... })` factory)
 * so the same schema can be reused outside of a React tree or a live
 * collaboration session.
 *
 * Companion interactive factory: `CoreEditorExtensions` in
 * `./extensions.ts` (props-driven, used inside the live React editor).
 */

import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
// plane editor imports
import { CoreEditorAdditionalExtensionsWithoutProps } from "@/plane-editor/extensions/core/without-props";
// extensions
import { CustomCalloutExtensionConfig } from "./callout/extension-config";
import { CustomCodeBlockExtensionWithoutProps } from "./code/without-props";
import { CustomCodeInlineExtension } from "./code-inline";
import { CustomColorExtension } from "./custom-color";
import { CustomImageExtensionConfig } from "./custom-image/extension-config";
import { CustomLinkExtension } from "./custom-link";
import { EmojiExtension } from "./emoji/extension";
import { CustomHorizontalRule } from "./horizontal-rule";
import { ImageExtensionConfig } from "./image";
import { CustomMentionExtensionConfig } from "./mentions/extension-config";
import { CustomQuoteExtension } from "./quote";
import { CustomStarterKitExtension } from "./starter-kit";
import { TableHeader, TableCell, TableRow, Table } from "./table";
import { CustomTextAlignExtension } from "./text-align";
import { WorkItemEmbedExtensionConfig } from "./work-item-embed/extension-config";

/**
 * Full core editor extension array for "without props" rendering contexts —
 * the server-side HTML→Y.js converter, the PDF export pipeline, and any
 * static (non-interactive) rendering of editor content.
 *
 * Composition (in order):
 *   - `CustomStarterKitExtension({ enableHistory: true })` — full StarterKit
 *     with local history enabled. There is no Hocuspocus collaboration
 *     session to coordinate with in these one-shot conversion contexts,
 *     so the local undo/redo history is safe to enable (and is required
 *     for the StarterKit `history` node to be schema-correct).
 *   - `EmojiExtension`, `CustomQuoteExtension`, `CustomHorizontalRule`,
 *     `CustomLinkExtension` — pure content extensions with no runtime deps.
 *   - `ImageExtensionConfig`, `CustomImageExtensionConfig` — image node
 *     SCHEMAS only (parsing + rendering rules); the runtime upload,
 *     deletion, and restore handlers (provided by `fileHandler`) are
 *     intentionally absent.
 *   - `Underline`, `TextStyle` — upstream TipTap marks
 *     (`@tiptap/extension-underline`, `@tiptap/extension-text-style`).
 *   - `TaskList`, `TaskItem` — configured with the Plane HTML class
 *     layout so rendered output matches the interactive editor.
 *   - `CustomCodeInlineExtension`, `CustomCodeBlockExtensionWithoutProps`
 *     — inline code mark + code block. The without-props code block omits
 *     the React `ReactNodeViewRenderer` used by the interactive version
 *     because there is no React tree in these conversion contexts.
 *   - `Table`, `TableHeader`, `TableCell`, `TableRow` — table schema.
 *   - `CustomMentionExtensionConfig` — mention node SCHEMA only; the
 *     mention suggestion popover (driven by `mentionHandler`) is absent.
 *   - `CustomTextAlignExtension`, `CustomCalloutExtensionConfig`,
 *     `CustomColorExtension` — text-align mark, callout node schema,
 *     and custom-color mark.
 *   - `...CoreEditorAdditionalExtensionsWithoutProps` — additional
 *     extensions contributed by `@/plane-editor/extensions/core/without-props`
 *     (commercial-feature extensions, also in their without-props form).
 *
 * Notable omissions vs the interactive `CoreEditorExtensions` factory in
 * `./extensions.ts` — all omitted because they depend on per-instance props
 * that are not available in these conversion contexts:
 *   - `CustomKeymap`, `ListKeymap` — keyboard handlers irrelevant to static
 *     schema/rendering.
 *   - `CustomTypographyExtension` — only relevant for interactive typing.
 *   - `Markdown` (tiptap-markdown) — markdown round-trip is wired per
 *     interactive editor instance.
 *   - `CustomPlaceholderExtension`, `CharacterCount` — UI-only concerns.
 *   - `UtilityExtension` — needs `fileHandler`/`getEditorMetaData`.
 *   - `UniqueID` — needs the live Hocuspocus `provider`.
 *   - Runtime `CustomImageExtension` / `ImageExtension` — need
 *     `fileHandler` and `isEditable`.
 *
 * Consumed by `RICH_TEXT_EDITOR_EXTENSIONS` and (spread together with
 * `DocumentEditorExtensionsWithoutProps`) by `DOCUMENT_EDITOR_EXTENSIONS`
 * in `@/core/helpers/yjs-utils`, which feeds `getSchema(...)` for
 * `generateHTML`, `generateJSON`, and `prosemirrorJSONToYDoc`.
 */
export const CoreEditorExtensionsWithoutProps = [
  CustomStarterKitExtension({
    enableHistory: true,
  }),
  EmojiExtension,
  CustomQuoteExtension,
  CustomHorizontalRule,
  CustomLinkExtension,
  ImageExtensionConfig,
  CustomImageExtensionConfig,
  Underline,
  TextStyle,
  TaskList.configure({
    HTMLAttributes: {
      class: "not-prose pl-2 space-y-2",
    },
  }),
  TaskItem.configure({
    HTMLAttributes: {
      class: "flex",
    },
    nested: true,
  }),
  CustomCodeInlineExtension,
  CustomCodeBlockExtensionWithoutProps,
  Table,
  TableHeader,
  TableCell,
  TableRow,
  CustomMentionExtensionConfig,
  CustomTextAlignExtension,
  CustomCalloutExtensionConfig,
  CustomColorExtension,
  ...CoreEditorAdditionalExtensionsWithoutProps,
];

/**
 * Document-editor extra extension array for "without props" mode.
 *
 * Adds `WorkItemEmbedExtensionConfig` on top of
 * `CoreEditorExtensionsWithoutProps` so that page/document content
 * containing embedded work-item references parses and serializes
 * correctly in non-interactive contexts. Consumers compose the full
 * document-editor schema by spreading both arrays in order:
 *
 *   `[...CoreEditorExtensionsWithoutProps, ...DocumentEditorExtensionsWithoutProps]`
 *
 * See `DOCUMENT_EDITOR_EXTENSIONS` in `@/core/helpers/yjs-utils` for the
 * canonical composition site.
 */
export const DocumentEditorExtensionsWithoutProps = [WorkItemEmbedExtensionConfig];
