/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Creates the page-title TipTap editor that shares a Y.Doc with the body editor (for
 * collaborative documents).
 *
 * The title editor uses a restricted extension set (`TitleExtensions` — a single `H1` plus a
 * text node) plus a hard-configured `Placeholder("Untitled")`, so it cannot be made bold,
 * italicized, listed, or otherwise enriched with body-editor formatting.
 *
 * When wired into a collaborative document, the title editor and body editor share the same
 * `provider.document` Y.Doc but bind to different Y.Doc fields (`"title"` vs `"default"`). That
 * wiring happens in `use-collaborative-editor.ts` — this hook itself does NOT add a Collaboration
 * extension; callers must pass it via the `extensions` prop.
 */

import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Extensions } from "@tiptap/core";
import { Placeholder } from "@tiptap/extension-placeholder";
import { useEditor } from "@tiptap/react";
import { useImperativeHandle } from "react";
// constants
import { CORE_EDITOR_META } from "@/constants/meta";
// extensions
import { TitleExtensions } from "@/extensions/title-extension";
// helpers
import { getEditorRefHelpers } from "@/helpers/editor-ref";
// types
import type { IEditorPropsExtended, IEditorProps } from "@/types";
import type { EditorTitleRefApi, ICollaborativeDocumentEditorProps } from "@/types/editor";

/**
 * Inputs accepted by `useTitleEditor`.
 *
 * Field semantics:
 * - `editable`: optional; defaults to `true` (set to `false` for read-only pages).
 * - `provider`: a configured `HocuspocusProvider`; its `document.guid` is used as part of the
 *   editor recreation key so a fresh Y.Doc forces a full editor remount.
 * - `titleRef`: optional `EditorTitleRefApi` imperative handle; populated via
 *   `useImperativeHandle` with editor-ref helpers plus title-specific `clearEditor` and
 *   `setEditorValue` overrides.
 * - `extensions`: optional extra TipTap extensions appended after `TitleExtensions` (e.g., the
 *   `titleNavigationExtension` from `use-editor-navigation.ts`).
 * - `initialValue`: optional initial HTML (e.g., `"<h1>Existing title</h1>"`); falls back to
 *   `"<h1></h1>"` when blank or missing.
 * - `updatePageProperties`: optional callback invoked on every `onUpdate` with the latest
 *   plain-text title; used to keep page-level metadata (page name, search index) in sync.
 * - `id`: stable page id; used as a fallback document key when `provider.document.guid` is
 *   unavailable.
 * - `extendedEditorProps`: passthrough for editor-extended props consumed by downstream layers.
 * - `getEditorMetaData`: optional function returning `{ file_assets, user_mentions }` for
 *   ref-helper bookkeeping; defaults to an empty fixture inside the hook.
 */
type TUseTitleEditorProps = {
  editable?: boolean;
  provider: HocuspocusProvider;
  titleRef?: React.MutableRefObject<EditorTitleRefApi | null>;
  extensions?: Extensions;
  initialValue?: string;
  // INTENT UNCLEAR: `field` is declared on the prop type but is never destructured or consumed by the hook body — the Y.Doc field binding is controlled by the caller-supplied Collaboration extension, not by this hook.
  field?: string;
  // INTENT UNCLEAR: `placeholder` is declared on the prop type but the hook body hard-codes the placeholder text to "Untitled"; caller-supplied values are ignored.
  placeholder?: string;
  updatePageProperties?: ICollaborativeDocumentEditorProps["updatePageProperties"];
  id: string;
  extendedEditorProps?: IEditorPropsExtended;
  getEditorMetaData?: IEditorProps["getEditorMetaData"];
};

/**
 * Creates a title-only TipTap editor whose imperative handle merges the shared editor-ref helpers
 * with title-specific clear/set methods.
 *
 * Extension stack assembled: `TitleExtensions` (H1 + text only) + caller-supplied `extensions` +
 * a `Placeholder` extension hard-configured with text `"Untitled"`, `includeChildren: true`, and
 * `showOnlyWhenEditable: false`.
 *
 * Document-key derivation (`provider?.document?.guid ?? id`): when the Hocuspocus provider's
 * underlying Y.Doc is swapped (e.g., the page is replaced), the GUID changes, appears in the
 * `useEditor` deps array, and forces a full editor recreation. The `id` fallback covers the rare
 * case where the provider has not yet attached a Y.Doc.
 *
 * `immediatelyRender: false` prevents SSR hydration mismatches in renderers that pre-render on
 * the server before mounting on the client.
 *
 * `shouldRerenderOnTransaction: false` avoids React rerenders on every keystroke; TipTap renders
 * the title via its own DOM updates and React only rerenders when the editor instance itself
 * changes.
 *
 * Initial content: `initialValue` when non-empty, otherwise `"<h1></h1>"`.
 *
 * Side effect on update: every `onUpdate` invokes
 * `updatePageProperties?.(id, "property_updated", { name: editor.getText() })`, publishing the
 * title's plain text back to page metadata. `getText()` returns plaintext, which is the desired
 * payload for indexing and page-list rendering.
 *
 * Imperative handle (`useImperativeHandle(titleRef, ...)`) merges `getEditorRefHelpers(...)` with
 * two title-specific overrides:
 *
 * - `clearEditor(emitUpdate?)`: clears all content after setting two TipTap meta flags on the
 *   transaction — `CORE_EDITOR_META.SKIP_FILE_DELETION = true` and
 *   `CORE_EDITOR_META.INTENTIONAL_DELETION = true`. `SKIP_FILE_DELETION` is the non-obvious flag
 *   that distinguishes this hook from a vanilla TipTap title editor: the shared editor-ref
 *   helpers also serve the body editor, which uses content-clearing as a signal that referenced
 *   file assets should be marked for cleanup. The title editor never holds file references, so
 *   its clear must NOT trigger file-asset bookkeeping; `SKIP_FILE_DELETION` tells downstream
 *   listeners (e.g., the file-asset extension on the body editor) to treat this transaction as a
 *   no-op for asset cleanup. `INTENTIONAL_DELETION` marks the clear as user-initiated (vs. an
 *   automated remount) so undo, history, and activity-logging consumers can distinguish the two.
 * - `setEditorValue(content)`: replaces the entire title via
 *   `editor.commands.setContent(content, false)`. The `false` second argument suppresses the
 *   resulting `onUpdate` so the change does NOT roundtrip to `updatePageProperties` — the desired
 *   behavior when the caller is itself driving the new value from page metadata.
 *
 * @param props - {@link TUseTitleEditorProps}
 * @returns the TipTap `Editor | null` instance; callers usually consume the editor via the
 *   imperative ref rather than the returned editor.
 */
export const useTitleEditor = (props: TUseTitleEditorProps) => {
  const {
    editable = true,
    id,
    initialValue = "",
    extensions,
    provider,
    updatePageProperties,
    titleRef,
    getEditorMetaData,
  } = props;

  // Force editor recreation when Y.Doc changes (provider.document.guid)
  const docKey = provider?.document?.guid ?? id;

  const editor = useEditor(
    {
      onUpdate: ({ editor }) => {
        updatePageProperties?.(id, "property_updated", { name: editor?.getText() });
      },
      editable,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      extensions: [
        ...TitleExtensions,
        ...(extensions ?? []),
        Placeholder.configure({
          placeholder: () => "Untitled",
          includeChildren: true,
          showOnlyWhenEditable: false,
        }),
      ],
      content: typeof initialValue === "string" && initialValue.trim() !== "" ? initialValue : "<h1></h1>",
    },
    [editable, initialValue, docKey]
  );

  useImperativeHandle(titleRef, () => ({
    ...getEditorRefHelpers({
      editor,
      provider,
      getEditorMetaData: getEditorMetaData ?? (() => ({ file_assets: [], user_mentions: [] })),
    }),
    clearEditor: (emitUpdate = false) => {
      editor
        ?.chain()
        .setMeta(CORE_EDITOR_META.SKIP_FILE_DELETION, true)
        .setMeta(CORE_EDITOR_META.INTENTIONAL_DELETION, true)
        .clearContent(emitUpdate)
        .run();
    },
    setEditorValue: (content: string) => {
      editor?.commands.setContent(content, false);
    },
  }));

  return editor;
};
