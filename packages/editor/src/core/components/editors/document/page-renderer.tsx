/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Visual composition layer for the document-editor variant.
 *
 * Implements `PageRenderer`, which switches between the loading skeleton and
 * the editable UI, optionally mounts a separate title editor above the body
 * editor, and conditionally renders the bubble/block menus on non-touch
 * devices. Acts as the rendering delegate for both the standard
 * (`./editor.tsx`) and collaborative (`./collaborative-editor.tsx`) variants.
 */

import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Editor } from "@tiptap/react";
// plane imports
import { cn } from "@plane/utils";
// components
import { DocumentContentLoader, EditorContainer, EditorContentWrapper } from "@/components/editors";
import { BlockMenu, EditorBubbleMenu } from "@/components/menus";
// types
import type { TCollabValue } from "@/contexts";
import type {
  ICollaborativeDocumentEditorPropsExtended,
  IEditorProps,
  IEditorPropsExtended,
  TAIHandler,
  TDisplayConfig,
} from "@/types";

type Props = {
  aiHandler?: TAIHandler;
  bubbleMenuEnabled: boolean;
  disabledExtensions: IEditorProps["disabledExtensions"];
  displayConfig: TDisplayConfig;
  documentLoaderClassName?: string;
  editor: Editor;
  titleEditor?: Editor;
  editorContainerClassName: string;
  extendedDocumentEditorProps?: ICollaborativeDocumentEditorPropsExtended;
  extendedEditorProps: IEditorPropsExtended;
  flaggedExtensions: IEditorProps["flaggedExtensions"];
  id: string;
  isLoading?: boolean;
  isTouchDevice: boolean;
  tabIndex?: number;
  provider?: HocuspocusProvider;
  state?: TCollabValue["state"];
};

/**
 * Document-editor page-level renderer.
 *
 * Branches between `DocumentContentLoader` (when `isLoading === true`) and the
 * editable document UI; optionally renders a separate title `EditorContainer`
 * + `EditorContentWrapper` above the body editor; renders the body editor
 * inside its own `EditorContainer` + `EditorContentWrapper`; conditionally
 * renders `EditorBubbleMenu` (when `bubbleMenuEnabled` is `true`) and
 * `BlockMenu` only when the editor is editable AND the device is non-touch.
 *
 * Props are typed by the local `Props` alias declared immediately above (not
 * exported) — composed from `IEditorProps["disabledExtensions"]`,
 * `IEditorProps["flaggedExtensions"]`, `TDisplayConfig`, `TAIHandler`,
 * `ICollaborativeDocumentEditorPropsExtended`, `IEditorPropsExtended`, and
 * `TCollabValue["state"]` re-exported from `@/types` and `@/contexts`.
 *
 * `provider` and `state` carry the Hocuspocus provider and collaboration
 * `state` slice received from `CollaborativeDocumentEditorInner`; they are
 * populated only for the collaborative variant and `undefined` for the
 * standard variant. They are forwarded to the body `EditorContainer` so it
 * can gate hash-based scroll-to-node on collaboration sync readiness.
 *
 * Side effects: none direct — only `cn` class-name composition. No API
 * calls, no global state mutation, no imperative DOM operations of its own.
 *
 * TipTap surface:
 * - Exposes the body and title `Editor` instances unchanged through
 *   `EditorContentWrapper`, which itself mounts TipTap's native
 *   `<EditorContent />`.
 * - Overrides TipTap's default content-only mount by composing a separate
 *   title editor (when `titleEditor` is provided) and the contextual
 *   bubble/block menus alongside the body editor.
 * - Hides the bubble menu and block menu on touch devices (forced off via
 *   `!isTouchDevice`), and hides the bubble menu when `bubbleMenuEnabled` is
 *   `false`.
 *
 * Consumed by `./editor.tsx` (`DocumentEditor`) and `./collaborative-editor.tsx`
 * (`CollaborativeDocumentEditorInner`); both delegate their final rendering to
 * this component.
 */
export function PageRenderer(props: Props) {
  const {
    bubbleMenuEnabled,
    disabledExtensions,
    displayConfig,
    documentLoaderClassName,
    editor,
    editorContainerClassName,
    extendedEditorProps,
    flaggedExtensions,
    id,
    isLoading,
    isTouchDevice,
    tabIndex,
    titleEditor,
    provider,
    state,
  } = props;
  return (
    <div
      className={cn("frame-renderer w-full flex-grow", {
        "wide-layout": displayConfig.wideLayout,
      })}
    >
      {isLoading ? (
        <DocumentContentLoader className={documentLoaderClassName} />
      ) : (
        <>
          {titleEditor && (
            <div className="relative w-full py-3">
              <EditorContainer
                editor={titleEditor}
                id={id + "-title"}
                isTouchDevice={isTouchDevice}
                editorContainerClassName="page-title-editor bg-transparent py-3 border-none"
                displayConfig={displayConfig}
              >
                <EditorContentWrapper
                  editor={titleEditor}
                  id={id + "-title"}
                  tabIndex={tabIndex}
                  className="no-scrollbar placeholder-placeholder w-full resize-none rounded-none border-none bg-transparent p-0 text-[2rem] leading-[2.375rem] font-bold tracking-[-2%] outline-none"
                />
              </EditorContainer>
            </div>
          )}
          <EditorContainer
            displayConfig={displayConfig}
            editor={editor}
            editorContainerClassName={editorContainerClassName}
            id={id}
            isTouchDevice={isTouchDevice}
            provider={provider}
            state={state}
          >
            <EditorContentWrapper editor={editor} id={id} tabIndex={tabIndex} />
            {editor.isEditable && !isTouchDevice && (
              <div>
                {bubbleMenuEnabled && (
                  <EditorBubbleMenu
                    editor={editor}
                    disabledExtensions={disabledExtensions}
                    extendedEditorProps={extendedEditorProps}
                    flaggedExtensions={flaggedExtensions}
                  />
                )}
                <BlockMenu
                  editor={editor}
                  flaggedExtensions={flaggedExtensions}
                  disabledExtensions={disabledExtensions}
                />
              </div>
            )}
          </EditorContainer>
        </>
      )}
    </div>
  );
}
