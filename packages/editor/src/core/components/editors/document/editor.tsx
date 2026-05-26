/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Standard (non-collaborative) document-editor variant.
 *
 * Builds the TipTap extension stack synchronously, bootstraps the editor via
 * `useEditor`, and delegates rendering to `PageRenderer`. The collaborative
 * counterpart lives in `./collaborative-editor.tsx`. The public
 * ref-forwarding export from this module is `DocumentEditorWithRef`,
 * surfaced upward through `./index.ts` and `packages/editor/src/index.ts`.
 */

import type { Extensions } from "@tiptap/core";
import type { MutableRefObject } from "react";
import { forwardRef, useMemo } from "react";
// plane imports
import { cn } from "@plane/utils";
// components
import { PageRenderer } from "@/components/editors";
// constants
import { DEFAULT_DISPLAY_CONFIG } from "@/constants/config";
// extensions
import { HeadingListExtension, SideMenuExtension } from "@/extensions";
// helpers
import { getEditorClassNames } from "@/helpers/common";
// hooks
import { useEditor } from "@/hooks/use-editor";
// plane editor extensions
import { DocumentEditorAdditionalExtensions } from "@/plane-editor/extensions";
// types
import type { EditorRefApi, IDocumentEditorProps } from "@/types";

/**
 * Inner functional component implementing the standard, non-collaborative
 * document-editor flow.
 *
 * Builds the TipTap extension stack via `useMemo`, calls `useEditor` to
 * bootstrap a TipTap `Editor` instance, computes the container class string
 * via `getEditorClassNames`, short-circuits to `null` when no usable editor
 * exists yet, and otherwise delegates rendering to `PageRenderer`.
 *
 * Props are typed by `IDocumentEditorProps` (declared in `@/types` as
 * `Omit<IEditorProps, "initialValue" | "onEnterKeyPress" | "value">` plus
 * `aiHandler?`, `user?`, `value: Content`); the prop list is intentionally
 * not duplicated here.
 *
 * TipTap surface (`@plane/editor` is a first-party TipTap wrapper — this
 * contract is binding):
 * - Exposes the full document-editor extension stack: the package-owned
 *   `SideMenuExtension` (configured with
 *   `aiEnabled: !disabledExtensions?.includes("ai")` and
 *   `dragDropEnabled: true`), `HeadingListExtension`, plus the spread of
 *   the `DocumentEditorAdditionalExtensions` factory from
 *   `@/plane-editor/extensions`.
 * - Overrides the default editor extension list by injecting
 *   `SideMenuExtension` and `HeadingListExtension` ahead of the additional
 *   document-editor extensions — these are the document-specific
 *   contributions layered on top of the base TipTap extension set assembled
 *   inside `useEditor` via `CoreEditorExtensions`.
 * - Hides any TipTap defaults explicitly excluded via the
 *   `disabledExtensions` prop, which is forwarded into `useEditor`,
 *   `DocumentEditorAdditionalExtensions`, and `PageRenderer`; the special
 *   `"ai"` token suppresses AI features inside `SideMenuExtension`.
 *
 * Side effects: memoizes extension assembly via `useMemo` (recomputes only
 * when `disabledExtensions`, `editable`, `extendedEditorProps`,
 * `fileHandler`, `flaggedExtensions`, or `user` change); composes class
 * names via `getEditorClassNames` and `cn`; delegates all rendering to
 * `PageRenderer`. No direct DOM mutation, no API calls, no state owned
 * outside `useEditor`'s contract.
 *
 * Consumed by `DocumentEditorWithRef` below — the public ref-forwarding
 * wrapper surfaced upward via `./index.ts` and
 * `packages/editor/src/index.ts`, and ultimately consumed by
 * `apps/web/core/components/pages/` and similar page-rendering components.
 */
function DocumentEditor(props: IDocumentEditorProps) {
  const {
    bubbleMenuEnabled = false,
    containerClassName,
    disabledExtensions,
    displayConfig = DEFAULT_DISPLAY_CONFIG,
    editable,
    editorClassName = "",
    extendedEditorProps,
    fileHandler,
    flaggedExtensions,
    forwardedRef,
    getEditorMetaData,
    handleEditorReady,
    id,
    isTouchDevice,
    mentionHandler,
    onChange,
    user,
    value,
  } = props;
  const extensions: Extensions = useMemo(() => {
    const additionalExtensions: Extensions = [];
    additionalExtensions.push(
      SideMenuExtension({
        aiEnabled: !disabledExtensions?.includes("ai"),
        dragDropEnabled: true,
      }),
      HeadingListExtension,
      ...DocumentEditorAdditionalExtensions({
        disabledExtensions,
        extendedEditorProps,
        flaggedExtensions,
        isEditable: editable,
        fileHandler,
        userDetails: user ?? {
          id: "",
          name: "",
          color: "",
        },
      })
    );
    return additionalExtensions;
  }, [disabledExtensions, editable, extendedEditorProps, fileHandler, flaggedExtensions, user]);

  const editor = useEditor({
    disabledExtensions,
    editable,
    editorClassName,
    enableHistory: true,
    extendedEditorProps,
    extensions,
    fileHandler,
    flaggedExtensions,
    forwardedRef,
    getEditorMetaData,
    handleEditorReady,
    id,
    initialValue: value,
    mentionHandler,
    onChange,
  });

  const editorContainerClassName = getEditorClassNames({
    containerClassName,
  });

  if (!editor) return null;

  return (
    <PageRenderer
      bubbleMenuEnabled={bubbleMenuEnabled}
      displayConfig={displayConfig}
      editor={editor}
      editorContainerClassName={cn(editorContainerClassName, "document-editor")}
      extendedEditorProps={extendedEditorProps}
      id={id}
      flaggedExtensions={flaggedExtensions}
      disabledExtensions={disabledExtensions}
      isTouchDevice={!!isTouchDevice}
    />
  );
}

/**
 * Ref-forwarding wrapper exposing `DocumentEditor`'s imperative editor API to
 * parent components.
 *
 * Receives a `React.ForwardedRef<EditorRefApi>` and forwards it down to the
 * inner `DocumentEditor` as the `forwardedRef` prop. `EditorRefApi`
 * (declared in `packages/editor/src/core/types/editor.ts` as
 * `CoreEditorRefApi & TExtendedEditorRefApi`) is the same imperative ref
 * contract used by the collaborative variant
 * `CollaborativeDocumentEditorWithRef`; standardizing on a single ref shape
 * across variants lets parents swap between collaborative and
 * non-collaborative editors without changing call sites that drive the
 * editor imperatively.
 *
 * Props are identical to the inner `DocumentEditor`'s `IDocumentEditorProps`;
 * see the JSDoc above for the rendered behavior, side effects, and the
 * TipTap extension surface. Exported as `DocumentEditorWithRef` via the
 * `export { DocumentEditorWithRef }` statement at the bottom of this file.
 */
const DocumentEditorWithRef = forwardRef(function DocumentEditorWithRef(
  props: IDocumentEditorProps,
  ref: React.ForwardedRef<EditorRefApi>
) {
  return <DocumentEditor {...props} forwardedRef={ref as MutableRefObject<EditorRefApi | null>} />;
});

DocumentEditorWithRef.displayName = "DocumentEditorWithRef";

export { DocumentEditorWithRef };
