/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Rich-text editor variant for `@plane/editor`.
 *
 * Implements the full-featured editing surface used for issue descriptions
 * and other rich content, built atop the shared `EditorWrapper`. Distinct
 * from the document-editor variant in that it deliberately disables the
 * AI-features integration on the side menu (`aiEnabled: false` on
 * `SideMenuExtension`) while still wiring up the full rich-text extension
 * stack via `RichTextEditorAdditionalExtensions`.
 */

import { forwardRef, useCallback } from "react";
// components
import { EditorWrapper } from "@/components/editors";
import { BlockMenu, EditorBubbleMenu } from "@/components/menus";
// extensions
import { SideMenuExtension } from "@/extensions";
// plane editor imports
import { RichTextEditorAdditionalExtensions } from "@/plane-editor/extensions/rich-text-extensions";
// types
import type { EditorRefApi, IRichTextEditorProps } from "@/types";

/**
 * Full-featured rich-text editor for issue descriptions and rich content.
 *
 * Composes the shared `EditorWrapper`, `EditorBubbleMenu`, and `BlockMenu`
 * primitives with the rich-text extension stack. `EditorBubbleMenu` is
 * mounted only when both the underlying TipTap editor instance is available
 * and `bubbleMenuEnabled` is truthy; `BlockMenu` is mounted unconditionally
 * with the active editor, `flaggedExtensions`, `disabledExtensions`, and
 * `workItemIdentifier`.
 *
 * Props are typed by `IRichTextEditorProps` — see its declaration for the
 * full contract. The destructured fields consumed here are
 * `bubbleMenuEnabled` (default `true`), `disabledExtensions`,
 * `dragDropEnabled`, `extensions` (aliased to `externalExtensions`,
 * default `[]`), `fileHandler`, `flaggedExtensions`, `extendedEditorProps`,
 * and `workItemIdentifier`.
 *
 * TipTap surface:
 * - Exposes the rich-text extension stack via the
 *   `RichTextEditorAdditionalExtensions` factory imported from
 *   `@/plane-editor/extensions/rich-text-extensions`.
 * - Overrides the default extension list by injecting `SideMenuExtension`
 *   configured with `dragDropEnabled: !!dragDropEnabled` and
 *   `aiEnabled: false`; caller-supplied `externalExtensions` are preserved
 *   and spread first into the resulting array.
 * - Hides the AI-features integration (`aiEnabled: false`) compared to the
 *   document-editor variant — the deliberate distinction is that the
 *   rich-text editor omits AI affordances at the side-menu layer.
 *
 * Extension assembly is memoized via `useCallback` keyed on
 * `disabledExtensions`, `flaggedExtensions`, `dragDropEnabled`,
 * `fileHandler`, `externalExtensions`, and `extendedEditorProps`, so the
 * array rebuilds only when one of those inputs changes.
 *
 * Consumed indirectly through the exported `RichTextEditorWithRef`
 * `forwardRef` wrapper.
 */
function RichTextEditor(props: IRichTextEditorProps) {
  const {
    bubbleMenuEnabled = true,
    disabledExtensions,
    dragDropEnabled,
    extensions: externalExtensions = [],
    fileHandler,
    flaggedExtensions,
    extendedEditorProps,
    workItemIdentifier,
  } = props;

  const getExtensions = useCallback(() => {
    const extensions = [
      ...externalExtensions,
      SideMenuExtension({
        aiEnabled: false,
        dragDropEnabled: !!dragDropEnabled,
      }),
      ...RichTextEditorAdditionalExtensions({
        disabledExtensions,
        fileHandler,
        flaggedExtensions,
        extendedEditorProps,
      }),
    ];

    return extensions;
  }, [dragDropEnabled, disabledExtensions, externalExtensions, fileHandler, flaggedExtensions, extendedEditorProps]);

  return (
    <EditorWrapper {...props} extensions={getExtensions()}>
      {(editor) => (
        <>
          {editor && bubbleMenuEnabled && (
            <EditorBubbleMenu
              disabledExtensions={disabledExtensions}
              editor={editor}
              extendedEditorProps={extendedEditorProps}
              flaggedExtensions={flaggedExtensions}
            />
          )}
          <BlockMenu
            editor={editor}
            flaggedExtensions={flaggedExtensions}
            disabledExtensions={disabledExtensions}
            workItemIdentifier={workItemIdentifier}
          />
        </>
      )}
    </EditorWrapper>
  );
}

/**
 * Ref-forwarding wrapper around `RichTextEditor` that exposes the editor's
 * imperative handle (`EditorRefApi`) to parent components.
 *
 * Props are passed through verbatim via spread; cite `IRichTextEditorProps`
 * for the full prop contract. The incoming `React.ForwardedRef<EditorRefApi>`
 * is cast to `React.MutableRefObject<EditorRefApi | null>` and threaded as
 * the `forwardedRef` prop into `RichTextEditor`, where the underlying
 * `useEditor` hook (via `EditorWrapper`) assigns the imperative API.
 *
 * `displayName` is set to `"RichTextEditorWithRef"` for React DevTools and
 * debugging clarity (`forwardRef` would otherwise render as anonymous).
 *
 * This is the sole public export of the file. It is re-exported through the
 * local `./index.ts` barrel, the parent
 * `packages/editor/src/core/components/editors/index.ts` barrel, and finally
 * the package-level `packages/editor/src/index.ts` entry point.
 */
const RichTextEditorWithRef = forwardRef(function RichTextEditorWithRef(
  props: IRichTextEditorProps,
  ref: React.ForwardedRef<EditorRefApi>
) {
  return <RichTextEditor {...props} forwardedRef={ref as React.MutableRefObject<EditorRefApi | null>} />;
});

RichTextEditorWithRef.displayName = "RichTextEditorWithRef";

export { RichTextEditorWithRef };
