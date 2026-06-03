/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Plane editor's StarterKit factory.
 *
 * Wraps `@tiptap/starter-kit` with the design-system list/paragraph/heading
 * CSS classes, the styled drop-cursor, and the disable flags for the
 * built-in extensions Plane replaces with its own implementations
 * (`code`, `codeBlock`, `horizontalRule`, `blockquote`, and optionally
 * `history`). Consumed by `./extensions.ts` (rich editors) and
 * `./core-without-props.ts` (HTML-to-binary backfill on apps/live).
 */

import StarterKit from "@tiptap/starter-kit";

/** Arguments accepted by `CustomStarterKitExtension`. */
type TArgs = {
  enableHistory: boolean;
};

/**
 * Builds the Plane editor's configured `@tiptap/starter-kit` instance.
 *
 * Exposes (passed through from `@tiptap/starter-kit`):
 *   - Default nodes/marks for a TipTap document — `Bold`, `Italic`,
 *     `Strike`, `Document`, `Paragraph`, `Heading`, `Text`, `BulletList`,
 *     `OrderedList`, `ListItem`, `HardBreak`, `History` (when
 *     `enableHistory` is `true`), `Dropcursor`, `Gapcursor` — with Plane
 *     CSS classes applied to bulletList/orderedList/listItem/paragraph/
 *     heading and the dropcursor visually themed.
 *
 * Overrides:
 *   - `bulletList.HTMLAttributes.class` — `"list-disc pl-7 space-y-(--list-spacing-y)"`
 *     (Plane bulleted-list styling driven by the `--list-spacing-y` design token).
 *   - `orderedList.HTMLAttributes.class` — `"list-decimal pl-7 space-y-(--list-spacing-y)"`.
 *   - `listItem.HTMLAttributes.class` — `"not-prose space-y-2"` (escapes the
 *     Tailwind `prose` typography utility so list items inherit Plane styling).
 *   - `paragraph.HTMLAttributes.class` — `"editor-paragraph-block"` (Plane
 *     custom class for block detection).
 *   - `heading.HTMLAttributes.class` — `"editor-heading-block"`.
 *   - `dropcursor.class` — motion-aware transition utilities so the cursor
 *     animates softly and respects `prefers-reduced-motion`.
 *
 * Hides (built-in StarterKit extensions intentionally turned off and
 * replaced elsewhere in the extension array):
 *   - `code: false` — inline code mark replaced by
 *     `CustomCodeInlineExtension` (`./code-inline`).
 *   - `codeBlock: false` — code block node replaced by
 *     `CustomCodeBlockExtension` (`./code`) which wires lowlight syntax
 *     highlighting and a custom node view.
 *   - `horizontalRule: false` — rule replaced by `CustomHorizontalRule`
 *     (`./horizontal-rule`) rendered as a styled block element.
 *   - `blockquote: false` — quote replaced by `CustomQuoteExtension`
 *     (`./quote`) with Plane-specific Enter-to-exit behavior.
 *   - `history: false` (only when `args.enableHistory` is `false`) —
 *     undo/redo is owned by the collaboration layer in collaborative
 *     editors. StarterKit's local history would manage only the current
 *     client's transactions and break cross-client undo semantics, so it
 *     is disabled to let `@tiptap/extension-collaboration` install the
 *     Y.js-aware `UndoManager` instead.
 *
 * @param args - Configuration object.
 * @param args.enableHistory - When `true`, StarterKit's local `History`
 *   extension is kept (used by non-collaborative editors such as the
 *   lite/rich variants). When `false`, history is disabled so the
 *   collaboration extension can install Y.js-aware undo/redo for
 *   collaborative documents.
 * @returns A configured `StarterKit` extension instance ready to be
 *   composed into the editor's extension array alongside the
 *   `CustomCodeInlineExtension`, `CustomCodeBlockExtension`,
 *   `CustomHorizontalRule`, and `CustomQuoteExtension` replacements.
 */
export const CustomStarterKitExtension = (args: TArgs) => {
  const { enableHistory } = args;

  return StarterKit.configure({
    bulletList: {
      HTMLAttributes: {
        class: "list-disc pl-7 space-y-(--list-spacing-y)",
      },
    },
    orderedList: {
      HTMLAttributes: {
        class: "list-decimal pl-7 space-y-(--list-spacing-y)",
      },
    },
    listItem: {
      HTMLAttributes: {
        class: "not-prose space-y-2",
      },
    },
    code: false,
    codeBlock: false,
    horizontalRule: false,
    blockquote: false,
    paragraph: {
      HTMLAttributes: {
        class: "editor-paragraph-block",
      },
    },
    heading: {
      HTMLAttributes: {
        class: "editor-heading-block",
      },
    },
    dropcursor: {
      class:
        "text-tertiary transition-all motion-reduce:transition-none motion-reduce:hover:transform-none duration-200 ease-[cubic-bezier(0.165, 0.84, 0.44, 1)]",
    },
    ...(enableHistory ? {} : { history: false }),
  });
};
