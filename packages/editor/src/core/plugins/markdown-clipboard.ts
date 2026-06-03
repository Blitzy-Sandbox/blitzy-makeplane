/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * ProseMirror plugin that replaces the browser's default `copy` payload with
 * three editor-aware formats: markdown (`text/plain`), raw HTML (`text/html`),
 * and the internal `text/plane-editor-html` MIME type used to round-trip
 * Plane-specific asset metadata across copy-paste WITHIN Plane editors.
 *
 * The internal MIME type forms a closed protocol with `core/props.ts` (which
 * READS it on paste at line 41 of the original source and routes the HTML
 * through `processAssetDuplication`) and `core/helpers/editor-ref.ts` (which
 * ALSO SETS it on programmatic ref-API copy at line 112 of the original
 * source). Future engineers modifying clipboard handling should keep the
 * three sites in lock-step.
 */

import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
// plane imports
import { convertHTMLToMarkdown } from "@plane/utils";
import type { TCustomComponentsMetaData } from "@plane/utils";

/** Arguments accepted by `MarkdownClipboardPlugin`. */
type TArgs = {
  editor: Editor;
  getEditorMetaData: (htmlContent: string) => TCustomComponentsMetaData;
};

/**
 * Builds the markdown-aware copy plugin. Intercepts native `copy` DOM events
 * on the editor view and writes three formats to the clipboard, bypassing the
 * browser's default copy behavior.
 *
 * Triggered by: native `copy` DOM event on the editor view (registered via
 * `props.handleDOMEvents.copy`).
 *
 * State read:
 *   - Current selection via `view.state.selection.content()`, serialized to
 *     clipboard HTML by `view.serializeForClipboard`.
 *   - Full editor HTML via `editor.getHTML()`, passed to the injected
 *     `getEditorMetaData` callback so document-wide context (custom-component
 *     references) is available during HTML→markdown conversion.
 *
 * DOM side effects (in order):
 *   - `event.preventDefault()` + `clipboardData.clearData()` suppress the
 *     browser's default copy and clear any prior clipboard state.
 *   - `setData("text/plain", markdown)` — markdown payload via
 *     `convertHTMLToMarkdown`.
 *   - `setData("text/html", clipboardHTML)` — raw selection HTML.
 *   - `setData("text/plane-editor-html", clipboardHTML)` — Plane-internal
 *     MIME type.
 *
 * WHY the triple clipboard write:
 *   - `text/plain` (as markdown) lets the user paste into plain-text contexts
 *     and external markdown-aware editors (GitHub PRs, Slack with markdown
 *     enabled, Notion).
 *   - `text/plane-editor-html` is read by `core/props.ts` (line 41 of the
 *     original source) on paste to preserve asset-duplication metadata
 *     across copy-paste WITHIN Plane editors; the standard `text/html`
 *     payload alone is treated as an external paste and would lose
 *     attributes the editor needs to route through `processAssetDuplication`.
 *   - See also `core/helpers/editor-ref.ts` (line 112 of the original source)
 *     which writes the same MIME type for programmatic ref-API copies,
 *     ensuring symmetry between DOM-driven and ref-API-driven copy paths.
 *
 * On error, logs and returns `false` so the browser's default copy still
 * fires — clipboard failures never silently break the copy gesture.
 *
 * @param args - `editor` (TipTap instance) and `getEditorMetaData`
 *   (HTML→`TCustomComponentsMetaData` callback for custom-component round-trip).
 * @returns The configured ProseMirror `Plugin` to attach to the editor view.
 */
export const MarkdownClipboardPlugin = (args: TArgs): Plugin => {
  const { editor, getEditorMetaData } = args;

  return new Plugin({
    key: new PluginKey("markdownClipboard"),
    props: {
      handleDOMEvents: {
        copy: (view, event) => {
          try {
            event.preventDefault();
            event.clipboardData?.clearData();
            // editor meta data
            const editorHTML = editor.getHTML();
            const metaData = getEditorMetaData(editorHTML);
            // meta data from selection
            const clipboardHTML = view.serializeForClipboard(view.state.selection.content()).dom.innerHTML;
            // convert to markdown
            const markdown = convertHTMLToMarkdown({
              description_html: clipboardHTML,
              metaData,
            });
            event.clipboardData?.setData("text/plain", markdown);
            event.clipboardData?.setData("text/html", clipboardHTML);
            event.clipboardData?.setData("text/plane-editor-html", clipboardHTML);
            return true;
          } catch (error) {
            console.error("Failed to copy markdown content to clipboard:", error);
            return false;
          }
        },
      },
    },
  });
};
