/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * @fileoverview Primary TipTap editor bootstrap hook used by every Plane editor
 * variant (lite-text, rich-text, document, collaborative document).
 *
 * This module is the single canonical place where TipTap's `useEditor` from
 * `@tiptap/react` is configured with Plane's `CoreEditorExtensions`,
 * `CoreEditorProps`, value synchronization, asset notifications, and the
 * imperative `EditorRefApi` handle. Variant hooks (collaborative, title, etc.)
 * compose on top of this hook rather than calling `useTiptapEditor` directly,
 * so the configuration applied here is the de-facto baseline contract for the
 * `@plane/editor` package.
 *
 * Callers receive the imperative API surface by passing the optional
 * `forwardedRef` — see the `EditorRefApi` type for the full handle contract;
 * this file intentionally does not duplicate that surface.
 */

import { useEditorState, useEditor as useTiptapEditor } from "@tiptap/react";
import { useImperativeHandle, useEffect } from "react";
import type { MarkdownStorage } from "tiptap-markdown";
// extensions
import { CoreEditorExtensions } from "@/extensions";
// helpers
import { getEditorRefHelpers } from "@/helpers/editor-ref";
// props
import { CoreEditorProps } from "@/props";
// types
import type { TEditorHookProps } from "@/types";

/**
 * Module augmentation that registers `tiptap-markdown`'s `MarkdownStorage` on
 * the global TipTap `Storage` map so `editor.storage.markdown.getMarkdown()`
 * is strongly typed across the package. The declaration must live next to the
 * code that actually uses TipTap so that downstream consumers of this hook
 * receive the augmented types via normal module resolution.
 */
declare module "@tiptap/core" {
  interface Storage {
    markdown: MarkdownStorage;
  }
}

/**
 * Constructs a fully-configured TipTap editor instance from `TEditorHookProps`,
 * wires lifecycle callbacks, synchronizes external value changes, and exposes
 * the editor through an imperative `EditorRefApi`.
 *
 * All inputs are accepted as the single `TEditorHookProps` object — see
 * `@/types` for the full shape. Documented below are only the integration
 * points this hook acts on.
 *
 * Extension assembly:
 *   The hook concatenates `CoreEditorExtensions({ ... })` with the
 *   caller-supplied `extensions` prop, ensuring caller extensions run after
 *   the Plane baseline. The base set is built from these option fields read
 *   off `props`: `disabledExtensions`, `editable`, `enableHistory`,
 *   `extendedEditorProps`, `fileHandler`, `flaggedExtensions`,
 *   `getEditorMetaData`, `isTouchDevice`, `mentionHandler`, `placeholder`,
 *   `showPlaceholderOnEmpty`, `tabIndex`, `provider`.
 *
 * Editor props assembly:
 *   `CoreEditorProps({ editorClassName })` is spread first, then the
 *   caller's `editorProps` overrides; this spread order ensures
 *   caller-provided props win against the Plane defaults.
 *
 * Initial content:
 *   `initialValue` is passed verbatim as TipTap's `content`.
 *
 * Lifecycle callbacks consumed from `props`:
 *   - `handleEditorReady?.(true)` is invoked from TipTap's `onCreate`;
 *     `handleEditorReady?.(false)` is invoked from `onDestroy`.
 *   - `onTransaction?.()` is invoked from `onTransaction` (no payload —
 *     TipTap's transaction is intentionally wrapped to a void notification
 *     so consumers cannot couple to internal transaction shapes).
 *   - `onChange?.(json, html, { isMigrationUpdate })` is invoked from
 *     `onUpdate` with both the JSON and HTML representations.
 *     `isMigrationUpdate` is read from the TipTap transaction's
 *     `uniqueIdOnlyChange` meta flag so consumers can suppress activity
 *     logging for purely structural migrations (e.g., backfilling
 *     unique IDs on existing nodes).
 *   - `onEditorFocus` is forwarded directly to TipTap's `onFocus`.
 *
 * Non-obvious TipTap configuration:
 *   - `immediatelyRender: false` prevents SSR hydration mismatches. The
 *     `@plane/editor` package is consumer-agnostic and must be safe under
 *     SSR pipelines; leaving immediate render disabled defers the first
 *     DOM rendering until after hydration so the client and server trees
 *     agree on initial markup.
 *   - `shouldRerenderOnTransaction: false` avoids React rerenders on every
 *     keystroke. TipTap manages its own DOM updates internally; React only
 *     needs to rerender this component when the editor instance reference
 *     itself changes or when an external prop change (e.g., `editable`)
 *     forces a recreation via the dependency array.
 *
 * Effects:
 *   - First effect (deps `[editor, value, id]`) synchronizes the external
 *     `value` prop into the editor. It skips when `value == null` (the
 *     intentional sentinel for "no external sync yet"), and skips when the
 *     editor is destroyed OR `editor.storage.utility.uploadInProgress` is
 *     truthy so an in-flight upload cannot be clobbered by an upstream
 *     refresh. After `setContent`, the cursor is preserved at
 *     `min(selection.from, docLength - 1)` so the caret does not jump past
 *     the new document length.
 *   - Second effect (deps `[editor, fileHandler.assetsUploadStatus]`)
 *     forwards `fileHandler.assetsUploadStatus` into the editor by calling
 *     `editor.commands.updateAssetsUploadStatus?.(...)` so upload-tracking
 *     UI rendered inside the editor stays in sync with the external upload
 *     state owned by the caller.
 *   - Asset-list subscription via `useEditorState` exposes
 *     `editor.storage.utility.assetsList` through a memoized selector. The
 *     selector returns `{ assets: [] }` when the editor is null so the
 *     subscription identity remains stable across editor recreations.
 *   - Third effect (deps `[assetsList?.assets, onAssetChange]`) invokes the
 *     optional `onAssetChange(assets)` callback whenever the derived assets
 *     list changes — used by callers to mirror editor-owned asset state
 *     into external stores.
 *
 * Imperative `EditorRefApi`:
 *   The hook calls
 *   `useImperativeHandle(forwardedRef, () => getEditorRefHelpers({ editor, getEditorMetaData, provider }), [editor, getEditorMetaData, provider])`.
 *   The returned `EditorRefApi` exposes the following categories (the full
 *   surface lives on the type itself — see `@/types`):
 *     - Focus / blur control
 *     - Content read / write (JSON, HTML, Markdown, plain text)
 *     - Asset-list access (the same `assetsList` exposed via the
 *       subscription above)
 *     - Scroll-to-node helpers
 *     - Provider access for collaborative variants
 *
 * @returns The constructed TipTap `Editor` instance, or `null` while
 * `useTiptapEditor` has not yet produced one (e.g., before first mount or
 * during a forced recreation triggered by the `editable` dependency).
 */
export const useEditor = (props: TEditorHookProps) => {
  const {
    autofocus = false,
    disabledExtensions,
    editable = true,
    editorClassName = "",
    editorProps = {},
    enableHistory,
    extendedEditorProps,
    extensions = [],
    fileHandler,
    flaggedExtensions,
    forwardedRef,
    getEditorMetaData,
    handleEditorReady,
    id = "",
    initialValue,
    isTouchDevice,
    mentionHandler,
    onAssetChange,
    onChange,
    onEditorFocus,
    onTransaction,
    placeholder,
    showPlaceholderOnEmpty,
    tabIndex,
    provider,
    value,
  } = props;

  const editor = useTiptapEditor(
    {
      editable,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      autofocus,
      parseOptions: { preserveWhitespace: true },
      editorProps: {
        ...CoreEditorProps({
          editorClassName,
        }),
        ...editorProps,
      },
      extensions: [
        ...CoreEditorExtensions({
          disabledExtensions,
          editable,
          enableHistory,
          extendedEditorProps,
          fileHandler,
          flaggedExtensions,
          getEditorMetaData,
          isTouchDevice,
          mentionHandler,
          placeholder,
          showPlaceholderOnEmpty,
          tabIndex,
          provider,
        }),
        ...extensions,
      ],
      content: initialValue,
      onCreate: () => handleEditorReady?.(true),
      onTransaction: () => {
        onTransaction?.();
      },
      onUpdate: ({ editor, transaction }) => {
        // Check if this update is only due to migration update
        const isMigrationUpdate = transaction?.getMeta("uniqueIdOnlyChange") === true;
        onChange?.(editor.getJSON(), editor.getHTML(), { isMigrationUpdate });
      },
      onDestroy: () => handleEditorReady?.(false),
      onFocus: onEditorFocus,
    },
    [editable]
  );

  // Effect for syncing SWR data
  useEffect(() => {
    // value is null when intentionally passed where syncing is not yet
    // supported and value is undefined when the data from swr is not populated
    if (value == null) return;
    if (editor) {
      const { uploadInProgress: isUploadInProgress } = editor.storage.utility;
      if (!editor.isDestroyed && !isUploadInProgress) {
        try {
          editor.commands.setContent(value, false, {
            preserveWhitespace: true,
          });
          if (editor.state.selection) {
            const docLength = editor.state.doc.content.size;
            const relativePosition = Math.min(editor.state.selection.from, docLength - 1);
            editor.commands.setTextSelection(relativePosition);
          }
        } catch (error) {
          console.error("Error syncing editor content with external value:", error);
        }
      }
    }
  }, [editor, value, id]);

  // update assets upload status
  useEffect(() => {
    if (!editor) return;
    const assetsUploadStatus = fileHandler.assetsUploadStatus;
    editor.commands.updateAssetsUploadStatus?.(assetsUploadStatus);
  }, [editor, fileHandler.assetsUploadStatus]);

  // subscribe to assets list changes
  const assetsList = useEditorState({
    editor,
    selector: ({ editor }) => ({
      assets: editor?.storage.utility?.assetsList ?? [],
    }),
  });
  // trigger callback when assets list changes
  useEffect(() => {
    const assets = assetsList?.assets;
    if (!assets || !onAssetChange) return;
    onAssetChange(assets);
  }, [assetsList?.assets, onAssetChange]);

  useImperativeHandle(
    forwardedRef,
    () =>
      getEditorRefHelpers({
        editor,
        getEditorMetaData,
        provider,
      }),
    [editor, getEditorMetaData, provider]
  );

  if (!editor) {
    return null;
  }

  return editor;
};
