/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Derived hook prop contracts for the editor's React hook layer.
 *
 * `TEditorHookProps` and `TCollaborativeEditorHookProps` are built from
 * `IEditorProps` / `ICollaborativeDocumentEditorProps` via `Pick` +
 * intersection so any field added (or renamed) on the component prop
 * interfaces flows into the hook contracts without a parallel manual
 * definition — preventing drift between component props and hook props.
 *
 * Consumers: `core/hooks/use-editor.ts`,
 * `core/hooks/use-collaborative-editor.ts`,
 * `core/hooks/use-title-editor.ts`.
 */

import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Content } from "@tiptap/core";
// local imports
import type { ICollaborativeDocumentEditorProps, IEditorProps } from "./editor";

type TCoreHookProps = Pick<
  IEditorProps,
  | "disabledExtensions"
  | "editorClassName"
  | "editorProps"
  | "extendedEditorProps"
  | "extensions"
  | "flaggedExtensions"
  | "getEditorMetaData"
  | "handleEditorReady"
  | "isTouchDevice"
  | "onEditorFocus"
>;

/**
 * Prop contract for the `useEditor` / `useTitleEditor` hook family — the
 * input shape for non-collaborative editor instantiation.
 *
 * Derived from `IEditorProps` via `Pick` + intersection (see `IEditorProps`
 * for the picked-field semantics). The hook-only additions are:
 *   - `editable: boolean` — explicit at the hook layer so the contract is
 *     self-contained and not subject to upstream `Pick` selections.
 *   - `enableHistory: boolean` — hook-only; does NOT exist on `IEditorProps`.
 *     Controls whether the undo/redo (history) extension is wired; the hooks
 *     decide history wiring per editor variant rather than exposing it as a
 *     component prop.
 *   - `initialValue?: Content` — richer TipTap `Content` (the component-prop
 *     `IEditorProps.initialValue` is `string`); the hook marshals either
 *     form into the ProseMirror schema.
 *   - `provider?: HocuspocusProvider` — when present, the hook wires the
 *     Yjs collaboration extensions; when absent, the editor runs in
 *     non-collaborative mode. Effectively the discriminator between
 *     collaborative and non-collaborative `useEditor` calls.
 *
 * Consumers: `core/hooks/use-editor.ts`, `core/hooks/use-title-editor.ts`.
 */
export type TEditorHookProps = TCoreHookProps &
  Pick<
    IEditorProps,
    | "autofocus"
    | "fileHandler"
    | "forwardedRef"
    | "id"
    | "mentionHandler"
    | "onAssetChange"
    | "onChange"
    | "onTransaction"
    | "placeholder"
    | "showPlaceholderOnEmpty"
    | "tabIndex"
    | "value"
  > & {
    editable: boolean;
    enableHistory: boolean;
    initialValue?: Content;
    provider?: HocuspocusProvider;
  };

/**
 * Prop contract for the `useCollaborativeEditor` hook — the input shape
 * for collaborative editor instantiation (Yjs + Hocuspocus).
 *
 * Derived from `TEditorHookProps` and `ICollaborativeDocumentEditorProps`
 * via `Pick` + intersection. The collaboration-specific fields contributed
 * here (see the respective component-prop interfaces for full semantics) are:
 *   - `realtimeConfig` — Hocuspocus URL / room configuration.
 *   - `serverHandler` — collaboration state observer hooks (load/save/sync).
 *   - `user` — identity used for awareness, cursors, and selection presence.
 *   - `dragDropEnabled` — drag-drop toggle (the document editor enables it
 *     by default; lite/rich variants may not).
 *   - `extendedDocumentEditorProps` — overlay-specific document editor
 *     props injected by the plane-editor extension layer.
 *
 * Optional fields with behavioral implications:
 *   - `titleRef?` — when provided, the hook syncs title-editor changes
 *     into Yjs alongside body changes (otherwise the title is body-only).
 *   - `updatePageProperties?` — when provided, the hook emits realtime
 *     page-property events through `apps/live` (otherwise property
 *     mutations stay local to the editor instance).
 *
 * Consumer: `core/hooks/use-collaborative-editor.ts`.
 */
export type TCollaborativeEditorHookProps = TCoreHookProps &
  Pick<
    TEditorHookProps,
    | "editable"
    | "fileHandler"
    | "forwardedRef"
    | "id"
    | "mentionHandler"
    | "onAssetChange"
    | "onChange"
    | "onTransaction"
    | "placeholder"
    | "showPlaceholderOnEmpty"
    | "tabIndex"
  > &
  Pick<
    ICollaborativeDocumentEditorProps,
    "dragDropEnabled" | "extendedDocumentEditorProps" | "realtimeConfig" | "serverHandler" | "user"
  > & {
    titleRef?: ICollaborativeDocumentEditorProps["titleRef"];
    updatePageProperties?: ICollaborativeDocumentEditorProps["updatePageProperties"];
  };
