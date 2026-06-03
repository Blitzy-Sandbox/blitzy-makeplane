/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Lite-text editor variant of the @plane/editor package — a lightweight
 * TipTap-based editor for compact input scenarios such as comments, short
 * descriptions, and other short-form text.
 *
 * Composes a minimal extension set on top of the shared EditorWrapper and
 * forwards a ref typed as EditorRefApi for imperative editor control.
 */

import { forwardRef, useMemo } from "react";
// components
import { EditorWrapper } from "@/components/editors/editor-wrapper";
// extensions
import { EnterKeyExtension } from "@/extensions";
// types
import type { EditorRefApi, ILiteTextEditorProps } from "@/types";

/**
 * File-private React component that resolves the lite-variant TipTap extension
 * set and renders through the shared EditorWrapper.
 *
 * Reads from ILiteTextEditorProps: onEnterKeyPress, disabledExtensions, extensions.
 *
 * TipTap behavior:
 *  - Exposes: the caller-provided extensions array plus the lite-specific
 *    EnterKeyExtension (registered by default).
 *  - Overrides: default Enter-key behavior via EnterKeyExtension — Enter normally
 *    splits the block, but when no dropbar extension is open the keystroke is
 *    consumed and onEnterKeyPress is invoked instead (the typical comment-submit
 *    UX). Callers can opt out via disabledExtensions: ["enter-key"].
 *  - Hides: the heavyweight document extensions used by the rich-text and
 *    document variants (SideMenuExtension, bubble/block menus, heading list
 *    extensions, etc.) are intentionally not registered here to keep the lite
 *    variant minimal.
 *
 * Side effects:
 *  - The resolved extension list is memoized via useMemo keyed on
 *    externalExtensions, disabledExtensions, and onEnterKeyPress so the editor
 *    instance is not rebuilt on every parent render.
 *  - The caller's extensions array is cloned ([...externalExtensions]) before
 *    being extended — preserves caller-side immutability of the input array.
 *  - No API calls, navigation, or direct DOM manipulation occur here; all
 *    editor instantiation and lifecycle are delegated to EditorWrapper.
 */
function LiteTextEditor(props: ILiteTextEditorProps) {
  const { onEnterKeyPress, disabledExtensions, extensions: externalExtensions = [] } = props;

  const extensions = useMemo(() => {
    const resolvedExtensions = [...externalExtensions];

    if (!disabledExtensions?.includes("enter-key")) {
      resolvedExtensions.push(EnterKeyExtension(onEnterKeyPress));
    }

    return resolvedExtensions;
  }, [externalExtensions, disabledExtensions, onEnterKeyPress]);

  return <EditorWrapper {...props} extensions={extensions} />;
}

/**
 * Public-facing lite-text editor component — a forwardRef wrapper around the
 * file-private LiteTextEditor.
 *
 * Props are forwarded to LiteTextEditor unchanged; see ILiteTextEditorProps.
 *
 * Ref: EditorRefApi (= CoreEditorRefApi & TExtendedEditorRefApi). The ref
 * exposes the imperative editor surface (focus, blur, content getters/setters,
 * transaction commit, scroll helpers, undo) used by callers that need to drive
 * the editor outside of the React render cycle — e.g., to clear input after
 * submit.
 *
 * Consumers: re-exported through
 * packages/editor/src/core/components/editors/index.ts and surfaced from the
 * top-level packages/editor/src/index.ts package entry. Literal direct
 * importers are the app-side wrappers at
 * apps/web/core/components/editor/lite-text/editor.tsx and
 * apps/web/core/components/editor/sticky-editor/editor.tsx. The lite-text
 * wrapper in turn powers the comment-create and comment-edit forms under
 * apps/web/core/components/comments/ (which surface inside the issue-detail
 * UX), notification-card content, and similar short-form input components;
 * the sticky-editor wrapper powers the sticky-note inputs under
 * apps/web/core/components/stickies/.
 */
const LiteTextEditorWithRef = forwardRef(function LiteTextEditorWithRef(
  props: ILiteTextEditorProps,
  ref: React.ForwardedRef<EditorRefApi>
) {
  return <LiteTextEditor {...props} forwardedRef={ref as React.MutableRefObject<EditorRefApi | null>} />;
});

LiteTextEditorWithRef.displayName = "LiteTextEditorWithRef";

export { LiteTextEditorWithRef };
