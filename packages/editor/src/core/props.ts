/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Baseline TipTap `EditorProps` factory for every Plane editor view.
 *
 * This module exports {@link CoreEditorProps}, the shared `EditorProps`
 * builder that downstream wrappers (rich-text, lite-text, document, and
 * collaborative editor variants) extend with their own view-specific
 * configuration. It centralizes the DOM attribute set, the slash-command
 * keyboard guard, and the internal `text/plane-editor-html` paste handler
 * so every editor surface inherits the same low-level interaction contract.
 */

import type { EditorProps } from "@tiptap/pm/view";
// plane utils
import { cn } from "@plane/utils";
// helpers
import { processAssetDuplication } from "@/helpers/paste-asset";

type TArgs = {
  editorClassName: string;
};

/**
 * Builds the baseline `EditorProps` configuration shared by every Plane editor view.
 *
 * The caller-supplied `editorClassName` is merged via `cn()` with the fixed
 * prose typography classes (`prose-brand prose-headings:font-display
 * font-default max-w-full prose focus:outline-none`) so variant-specific
 * styling layers on top of the base presentation without replacing it.
 *
 * Keyboard guard (`handleDOMEvents.keydown`):
 *   When the global `#slash-command` element is mounted, ArrowUp / ArrowDown /
 *   Enter return `true` to short-circuit TipTap's default handling for those
 *   keys. The slash-command popup UI owns those keys for menu navigation
 *   (up/down to move the highlight, Enter to select); allowing them to
 *   propagate to the editor would double-handle the input — the caret would
 *   move AND the menu selection would fire on the same keystroke.
 *
 * Paste handler (`handlePaste`):
 *   Only intercepts when the clipboard carries the internal
 *   `text/plane-editor-html` MIME type, which is written on copy by
 *   `helpers/editor-ref.ts` and `plugins/markdown-clipboard.ts`. This
 *   wrapper-internal MIME round-trips Plane-specific asset metadata (image /
 *   attachment markup) across copy-paste so `processAssetDuplication` can
 *   clone referenced assets before the HTML is re-inserted via
 *   `view.pasteHTML`. All other clipboard payloads return `false` and fall
 *   through to TipTap's default paste behavior unchanged.
 *
 * @param props - Container carrying the caller's `editorClassName`.
 * @returns A TipTap `EditorProps` object configuring `attributes`,
 *   `handleDOMEvents`, and `handlePaste`.
 */
export const CoreEditorProps = (props: TArgs): EditorProps => {
  const { editorClassName } = props;

  return {
    attributes: {
      class: cn(
        "prose-brand prose-headings:font-display font-default max-w-full prose focus:outline-none",
        editorClassName
      ),
    },
    handleDOMEvents: {
      keydown: (_view, event) => {
        // prevent default event listeners from firing when slash command is active
        if (["ArrowUp", "ArrowDown", "Enter"].includes(event.key)) {
          const slashCommand = document.querySelector("#slash-command");
          if (slashCommand) {
            return true;
          }
        }
      },
    },
    handlePaste: (view, event) => {
      if (!event.clipboardData) return false;

      const htmlContent = event.clipboardData.getData("text/plane-editor-html");
      if (!htmlContent) return false;

      const { processedHtml } = processAssetDuplication(htmlContent);
      view.pasteHTML(processedHtml);
      return true;
    },
  };
};
