/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Composes the collaborative editing surface for documents that need a
 * synchronized body + title editor pair backed by a single Hocuspocus
 * document.
 *
 * This hook is the composition root for the collaborative editor: it wires
 * `useEditor` (from `./use-editor`) for the body, `useTitleEditor` (from
 * `./use-title-editor`) for the page title, and `useEditorNavigation` (from
 * `./use-editor-navigation`) for the shared keyboard-navigation layer.
 * The integrated bundle is consumed downstream by
 * `CollaborativeDocumentEditorWithRef`
 * (see `core/components/editors/document/collaborative-editor.tsx`).
 *
 * The `HocuspocusProvider` is NOT instantiated here. Callers must
 * pre-construct it — typically via `use-yjs-setup.ts` and the
 * `CollaborationProvider` React context — and pass the live provider
 * through `props.provider`. This separation lets `use-yjs-setup.ts` own
 * session lifecycle (connect, reconnect, force-close) while this hook
 * focuses purely on TipTap editor wiring.
 */
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Extensions } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
// react
import type React from "react";
import { useEffect, useMemo } from "react";
// extensions
import { HeadingListExtension, SideMenuExtension } from "@/extensions";
// hooks
import { useEditor } from "@/hooks/use-editor";
// plane editor extensions
import { DocumentEditorAdditionalExtensions } from "@/plane-editor/extensions";
// types
import type {
  TCollaborativeEditorHookProps,
  ICollaborativeDocumentEditorProps,
  IEditorPropsExtended,
  IEditorProps,
  TEditorHookProps,
  EditorTitleRefApi,
} from "@/types";
// local imports
import { useEditorNavigation } from "./use-editor-navigation";
import { useTitleEditor } from "./use-title-editor";

/**
 * Inputs accepted by `useCollaborativeEditor` — derived from
 * `TCollaborativeEditorHookProps`.
 *
 * `realtimeConfig`, `serverHandler`, and `user` are stripped from the
 * public collaborative-editor contract because this internal hook receives
 * a fully-constructed `provider` and a resolved `user` directly. The
 * session-management portions of `serverHandler` / `realtimeConfig`
 * (connect, reconnect, fallback fetching, persistence callbacks) are
 * handled upstream by `use-yjs-setup.ts`; by the time this hook runs the
 * provider is already configured against those handlers.
 *
 * `actions.signalForcedClose` is forwarded down from `use-yjs-setup.ts`
 * (via the `CollaborationProvider` context) so component callers can
 * request the upstream session to mark the next close event as forced —
 * preventing the auto-reconnect logic from treating it as a transient
 * network drop.
 */
type UseCollaborativeEditorArgs = Omit<TCollaborativeEditorHookProps, "realtimeConfig" | "serverHandler" | "user"> & {
  provider: HocuspocusProvider;
  user: TCollaborativeEditorHookProps["user"];
  actions: {
    signalForcedClose: (value: boolean) => void;
  };
};

/**
 * Wires a body editor and a title editor onto a single shared Hocuspocus
 * document and registers them with the cross-editor keyboard-navigation
 * layer.
 *
 * Body editor extension stack (composition order — mirrors the
 * `editorExtensions` memo below):
 *   1. `SideMenuExtension({ aiEnabled: !disabledExtensions?.includes("ai"), dragDropEnabled })`
 *      — drag-handle + slash-menu sidebar; the AI sub-extension is toggled
 *      by membership in `disabledExtensions`.
 *   2. `HeadingListExtension` — exposes the heading-outline panel.
 *   3. `Collaboration.configure({ document: provider.document, field: "default" })`
 *      — binds the body editor to the Y.Doc's `"default"` field.
 *   4. `...extensions` — caller-supplied extras, appended verbatim.
 *   5. `...DocumentEditorAdditionalExtensions({ disabledExtensions, extendedEditorProps, fileHandler, flaggedExtensions, isEditable: editable, provider, userDetails: user })`
 *      — Plane-edition extras (set varies by plane-editor build; each
 *      extension is documented in its own file).
 *   6. `mainNavigationExtension` from `useEditorNavigation()` — handles
 *      ArrowUp / ArrowLeft / Backspace transfers from the body back to
 *      the title.
 *
 * Title editor extension stack:
 *   1. `Collaboration.configure({ document: provider.document, field: "title" })`
 *      — same Y.Doc, separate field; this is the mechanism by which body
 *      and title share a single Y.js document but stay logically separate.
 *   2. `titleNavigationExtension` from `useEditorNavigation()` — handles
 *      ArrowDown / ArrowRight / Enter transfers from the title to the body.
 *
 * TipTap Collaboration extension treatment:
 *   - Exposed: the vanilla TipTap `Collaboration` extension's Y.js
 *     binding. Awareness state (`provider.awareness`) is NOT bound here —
 *     callers wire awareness/cursors separately when needed.
 *   - Overridden: none — `Collaboration.configure` is called with the
 *     standard `{ document, field }` shape only.
 *   - Intentionally hidden: none.
 *
 * Y.Doc handoff: the body editor binds to `provider.document` with field
 * `"default"` and the title editor binds to the SAME `provider.document`
 * with field `"title"`. Because both fields live in the same Y.Doc,
 * server-side persistence (`apps/live/src/extensions/database.ts`) sees
 * a single document; CRDT auto-merge applies independently to each
 * field's XmlFragment. See tech spec section 5.2.5.4.
 *
 * Memoization rationale:
 *   - `editorExtensions` is memoized so the body editor is not
 *     unnecessarily recreated on every render.
 *   - `editorConfig` is memoized for the same reason; its dep list
 *     mirrors every primitive prop that affects editor wiring.
 *   - `titleExtensions` and `titleEditorConfig` are memoized symmetrically
 *     for the title editor.
 *
 * Navigation registration: a `useEffect` calls `setMainEditor(editor)` and
 * `setTitleEditor(titleEditor)` once both instances are non-null. The
 * navigation extensions captured ref-getter callbacks at construction
 * time, so this effect publishes the latest editor references to those
 * getters — without it, the cross-editor arrow-key transfers would see
 * `null` and abort.
 *
 * @param props - {@link UseCollaborativeEditorArgs} — the merged config
 *   for body + title editors plus the pre-constructed provider.
 * @returns `{ editor, titleEditor }` — two `Editor | null` references.
 *   Callers (typically `CollaborativeDocumentEditorWithRef`) use both:
 *   the body editor renders the main document and the title editor
 *   renders the page title.
 */
export const useCollaborativeEditor = (props: UseCollaborativeEditorArgs) => {
  const {
    provider,
    onAssetChange,
    onChange,
    onTransaction,
    disabledExtensions,
    editable,
    editorClassName = "",
    editorProps = {},
    extendedEditorProps,
    extensions = [],
    fileHandler,
    flaggedExtensions,
    forwardedRef,
    getEditorMetaData,
    handleEditorReady,
    id,
    mentionHandler,
    dragDropEnabled = true,
    isTouchDevice,
    onEditorFocus,
    placeholder,
    showPlaceholderOnEmpty,
    tabIndex,
    titleRef,
    updatePageProperties,
    user,
  } = props;

  const { mainNavigationExtension, titleNavigationExtension, setMainEditor, setTitleEditor } = useEditorNavigation();

  // Memoize extensions to avoid unnecessary editor recreations
  const editorExtensions = useMemo(
    () => [
      SideMenuExtension({
        aiEnabled: !disabledExtensions?.includes("ai"),
        dragDropEnabled,
      }),
      HeadingListExtension,
      Collaboration.configure({
        document: provider.document,
        field: "default",
      }),
      ...extensions,
      ...DocumentEditorAdditionalExtensions({
        disabledExtensions,
        extendedEditorProps,
        fileHandler,
        flaggedExtensions,
        isEditable: editable,
        provider,
        userDetails: user,
      }),
      mainNavigationExtension,
    ],
    [
      provider,
      disabledExtensions,
      dragDropEnabled,
      extensions,
      extendedEditorProps,
      fileHandler,
      flaggedExtensions,
      editable,
      user,
      mainNavigationExtension,
    ]
  );

  // Editor configuration
  const editorConfig = useMemo<TEditorHookProps>(
    () => ({
      disabledExtensions,
      extendedEditorProps,
      id,
      editable,
      editorProps,
      editorClassName,
      enableHistory: false,
      extensions: editorExtensions,
      fileHandler,
      flaggedExtensions,
      forwardedRef,
      getEditorMetaData,
      handleEditorReady,
      isTouchDevice,
      mentionHandler,
      onAssetChange,
      onChange,
      onEditorFocus,
      onTransaction,
      placeholder,
      showPlaceholderOnEmpty,
      provider,
      tabIndex,
    }),
    [
      provider,
      disabledExtensions,
      extendedEditorProps,
      id,
      editable,
      editorProps,
      editorClassName,
      editorExtensions,
      fileHandler,
      flaggedExtensions,
      forwardedRef,
      getEditorMetaData,
      handleEditorReady,
      isTouchDevice,
      mentionHandler,
      onAssetChange,
      onChange,
      onEditorFocus,
      onTransaction,
      placeholder,
      showPlaceholderOnEmpty,
      tabIndex,
    ]
  );

  const editor = useEditor(editorConfig);

  const titleExtensions = useMemo(
    () => [
      Collaboration.configure({
        document: provider.document,
        field: "title",
      }),
      titleNavigationExtension,
    ],
    [provider, titleNavigationExtension]
  );

  const titleEditorConfig = useMemo<{
    id: string;
    editable: boolean;
    provider: HocuspocusProvider;
    titleRef?: React.MutableRefObject<EditorTitleRefApi | null>;
    updatePageProperties?: ICollaborativeDocumentEditorProps["updatePageProperties"];
    extensions: Extensions;
    extendedEditorProps?: IEditorPropsExtended;
    getEditorMetaData?: IEditorProps["getEditorMetaData"];
  }>(
    () => ({
      id,
      editable,
      provider,
      titleRef,
      updatePageProperties,
      extensions: titleExtensions,
      extendedEditorProps,
      getEditorMetaData,
    }),
    [provider, id, editable, titleRef, updatePageProperties, titleExtensions, extendedEditorProps, getEditorMetaData]
  );

  const titleEditor = useTitleEditor(titleEditorConfig as Parameters<typeof useTitleEditor>[0]);

  useEffect(() => {
    if (editor && titleEditor) {
      setMainEditor(editor);
      setTitleEditor(titleEditor);
    }
  }, [editor, titleEditor, setMainEditor, setTitleEditor]);

  return {
    editor,
    titleEditor,
  };
};
